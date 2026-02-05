import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import {
  createOAuthManager,
  createCalendarWatchService,
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
    // Type assertion to match expected SupabaseClient signature
    const typedSupabase = supabase as SupabaseClient<Database>;
    const oauthManager = createOAuthManager(typedSupabase);
    const integration = await oauthManager.completeOAuthFlow(code, state, {
      redirectUri,
    });

    // Google Calendar: setup watch for real-time updates (HTTPS only)
    if (provider === 'google_calendar') {
      const webhookUrl = getGoogleCalendarWebhookUrl(baseUrl);
      const isHttps = webhookUrl.startsWith('https://');

      if (isHttps) {
        // Setup watch in background (fire-and-forget)
        createCalendarWatchService(typedSupabase)
          .setupWatch(integration.id, webhookUrl)
          .catch((err) => {
            console.error('[OAuth] Google Calendar watch setup failed:', err);
          });
      }
    }

    // Redirect to settings with success - the UI will show sync modal
    // The modal handles the initial sync and shows progress to the user
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
