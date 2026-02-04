import { SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding, generateEmbeddings } from '@/lib/embeddings/generate';
import { OAuthManager, Integration } from './oauth-manager';
import {
  ActivityAtom,
  Provider,
  SyncResult,
  FetchOptions,
} from '@agents/integrations';

// ============================================
// Types
// ============================================

export interface SyncOptions {
  /** Full sync (ignore cursor and sync token) */
  fullSync?: boolean;
  /** Sync only items since this date */
  since?: Date;
  /** Sync only items until this date */
  until?: Date;
  /** Maximum items to sync per batch */
  batchSize?: number;
  /** Generate embeddings for atoms */
  generateEmbeddings?: boolean;
  /** Google Calendar: syncToken for incremental sync (only new/changed events) */
  syncToken?: string;
  /** Google Calendar: calendar ID (default 'primary') */
  calendarId?: string;
}

export interface SyncProgress {
  integrationId: string;
  provider: Provider;
  status: 'running' | 'completed' | 'error';
  atomsProcessed: number;
  atomsStored: number;
  embeddingsGenerated: number;
  currentCursor?: string;
  hasMore: boolean;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

export interface StoredActivityAtom {
  id: string;
  userId: string;
  integrationId: string;
  provider: Provider;
  externalId: string;
  atomType: string;
  title?: string;
  content: string;
  occurredAt: Date;
  durationMinutes?: number;
  participants?: string[];
  sourceUrl?: string;
  embeddingId?: string;
  metadata: Record<string, unknown>;
  syncedAt: Date;
}

// ============================================
// Sync Pipeline Class
// ============================================

export class SyncPipeline {
  private supabase: SupabaseClient;
  private oauthManager: OAuthManager;
  private activeSyncs: Map<string, Promise<SyncProgress>> = new Map();

  constructor(supabase: SupabaseClient, oauthManager: OAuthManager) {
    this.supabase = supabase;
    this.oauthManager = oauthManager;
  }

  /**
   * Run a full sync pipeline for an integration
   * Prevents concurrent syncs for the same integration (deduplication)
   */
  async sync(
    integrationId: string,
    options: SyncOptions = {}
  ): Promise<SyncProgress> {
    // Check if there's already an active sync for this integration
    const existingSync = this.activeSyncs.get(integrationId);
    if (existingSync) {
      console.log(`[sync-pipeline] Sync already in progress for integration ${integrationId}, returning existing promise`);
      return existingSync;
    }

    // Create sync promise and track it
    const syncPromise = this.performSync(integrationId, options);
    this.activeSyncs.set(integrationId, syncPromise);

    // Clean up when sync completes
    syncPromise.finally(() => {
      this.activeSyncs.delete(integrationId);
    });

    return syncPromise;
  }

  /**
   * Internal method that performs the actual sync
   */
  private async performSync(
    integrationId: string,
    options: SyncOptions = {}
  ): Promise<SyncProgress> {
    const progress: SyncProgress = {
      integrationId,
      provider: 'google_calendar', // Will be updated
      status: 'running',
      atomsProcessed: 0,
      atomsStored: 0,
      embeddingsGenerated: 0,
      hasMore: true,
      startedAt: new Date(),
    };

    try {
      console.log(`[sync-pipeline] Starting sync for integration ${integrationId} (fullSync: ${options.fullSync}, syncToken: ${options.syncToken ? 'present' : 'none'})`);

      // Get integration with timeout protection
      // Allow up to 20s to account for retry logic in getIntegration (8s per attempt + retries)
      const integration = await Promise.race([
        this.oauthManager.getIntegration(integrationId),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            console.error(`[sync-pipeline] Timeout fetching integration ${integrationId} (20s)`);
            resolve(null);
          }, 20000)
        ),
      ]);

      if (!integration) {
        throw new Error(`Integration ${integrationId} not found or timeout fetching`);
      }

      // Allow sync for 'active' and 'error' statuses
      // 'error' integrations can be retried (e.g., after fixing auth issues)
      // 'revoked' and 'pending' should not sync
      if (integration.status === 'revoked') {
        throw new Error(`Integration is revoked and cannot sync`);
      }
      
      if (integration.status === 'pending') {
        throw new Error(`Integration is pending and not yet ready to sync`);
      }

      // If status is 'error', log a warning but allow sync attempt (auto-recovery)
      if (integration.status === 'error') {
        console.warn(`[sync-pipeline] Attempting sync for integration ${integrationId} with 'error' status - will reactivate on success`);
      }

      progress.provider = integration.provider;
      console.log(`[sync-pipeline] Integration found: ${integration.provider}, status: ${integration.status}`);

      // Get authenticated adapter
      const adapterStart = Date.now();
      console.log(`[sync-pipeline] Getting authenticated adapter...`);
      const { adapter, accessToken } = await this.oauthManager.getAuthenticatedAdapter(
        integrationId
      );
      const adapterDuration = Date.now() - adapterStart;
      console.log(`[sync-pipeline] Authenticated adapter obtained in ${adapterDuration}ms`);

      // Determine cursor / syncToken (Google Calendar incremental)
      // For Google Calendar, if syncToken is provided, use it (incremental sync)
      // Otherwise, use cursor for pagination or fullSync
      const syncToken = options.syncToken;
      const cursor = options.fullSync || syncToken ? undefined : await this.oauthManager.getSyncCursor(integrationId);

      progress.currentCursor = cursor;
      console.log(`[sync-pipeline] Using syncToken: ${syncToken ? 'yes' : 'no'}, cursor: ${cursor ? 'yes' : 'no'}, fullSync: ${options.fullSync}`);

      // Build fetch options
      const fetchOptions: FetchOptions = {
        cursor,
        syncToken,
        calendarId: options.calendarId,
        since: options.since,
        until: options.until,
        limit: options.batchSize ?? 100,
      };

      // Fetch data
      const fetchStart = Date.now();
      console.log(`[sync-pipeline] Fetching data from adapter (syncToken: ${syncToken ? 'present' : 'none'}, fullSync: ${options.fullSync})...`);
      const result: SyncResult = await adapter.fetchData(accessToken, fetchOptions);
      const fetchDuration = Date.now() - fetchStart;
      console.log(`[sync-pipeline] Fetched ${result.atoms.length} atoms in ${fetchDuration}ms, hasMore: ${result.hasMore}, nextSyncToken: ${result.nextSyncToken ? 'present' : 'none'}`);
      progress.atomsProcessed = result.atoms.length;
      progress.hasMore = result.hasMore;
      progress.currentCursor = result.nextCursor;

      // Delete removed events (Google Calendar incremental sync)
      if (result.deletedExternalIds && result.deletedExternalIds.length > 0) {
        console.log(`[sync-pipeline] Deleting ${result.deletedExternalIds.length} removed events`);
        await this.supabase
          .from('activity_atoms')
          .delete()
          .eq('integration_id', integrationId)
          .eq('provider', 'google_calendar')
          .in('external_id', result.deletedExternalIds);
      }

      // Process and store atoms
      if (result.atoms.length > 0) {
        const storeStart = Date.now();
        console.log(`[sync-pipeline] Storing ${result.atoms.length} atoms...`);
        const stored = await this.storeAtoms(
          integration,
          result.atoms,
          options.generateEmbeddings ?? true
        );
        const storeDuration = Date.now() - storeStart;
        console.log(`[sync-pipeline] Stored ${stored.atomsStored} atoms, generated ${stored.embeddingsGenerated} embeddings in ${storeDuration}ms`);
        progress.atomsStored = stored.atomsStored;
        progress.embeddingsGenerated = stored.embeddingsGenerated;
      } else {
        console.log(`[sync-pipeline] No atoms to store`);
      }

      // Update sync status (sync_cursor for pageToken; syncToken stored in calendar_watches)
      // If integration was in 'error' status, reactivate it on successful sync
      const wasError = integration.status === 'error';
      await this.oauthManager.updateSyncStatus(
        integrationId,
        'success',
        integration.provider === 'google_calendar' && result.nextSyncToken
          ? undefined
          : result.nextCursor
      );

      // Reactivate integration if it was in error status and sync succeeded
      if (wasError) {
        await this.supabase
          .from('integrations')
          .update({ status: 'active', updated_at: new Date().toISOString() })
          .eq('id', integrationId);
        console.log(`[sync-pipeline] Reactivated integration ${integrationId} after successful sync`);
      }

      // Google Calendar: persist nextSyncToken to calendar_watches
      if (
        integration.provider === 'google_calendar' &&
        result.nextSyncToken
      ) {
        console.log(`[sync-pipeline] Saving nextSyncToken to calendar_watches`);
        const { error: updateError } = await this.supabase
          .from('calendar_watches')
          .update({
            sync_token: result.nextSyncToken,
            updated_at: new Date().toISOString(),
          })
          .eq('integration_id', integrationId);
        
        if (updateError) {
          console.error(`[sync-pipeline] Failed to save syncToken:`, updateError);
        } else {
          console.log(`[sync-pipeline] Successfully saved syncToken`);
        }
      } else {
        console.log(`[sync-pipeline] No nextSyncToken to save (provider: ${integration.provider}, nextSyncToken: ${result.nextSyncToken ? 'present' : 'none'})`);
      }

      progress.status = 'completed';
      progress.completedAt = new Date();
      console.log(`[sync-pipeline] Sync completed successfully for integration ${integrationId}`);

      return progress;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      console.error(`[sync-pipeline] Error during sync for integration ${integrationId}:`, errorMessage, errorStack);

      // Google Calendar API 410 Gone = sync token invalid; retry with full sync (official sync guide)
      const status = (error as { response?: { status?: number }; code?: number })?.response?.status ?? (error as { code?: number })?.code;
      console.log(`[sync-pipeline] Error status: ${status}`);
      
      const integration = progress.provider ? await this.oauthManager.getIntegration(integrationId).then((i) => i ?? undefined) : undefined;
      if (status === 410 && integration?.provider === 'google_calendar') {
        console.log(`[sync-pipeline] 410 Gone error - clearing syncToken and retrying with full sync`);
        await this.supabase
          .from('calendar_watches')
          .update({ sync_token: null, updated_at: new Date().toISOString() })
          .eq('integration_id', integrationId);
        return this.sync(integrationId, { ...options, fullSync: true, syncToken: undefined });
      }

      progress.status = 'error';
      progress.error = errorMessage;
      progress.completedAt = new Date();

      // Update sync status with error
      await this.oauthManager.updateSyncStatus(
        integrationId,
        'error',
        progress.currentCursor,
        progress.error
      );

      console.error(`[sync-pipeline] Sync failed for integration ${integrationId}: ${errorMessage}`);
      return progress;
    }
  }

  /**
   * Run sync for all active integrations of a user
   */
  async syncAllForUser(
    userId: string,
    options: SyncOptions = {}
  ): Promise<SyncProgress[]> {
    const integrations = await this.oauthManager.getActiveIntegrations(userId);
    const results: SyncProgress[] = [];

    for (const integration of integrations) {
      const progress = await this.sync(integration.id, options);
      results.push(progress);
    }

    return results;
  }

  /**
   * Store activity atoms in the database.
   * Only generates embeddings for new atoms or atoms where content changed.
   * Reuses existing embedding_id for unchanged atoms to avoid duplicates.
   */
  private async storeAtoms(
    integration: Integration,
    atoms: ActivityAtom[],
    generateEmbed: boolean
  ): Promise<{ atomsStored: number; embeddingsGenerated: number }> {
    if (atoms.length === 0) {
      return { atomsStored: 0, embeddingsGenerated: 0 };
    }

    let atomsStored = 0;
    let embeddingsGenerated = 0;

    // Fetch existing atoms to detect changes
    const externalIds = atoms.map((a) => a.externalId);
    const { data: existingAtoms } = await this.supabase
      .from('activity_atoms')
      .select('external_id, content, title, occurred_at, duration_minutes, participants, embedding_id')
      .eq('user_id', integration.userId)
      .eq('provider', integration.provider)
      .in('external_id', externalIds);

    const existingMap = new Map(
      (existingAtoms ?? []).map((a) => [
        a.external_id,
        {
          content: a.content,
          title: a.title ?? undefined,
          occurredAt: a.occurred_at,
          durationMinutes: a.duration_minutes ?? undefined,
          participants: a.participants ?? undefined,
          embeddingId: a.embedding_id ?? undefined,
        },
      ])
    );

    // Determine which atoms need new embeddings (new or changed)
    const atomsNeedingEmbeddings: ActivityAtom[] = [];
    const embeddingMap = new Map<string, string>(); // externalId -> embeddingId

    for (const atom of atoms) {
      const existing = existingMap.get(atom.externalId);
      if (existing) {
        // Atom exists - check if content changed
        const contentChanged = existing.content !== atom.content;
        const titleChanged = existing.title !== (atom.title ?? undefined);
        const occurredAtChanged = new Date(existing.occurredAt).getTime() !== atom.occurredAt.getTime();
        const durationChanged = existing.durationMinutes !== (atom.durationMinutes ?? undefined);
        const existingParticipants = existing.participants ?? [];
        const newParticipants = atom.participants ?? [];
        const participantsChanged =
          JSON.stringify([...existingParticipants].sort()) !== JSON.stringify([...newParticipants].sort());

        if (contentChanged || titleChanged || occurredAtChanged || durationChanged || participantsChanged) {
          // Content changed - need new embedding
          atomsNeedingEmbeddings.push(atom);
        } else {
          // Unchanged - reuse existing embedding_id
          if (existing.embeddingId) {
            embeddingMap.set(atom.externalId, existing.embeddingId);
          }
        }
      } else {
        // New atom - need embedding
        atomsNeedingEmbeddings.push(atom);
      }
    }

    // Generate embeddings only for new/changed atoms
    // First, check for existing embeddings by content to avoid duplicates
    if (generateEmbed && atomsNeedingEmbeddings.length > 0) {
      // Fetch existing embeddings by content for this user
      const contentsToCheck = [...new Set(atomsNeedingEmbeddings.map((a) => a.content))];
      const { data: existingEmbeddings } = await this.supabase
        .from('embeddings')
        .select('id, content')
        .eq('user_id', integration.userId)
        .in('content', contentsToCheck);

      const contentToEmbeddingId = new Map(
        (existingEmbeddings ?? []).map((e) => [e.content, e.id])
      );

      // Separate atoms into: reuse existing embedding vs generate new
      const atomsToGenerateEmbeddings: ActivityAtom[] = [];
      for (const atom of atomsNeedingEmbeddings) {
        const existingEmbeddingId = contentToEmbeddingId.get(atom.content);
        if (existingEmbeddingId) {
          // Reuse existing embedding for this content
          embeddingMap.set(atom.externalId, existingEmbeddingId);
        } else {
          // Need to generate new embedding
          atomsToGenerateEmbeddings.push(atom);
        }
      }

      // Generate embeddings only for content that doesn't exist yet
      if (atomsToGenerateEmbeddings.length > 0) {
        const BATCH_SIZE = 20;
        for (let i = 0; i < atomsToGenerateEmbeddings.length; i += BATCH_SIZE) {
          const batch = atomsToGenerateEmbeddings.slice(i, i + BATCH_SIZE);
          const contents = batch.map((atom) => atom.content);

          try {
            const embeddings = await generateEmbeddings(contents);

            // Store embeddings and map to atoms
            for (let j = 0; j < batch.length; j++) {
              const atom = batch[j];
              const embedding = embeddings[j];

              const { data: embeddingData, error: embeddingError } = await this.supabase
                .from('embeddings')
                .insert({
                  user_id: integration.userId,
                  content: atom.content,
                  embedding: embedding.embedding,
                  metadata: {
                    type: 'activity_atom',
                    provider: integration.provider,
                    external_id: atom.externalId,
                    atom_type: atom.atomType,
                    date: atom.occurredAt.toISOString().split('T')[0],
                  },
                })
                .select('id')
                .single();

              if (!embeddingError && embeddingData) {
                embeddingMap.set(atom.externalId, embeddingData.id);
                embeddingsGenerated++;
              }
            }
          } catch (error) {
            console.error('Error generating embeddings:', error);
            // Continue without embeddings
          }
        }
      }
    }

    // Store atoms (upsert - updates existing or inserts new)
    for (const atom of atoms) {
      const embeddingId = embeddingMap.get(atom.externalId);

      const atomData = {
        user_id: integration.userId,
        integration_id: integration.id,
        provider: integration.provider,
        external_id: atom.externalId,
        source_url: atom.sourceUrl,
        atom_type: atom.atomType,
        title: atom.title,
        content: atom.content,
        occurred_at: atom.occurredAt.toISOString(),
        duration_minutes: atom.durationMinutes,
        participants: atom.participants,
        embedding_id: embeddingId,
        metadata: atom.metadata ?? {},
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error } = await this.supabase
        .from('activity_atoms')
        .upsert(atomData, {
          onConflict: 'user_id,provider,external_id',
        });

      if (!error) {
        atomsStored++;
      } else {
        console.error('Error storing atom:', error);
      }
    }

    return { atomsStored, embeddingsGenerated };
  }

  /**
   * Get recent activity atoms for a user
   */
  async getRecentAtoms(
    userId: string,
    options?: {
      provider?: Provider;
      atomType?: string;
      limit?: number;
      since?: Date;
    }
  ): Promise<StoredActivityAtom[]> {
    let query = this.supabase
      .from('activity_atoms')
      .select('*')
      .eq('user_id', userId)
      .order('occurred_at', { ascending: false });

    if (options?.provider) {
      query = query.eq('provider', options.provider);
    }

    if (options?.atomType) {
      query = query.eq('atom_type', options.atomType);
    }

    if (options?.since) {
      query = query.gte('occurred_at', options.since.toISOString());
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch atoms: ${error.message}`);
    }

    return (data ?? []).map(this.mapStoredAtom);
  }

  /**
   * Search activity atoms by embedding similarity
   */
  async searchAtoms(
    userId: string,
    query: string,
    options?: {
      provider?: Provider;
      atomType?: string;
      limit?: number;
      threshold?: number;
    }
  ): Promise<Array<StoredActivityAtom & { similarity: number }>> {
    // Generate query embedding
    const { embedding } = await generateEmbedding(query);

    // Search using the match_activity_atoms function
    const { data, error } = await this.supabase.rpc('match_activity_atoms', {
      query_embedding: embedding,
      match_user_id: userId,
      match_threshold: options?.threshold ?? 0.5,
      match_count: options?.limit ?? 10,
      filter_provider: options?.provider ?? null,
      filter_atom_type: options?.atomType ?? null,
    });

    if (error) {
      throw new Error(`Failed to search atoms: ${error.message}`);
    }

    return (data ?? []).map((row: Record<string, unknown>) => ({
      ...this.mapStoredAtom(row),
      similarity: row.similarity as number,
    }));
  }

  /**
   * Get atom count by provider
   */
  async getAtomCounts(
    userId: string
  ): Promise<Record<Provider, number>> {
    const { data, error } = await this.supabase
      .from('activity_atoms')
      .select('provider')
      .eq('user_id', userId);

    if (error) {
      throw new Error(`Failed to get atom counts: ${error.message}`);
    }

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const provider = row.provider as Provider;
      counts[provider] = (counts[provider] ?? 0) + 1;
    }

    return counts as Record<Provider, number>;
  }

  /**
   * Delete atoms for an integration
   */
  async deleteAtomsForIntegration(integrationId: string): Promise<number> {
    // First get the atoms to delete their embeddings
    const { data: atoms } = await this.supabase
      .from('activity_atoms')
      .select('embedding_id')
      .eq('integration_id', integrationId)
      .not('embedding_id', 'is', null);

    // Delete embeddings
    if (atoms && atoms.length > 0) {
      const embeddingIds = atoms
        .map((a) => a.embedding_id)
        .filter(Boolean);

      if (embeddingIds.length > 0) {
        await this.supabase
          .from('embeddings')
          .delete()
          .in('id', embeddingIds);
      }
    }

    // Delete atoms
    const { data, error } = await this.supabase
      .from('activity_atoms')
      .delete()
      .eq('integration_id', integrationId)
      .select('id');

    if (error) {
      throw new Error(`Failed to delete atoms: ${error.message}`);
    }

    return data?.length ?? 0;
  }

  private mapStoredAtom(data: Record<string, unknown>): StoredActivityAtom {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      integrationId: data.integration_id as string,
      provider: data.provider as Provider,
      externalId: data.external_id as string,
      atomType: data.atom_type as string,
      title: data.title as string | undefined,
      content: data.content as string,
      occurredAt: new Date(data.occurred_at as string),
      durationMinutes: data.duration_minutes as number | undefined,
      participants: data.participants as string[] | undefined,
      sourceUrl: data.source_url as string | undefined,
      embeddingId: data.embedding_id as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      syncedAt: new Date(data.synced_at as string),
    };
  }
}

/**
 * Create a SyncPipeline instance
 */
export function createSyncPipeline(
  supabase: SupabaseClient,
  oauthManager: OAuthManager
): SyncPipeline {
  return new SyncPipeline(supabase, oauthManager);
}
