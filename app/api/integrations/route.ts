import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createOAuthManager } from "@/lib/integrations";
import { getAppUrl } from "@/lib/utils/app-url";
import { getComposioConnectUrl, isComposioEnabled } from "@agents/lib/composio";

/**
 * GET /api/integrations
 * List all integrations for the authenticated user
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get user's integrations
    const oauthManager = createOAuthManager(supabase);
    const integrations = await oauthManager.getUserIntegrations(user.id);

    return NextResponse.json({
      integrations: integrations.map((integration) => ({
        id: integration.id,
        provider: integration.provider,
        status: integration.status,
        externalEmail: integration.externalEmail,
        connectedAt: integration.connectedAt?.toISOString(),
        lastSyncAt: integration.lastSyncAt?.toISOString(),
        lastSyncStatus: integration.lastSyncStatus,
      })),
    });
  } catch (error) {
    console.error("Error listing integrations:", error);
    return NextResponse.json(
      { error: "Failed to list integrations" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/integrations
 * Start OAuth flow for a new integration
 * Body: { provider: string, useExtendedScopes?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { provider, useExtendedScopes } = body;

    if (!provider) {
      return NextResponse.json(
        { error: "Provider is required" },
        { status: 400 },
      );
    }

    // Validate provider
    const validProviders = ["google_calendar", "gmail", "notion", "linear"];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${provider}` },
        { status: 400 },
      );
    }

    // Google Calendar: use Composio when configured
    if (provider === "google_calendar" && isComposioEnabled()) {
      const baseUrl = getAppUrl(request);
      const callbackUrl = `${baseUrl}/api/integrations/composio/callback`;
      const redirectUrl = await getComposioConnectUrl(
        user.id,
        "GOOGLECALENDAR",
        {
          callbackUrl,
        },
      );
      if (redirectUrl) {
        const response = NextResponse.json({
          authorizationUrl: redirectUrl,
        });
        response.cookies.set("composio_connect_provider", provider, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge: 60 * 10,
          path: "/",
        });
        return response;
      }
    }

    // Fall back to custom OAuth flow
    const baseUrl = getAppUrl(request);
    const redirectUri = `${baseUrl}/api/integrations/${provider}/callback`;
    const oauthManager = createOAuthManager(supabase);
    const result = await oauthManager.startOAuthFlow(user.id, provider, {
      useExtendedScopes,
      redirectUri,
    });

    return NextResponse.json({
      integrationId: result.integration.id,
      authorizationUrl: result.authorizationUrl,
    });
  } catch (error) {
    console.error("Error starting OAuth flow:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start OAuth flow",
      },
      { status: 500 },
    );
  }
}
