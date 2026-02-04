import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import {
  createOAuthManager,
  createCalendarWatchService,
  createSyncPipeline,
} from '@/lib/integrations';
import { getAppUrl, getGoogleCalendarWebhookUrl } from '@/lib/utils/app-url';

/**
 * GET /api/integrations/[provider]/callback
 * OAuth callback handler
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  const baseUrl = getAppUrl(request);

  // Handle OAuth error
  if (error) {
    console.error(`OAuth error for ${provider}:`, error, errorDescription);
    const errorUrl = new URL('/settings', baseUrl);
    errorUrl.searchParams.set('error', 'oauth_error');
    errorUrl.searchParams.set('error_description', errorDescription ?? error);
    return NextResponse.redirect(errorUrl);
  }

  // Validate required parameters
  if (!code || !state) {
    const errorUrl = new URL('/settings', baseUrl);
    errorUrl.searchParams.set('error', 'missing_params');
    return NextResponse.redirect(errorUrl);
  }

  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      const errorUrl = new URL('/auth', baseUrl);
      errorUrl.searchParams.set('error', 'unauthorized');
      return NextResponse.redirect(errorUrl);
    }

    // Complete OAuth flow (pass same redirectUri as auth request to avoid redirect_uri_mismatch)
    const redirectUri = `${baseUrl}/api/integrations/${provider}/callback`;
    const oauthManager = createOAuthManager(supabase);
    const integration = await oauthManager.completeOAuthFlow(code, state, {
      redirectUri,
    });

    // Google Calendar: setup watch (HTTPS only)
    if (provider === 'google_calendar') {
      const webhookUrl = getGoogleCalendarWebhookUrl(baseUrl);
      const isHttps = webhookUrl.startsWith('https://');

      if (isHttps) {
        // Setup watch in background (fire-and-forget)
        createCalendarWatchService(supabase)
          .setupWatch(integration.id, webhookUrl)
          .catch((err) => {
            console.error('[OAuth] Google Calendar watch setup failed:', err);
          });
      }
    }

    // Run initial sync for ALL providers immediately after connection (fire-and-forget)
    // This ensures events are synced instantly without requiring "Sync Now" button click
    console.log(`[OAuth] Triggering initial sync for ${provider} (integration: ${integration.id})`);
    
    const syncPipeline = createSyncPipeline(supabase, oauthManager);
    
    // Start sync immediately (fire-and-forget) - don't await to avoid blocking redirect
    syncPipeline
      .sync(integration.id, {
        fullSync: true,
        generateEmbeddings: true,
        calendarId: provider === 'google_calendar' ? 'primary' : undefined,
      })
      .then((progress) => {
        console.log(
          `[OAuth] Initial sync completed for ${provider}: ${progress.atomsStored} atoms stored, status: ${progress.status}`
        );
        
        // Update integration's last_sync_at so UI shows it synced
        // Use service role client to ensure we can update (bypasses RLS)
        const serviceSupabase = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        
        serviceSupabase
          .from('integrations')
          .update({
            last_sync_at: new Date().toISOString(),
            last_sync_status: progress.status === 'completed' ? 'success' : progress.status,
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id)
          .then(({ error }) => {
            if (error) {
              console.error(`[OAuth] Failed to update sync status:`, error);
            } else {
              console.log(`[OAuth] Updated sync status for ${provider}`);
            }
          });
      })
      .catch((err) => {
        console.error(`[OAuth] Initial sync failed for ${provider}:`, err);
        
        // Update integration with error status using service role (bypasses RLS)
        const serviceSupabase = createServiceClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!
        );
        
        serviceSupabase
          .from('integrations')
          .update({
            last_sync_status: 'error',
            last_sync_error: err instanceof Error ? err.message : 'Sync failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', integration.id)
          .then(({ error }) => {
            if (error) {
              console.error(`[OAuth] Failed to update error status:`, error);
            }
          });
      });

    // Redirect to settings with success
    const successUrl = new URL('/settings', baseUrl);
    successUrl.searchParams.set('connected', provider);
    successUrl.searchParams.set('integration_id', integration.id);
    return NextResponse.redirect(successUrl);
  } catch (error) {
    console.error(`Error completing OAuth flow for ${provider}:`, error);
    const errorUrl = new URL('/settings', baseUrl);
    errorUrl.searchParams.set('error', 'connection_failed');
    errorUrl.searchParams.set(
      'error_description',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return NextResponse.redirect(errorUrl);
  }
}
