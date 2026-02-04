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

  constructor(supabase: SupabaseClient, oauthManager: OAuthManager) {
    this.supabase = supabase;
    this.oauthManager = oauthManager;
  }

  /**
   * Run a full sync pipeline for an integration
   */
  async sync(
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
      // Get integration
      const integration = await this.oauthManager.getIntegration(integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      if (integration.status !== 'active') {
        throw new Error(`Integration is not active: ${integration.status}`);
      }

      progress.provider = integration.provider;

      // Get authenticated adapter
      const { adapter, accessToken } = await this.oauthManager.getAuthenticatedAdapter(
        integrationId
      );

      // Determine cursor / syncToken (Google Calendar incremental)
      const cursor = options.fullSync ? undefined : await this.oauthManager.getSyncCursor(integrationId);
      const syncToken = options.fullSync ? undefined : options.syncToken;

      progress.currentCursor = cursor;

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
      const result: SyncResult = await adapter.fetchData(accessToken, fetchOptions);
      progress.atomsProcessed = result.atoms.length;
      progress.hasMore = result.hasMore;
      progress.currentCursor = result.nextCursor;

      // Delete removed events (Google Calendar incremental sync)
      if (result.deletedExternalIds && result.deletedExternalIds.length > 0) {
        await this.supabase
          .from('activity_atoms')
          .delete()
          .eq('integration_id', integrationId)
          .eq('provider', 'google_calendar')
          .in('external_id', result.deletedExternalIds);
      }

      // Process and store atoms
      if (result.atoms.length > 0) {
        const stored = await this.storeAtoms(
          integration,
          result.atoms,
          options.generateEmbeddings ?? true
        );
        progress.atomsStored = stored.atomsStored;
        progress.embeddingsGenerated = stored.embeddingsGenerated;
      }

      // Update sync status (sync_cursor for pageToken; syncToken stored in calendar_watches)
      await this.oauthManager.updateSyncStatus(
        integrationId,
        'success',
        integration.provider === 'google_calendar' && result.nextSyncToken
          ? undefined
          : result.nextCursor
      );

      // Google Calendar: persist nextSyncToken to calendar_watches
      if (
        integration.provider === 'google_calendar' &&
        result.nextSyncToken
      ) {
        await this.supabase
          .from('calendar_watches')
          .update({
            sync_token: result.nextSyncToken,
            updated_at: new Date().toISOString(),
          })
          .eq('integration_id', integrationId);
      }

      progress.status = 'completed';
      progress.completedAt = new Date();

      return progress;
    } catch (error) {
      // Google Calendar API 410 Gone = sync token invalid; retry with full sync (official sync guide)
      const status = (error as { response?: { status?: number }; code?: number })?.response?.status ?? (error as { code?: number })?.code;
      const integration = progress.provider ? await this.oauthManager.getIntegration(integrationId).then((i) => i ?? undefined) : undefined;
      if (status === 410 && integration?.provider === 'google_calendar') {
        await this.supabase
          .from('calendar_watches')
          .update({ sync_token: null, updated_at: new Date().toISOString() })
          .eq('integration_id', integrationId);
        return this.sync(integrationId, { ...options, fullSync: true, syncToken: undefined });
      }

      progress.status = 'error';
      progress.error = error instanceof Error ? error.message : 'Unknown error';
      progress.completedAt = new Date();

      // Update sync status with error
      await this.oauthManager.updateSyncStatus(
        integrationId,
        'error',
        progress.currentCursor,
        progress.error
      );

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
   * Store activity atoms in the database
   */
  private async storeAtoms(
    integration: Integration,
    atoms: ActivityAtom[],
    generateEmbed: boolean
  ): Promise<{ atomsStored: number; embeddingsGenerated: number }> {
    let atomsStored = 0;
    let embeddingsGenerated = 0;

    // Generate embeddings in batches
    const embeddingMap = new Map<string, string>(); // externalId -> embeddingId

    if (generateEmbed && atoms.length > 0) {
      const BATCH_SIZE = 20;
      for (let i = 0; i < atoms.length; i += BATCH_SIZE) {
        const batch = atoms.slice(i, i + BATCH_SIZE);
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

    // Store atoms
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
