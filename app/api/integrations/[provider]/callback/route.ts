import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  createOAuthManager,
  createCalendarWatchService,
  createSyncPipeline,
} from '@/lib/integrations';

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

  // Base URL for redirects
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

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

    // Complete OAuth flow
    const oauthManager = createOAuthManager(supabase);
    const integration = await oauthManager.completeOAuthFlow(code, state);

    // Google Calendar: setup watch (HTTPS only) + initial sync (fire-and-forget)
    if (provider === 'google_calendar') {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const webhookUrl = `${baseUrl}/api/webhooks/google-calendar`;
      const isHttps = webhookUrl.startsWith('https://');

      const runInitialSync = async () => {
        const syncPipeline = createSyncPipeline(supabase, oauthManager);
        await syncPipeline.sync(integration.id, {
          fullSync: true,
          generateEmbeddings: true,
          calendarId: 'primary',
        });
      };

      if (isHttps) {
        createCalendarWatchService(supabase)
          .setupWatch(integration.id, webhookUrl)
          .then(runInitialSync)
          .catch((err) => {
            console.error('[OAuth] Google Calendar watch setup failed:', err);
          });
      } else {
        // Local dev: skip watch (Google requires HTTPS), run sync only
        runInitialSync().catch((err) => {
          console.error('[OAuth] Google Calendar initial sync failed:', err);
        });
      }
    }

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
