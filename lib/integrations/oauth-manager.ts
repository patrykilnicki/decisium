import { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, decryptToken } from './crypto';
import {
  Provider,
  OAuthTokens,
  IntegrationAdapter,
  createAdapter,
  getAdapterConfig,
} from '@agents/integrations';

// ============================================
// Types
// ============================================

export interface Integration {
  id: string;
  userId: string;
  provider: Provider;
  status: 'pending' | 'active' | 'error' | 'revoked';
  scopes: string[];
  externalUserId?: string;
  externalEmail?: string;
  metadata: Record<string, unknown>;
  connectedAt?: Date;
  lastSyncAt?: Date;
  lastSyncStatus?: 'success' | 'error' | 'partial';
  lastSyncError?: string;
  syncCursor?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IntegrationWithTokens extends Integration {
  tokens: OAuthTokens;
}

export interface ConnectResult {
  integration: Integration;
  authorizationUrl: string;
}

export interface AuditLogEntry {
  userId: string;
  integrationId?: string;
  event: 'connected' | 'disconnected' | 'synced' | 'refreshed' | 'error';
  provider: Provider;
  metadata?: Record<string, unknown>;
}

// ============================================
// OAuth Manager Class
// ============================================

export class OAuthManager {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ─────────────────────────────────────────────
  // Integration Management
  // ─────────────────────────────────────────────

  /**
   * Get an integration by ID
   * Uses maybeSingle() to avoid errors when no row found.
   * Service role client bypasses RLS automatically.
   * 
   * Optimized: Uses explicit column selection instead of '*' for better performance.
   * Includes retry logic for transient network errors.
   * Uses Promise.race with timeout to prevent hanging queries.
   */
  async getIntegration(integrationId: string, retries = 1): Promise<Integration | null> {
    const startTime = Date.now();
    const QUERY_TIMEOUT_MS = 8000; // 8 second timeout per query attempt
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Wrap query in Promise.race with timeout
        const queryPromise = this.supabase
          .from('integrations')
          .select('id, user_id, provider, status, scopes, external_user_id, external_email, metadata, connected_at, last_sync_at, last_sync_status, last_sync_error, sync_cursor, created_at, updated_at')
          .eq('id', integrationId)
          .maybeSingle();

        const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ data: null, error: { message: 'Query timeout (8s)' } }), QUERY_TIMEOUT_MS)
        );

        const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

        const duration = Date.now() - startTime;
        if (duration > 1000) {
          console.warn(`[oauth-manager] Slow query for integration ${integrationId}: ${duration}ms (attempt ${attempt + 1})`);
        }

        if (error) {
          const isNetworkError = error.message?.includes('ECONNRESET') || 
                                 error.message?.includes('fetch failed') ||
                                 error.message?.includes('timeout') ||
                                 error.message?.includes('aborted');
          
          if (isNetworkError && attempt < retries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 3000); // Exponential backoff, max 3s
            console.warn(`[oauth-manager] Network error fetching integration ${integrationId}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          
          console.error(`[oauth-manager] Error fetching integration ${integrationId}:`, error);
          return null;
        }

        if (!data) {
          console.log(`[oauth-manager] Integration ${integrationId} not found`);
          return null;
        }

        return this.mapIntegration(data);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isNetworkError = errorMessage.includes('ECONNRESET') || 
                               errorMessage.includes('fetch failed') ||
                               errorMessage.includes('timeout') ||
                               errorMessage.includes('aborted');
        
        if (isNetworkError && attempt < retries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 3000); // Exponential backoff, max 3s
          console.warn(`[oauth-manager] Network exception fetching integration ${integrationId}, retrying in ${delay}ms (attempt ${attempt + 1}/${retries + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        console.error(`[oauth-manager] Exception fetching integration ${integrationId}:`, error);
        return null;
      }
    }
    
    return null;
  }

  /**
   * Get integration for a user and provider
   */
  async getIntegrationByProvider(
    userId: string,
    provider: Provider
  ): Promise<Integration | null> {
    const { data, error } = await this.supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .eq('provider', provider)
      .single();

    if (error || !data) {
      return null;
    }

    return this.mapIntegration(data);
  }

  /**
   * Get all integrations for a user
   */
  async getUserIntegrations(userId: string): Promise<Integration[]> {
    const { data, error } = await this.supabase
      .from('integrations')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map(this.mapIntegration);
  }

  /**
   * Get all active integrations for a user
   */
  async getActiveIntegrations(userId: string): Promise<Integration[]> {
    const integrations = await this.getUserIntegrations(userId);
    return integrations.filter((i) => i.status === 'active');
  }

  // ─────────────────────────────────────────────
  // OAuth Flow
  // ─────────────────────────────────────────────

  /**
   * Start OAuth flow - create pending integration and return auth URL
   */
  async startOAuthFlow(
    userId: string,
    provider: Provider,
    options?: {
      useExtendedScopes?: boolean;
      redirectUri?: string;
    }
  ): Promise<ConnectResult> {
    // Check if integration already exists
    const existing = await this.getIntegrationByProvider(userId, provider);
    if (existing && existing.status === 'active') {
      throw new Error(`Integration with ${provider} already exists and is active`);
    }

    // Get adapter config and create adapter
    const config = getAdapterConfig(provider, {
      useExtendedScopes: options?.useExtendedScopes,
      redirectUri: options?.redirectUri,
    });
    const adapter = createAdapter(provider, config);

    // Create or update integration record
    let integration: Integration;

    if (existing) {
      // Update existing integration
      const { data, error } = await this.supabase
        .from('integrations')
        .update({
          status: 'pending',
          scopes: config.scopes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update integration: ${error.message}`);
      }

      integration = this.mapIntegration(data);
    } else {
      // Create new integration
      const { data, error } = await this.supabase
        .from('integrations')
        .insert({
          user_id: userId,
          provider,
          status: 'pending',
          scopes: config.scopes,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create integration: ${error.message}`);
      }

      integration = this.mapIntegration(data);
    }

    // Generate state with integration ID for callback
    const state = this.encodeState({
      integrationId: integration.id,
      userId,
      provider,
    });

    // Get authorization URL
    const authorizationUrl = adapter.getAuthorizationUrl(state);

    return {
      integration,
      authorizationUrl,
    };
  }

  /**
   * Complete OAuth flow - exchange code for tokens and activate integration.
   * redirectUri must match the URI used when starting the flow (e.g. from getAppUrl(request)).
   */
  async completeOAuthFlow(
    code: string,
    state: string,
    options?: { redirectUri?: string }
  ): Promise<Integration> {
    // Decode state
    const stateData = this.decodeState(state);
    if (!stateData) {
      throw new Error('Invalid OAuth state');
    }

    const { integrationId, provider } = stateData;

    // Get integration
    const integration = await this.getIntegration(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    if (integration.status !== 'pending') {
      throw new Error(`Integration is not in pending state: ${integration.status}`);
    }

    // Get adapter with same redirectUri as auth request (required by Google OAuth)
    const config = getAdapterConfig(provider, {
      redirectUri: options?.redirectUri,
    });
    const adapter = createAdapter(provider, config);

    // Exchange code for tokens
    const tokens = await adapter.exchangeCodeForTokens(code);

    // Get user info if available
    let externalUserId: string | undefined;
    let externalEmail: string | undefined;

    if (adapter.getUserInfo) {
      try {
        const userInfo = await adapter.getUserInfo(tokens.accessToken);
        externalUserId = userInfo.id;
        externalEmail = userInfo.email;
      } catch {
        // User info is optional
      }
    }

    // Store encrypted tokens
    await this.storeTokens(integrationId, tokens);

    // Update integration to active
    const { data, error } = await this.supabase
      .from('integrations')
      .update({
        status: 'active',
        external_user_id: externalUserId,
        external_email: externalEmail,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', integrationId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to activate integration: ${error.message}`);
    }

    // Log audit event
    await this.logAuditEvent({
      userId: integration.userId,
      integrationId,
      event: 'connected',
      provider,
      metadata: { externalEmail },
    });

    return this.mapIntegration(data);
  }

  /**
   * Disconnect an integration
   */
  async disconnect(integrationId: string): Promise<void> {
    const integration = await this.getIntegration(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    // Revoke tokens if possible
    try {
      const tokens = await this.getTokens(integrationId);
      if (tokens) {
        const adapter = createAdapter(integration.provider);
        if (adapter.revokeTokens) {
          await adapter.revokeTokens(tokens.accessToken);
        }
      }
    } catch {
      // Revocation is best effort
    }

    // Delete credentials
    await this.supabase
      .from('integration_credentials')
      .delete()
      .eq('integration_id', integrationId);

    // Update integration status
    await this.supabase
      .from('integrations')
      .update({
        status: 'revoked',
        updated_at: new Date().toISOString(),
      })
      .eq('id', integrationId);

    // Log audit event
    await this.logAuditEvent({
      userId: integration.userId,
      integrationId,
      event: 'disconnected',
      provider: integration.provider,
    });
  }

  // ─────────────────────────────────────────────
  // Token Management
  // ─────────────────────────────────────────────

  /**
   * Store encrypted tokens
   */
  private async storeTokens(
    integrationId: string,
    tokens: OAuthTokens
  ): Promise<void> {
    const encryptedAccess = encryptToken(tokens.accessToken);
    const encryptedRefresh = tokens.refreshToken
      ? encryptToken(tokens.refreshToken)
      : null;

    const { error } = await this.supabase
      .from('integration_credentials')
      .upsert(
        {
          integration_id: integrationId,
          access_token_encrypted: encryptedAccess,
          refresh_token_encrypted: encryptedRefresh,
          token_type: tokens.tokenType,
          expires_at: tokens.expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'integration_id',
        }
      );

    if (error) {
      throw new Error(`Failed to store tokens: ${error.message}`);
    }
  }

  /**
   * Get decrypted tokens for an integration
   */
  async getTokens(integrationId: string): Promise<OAuthTokens | null> {
    const { data, error } = await this.supabase
      .from('integration_credentials')
      .select('*')
      .eq('integration_id', integrationId)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      accessToken: decryptToken(data.access_token_encrypted),
      refreshToken: data.refresh_token_encrypted
        ? decryptToken(data.refresh_token_encrypted)
        : undefined,
      expiresAt: new Date(data.expires_at),
      tokenType: data.token_type,
      scope: '',
    };
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getValidAccessToken(integrationId: string): Promise<string> {
    const integration = await this.getIntegration(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    // Allow 'active' and 'error' statuses (error integrations can be retried)
    // Block 'revoked' and 'pending' statuses
    if (integration.status === 'revoked') {
      throw new Error(`Integration is revoked and cannot be used`);
    }
    
    if (integration.status === 'pending') {
      throw new Error(`Integration is pending and not yet ready`);
    }

    // If status is 'error', log a warning but allow token access (for retry)
    if (integration.status === 'error') {
      console.warn(`[oauth-manager] Getting access token for integration ${integrationId} with 'error' status - attempting recovery`);
    }

    const tokens = await this.getTokens(integrationId);
    if (!tokens) {
      throw new Error('No tokens found for integration');
    }

    // Check if token is expired or will expire soon (5 min buffer)
    const bufferMs = 5 * 60 * 1000;
    const isExpired = Date.now() >= tokens.expiresAt.getTime() - bufferMs;

    if (!isExpired) {
      return tokens.accessToken;
    }

    // Token is expired, try to refresh
    if (!tokens.refreshToken) {
      // Mark integration as error state
      await this.supabase
        .from('integrations')
        .update({
          status: 'error',
          last_sync_error: 'Token expired and no refresh token available',
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);

      throw new Error('Token expired and no refresh token available');
    }

    // Refresh the token
    try {
      const adapter = createAdapter(integration.provider);
      const newTokens = await adapter.refreshAccessToken(tokens.refreshToken);

      // Store new tokens
      await this.storeTokens(integrationId, newTokens);

      // Log audit event
      await this.logAuditEvent({
        userId: integration.userId,
        integrationId,
        event: 'refreshed',
        provider: integration.provider,
      });

      return newTokens.accessToken;
    } catch (error) {
      // Mark integration as error state
      await this.supabase
        .from('integrations')
        .update({
          status: 'error',
          last_sync_error: `Token refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', integrationId);

      await this.logAuditEvent({
        userId: integration.userId,
        integrationId,
        event: 'error',
        provider: integration.provider,
        metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
      });

      throw error;
    }
  }

  /**
   * Get an adapter with valid access token
   */
  async getAuthenticatedAdapter(
    integrationId: string
  ): Promise<{ adapter: IntegrationAdapter; accessToken: string }> {
    const integration = await this.getIntegration(integrationId);
    if (!integration) {
      throw new Error('Integration not found');
    }

    const accessToken = await this.getValidAccessToken(integrationId);
    const adapter = createAdapter(integration.provider);

    return { adapter, accessToken };
  }

  // ─────────────────────────────────────────────
  // Sync Status
  // ─────────────────────────────────────────────

  /**
   * Update sync status after a sync operation
   */
  async updateSyncStatus(
    integrationId: string,
    status: 'success' | 'error' | 'partial',
    cursor?: string,
    error?: string
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      last_sync_at: new Date().toISOString(),
      last_sync_status: status,
      updated_at: new Date().toISOString(),
    };

    if (cursor !== undefined) {
      updateData.sync_cursor = cursor;
    }

    if (error) {
      updateData.last_sync_error = error;
    } else {
      updateData.last_sync_error = null;
    }

    // If sync failed, mark integration as error (but don't override if already revoked)
    // This allows retry attempts for error integrations
    if (status === 'error') {
      // Only set to error if not already revoked (revoked should stay revoked)
      const currentIntegration = await this.getIntegration(integrationId);
      if (currentIntegration && currentIntegration.status !== 'revoked') {
        updateData.status = 'error';
      }
    }

    await this.supabase
      .from('integrations')
      .update(updateData)
      .eq('id', integrationId);

    // Get integration for audit log
    const integration = await this.getIntegration(integrationId);
    if (integration) {
      await this.logAuditEvent({
        userId: integration.userId,
        integrationId,
        event: status === 'error' ? 'error' : 'synced',
        provider: integration.provider,
        metadata: { status, error },
      });
    }
  }

  /**
   * Get sync cursor for incremental sync
   */
  async getSyncCursor(integrationId: string): Promise<string | undefined> {
    const integration = await this.getIntegration(integrationId);
    return integration?.syncCursor;
  }

  // ─────────────────────────────────────────────
  // Audit Logging
  // ─────────────────────────────────────────────

  /**
   * Log an audit event
   */
  private async logAuditEvent(entry: AuditLogEntry): Promise<void> {
    await this.supabase.from('integration_audit_logs').insert({
      user_id: entry.userId,
      integration_id: entry.integrationId,
      event: entry.event,
      provider: entry.provider,
      metadata: entry.metadata ?? {},
    });
  }

  /**
   * Get audit logs for a user
   */
  async getAuditLogs(
    userId: string,
    options?: {
      limit?: number;
      provider?: Provider;
    }
  ): Promise<AuditLogEntry[]> {
    let query = this.supabase
      .from('integration_audit_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (options?.provider) {
      query = query.eq('provider', options.provider);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const { data } = await query;

    return (data ?? []).map((log) => ({
      userId: log.user_id,
      integrationId: log.integration_id,
      event: log.event,
      provider: log.provider,
      metadata: log.metadata,
    }));
  }

  // ─────────────────────────────────────────────
  // Helper Methods
  // ─────────────────────────────────────────────

  private mapIntegration(data: Record<string, unknown>): Integration {
    return {
      id: data.id as string,
      userId: data.user_id as string,
      provider: data.provider as Provider,
      status: data.status as Integration['status'],
      scopes: (data.scopes as string[]) ?? [],
      externalUserId: data.external_user_id as string | undefined,
      externalEmail: data.external_email as string | undefined,
      metadata: (data.metadata as Record<string, unknown>) ?? {},
      connectedAt: data.connected_at
        ? new Date(data.connected_at as string)
        : undefined,
      lastSyncAt: data.last_sync_at
        ? new Date(data.last_sync_at as string)
        : undefined,
      lastSyncStatus: data.last_sync_status as Integration['lastSyncStatus'],
      lastSyncError: data.last_sync_error as string | undefined,
      syncCursor: data.sync_cursor as string | undefined,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }

  private encodeState(data: {
    integrationId: string;
    userId: string;
    provider: Provider;
  }): string {
    return Buffer.from(JSON.stringify(data)).toString('base64url');
  }

  private decodeState(state: string): {
    integrationId: string;
    userId: string;
    provider: Provider;
  } | null {
    try {
      const decoded = Buffer.from(state, 'base64url').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}

/**
 * Create an OAuthManager instance with the provided Supabase client
 */
export function createOAuthManager(supabase: SupabaseClient): OAuthManager {
  return new OAuthManager(supabase);
}
