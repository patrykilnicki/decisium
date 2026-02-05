import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createOAuthManager,
  createCalendarWatchService,
} from "@/lib/integrations";
import { Provider } from "@agents/integrations";

/**
 * GET /api/integrations/[provider]
 * Get integration status for a specific provider
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

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

    // Validate provider
    const validProviders = ["google_calendar", "gmail", "notion", "linear"];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${provider}` },
        { status: 400 },
      );
    }

    // Get integration
    const oauthManager = createOAuthManager(supabase);
    const integration = await oauthManager.getIntegrationByProvider(
      user.id,
      provider as Provider,
    );

    if (!integration) {
      return NextResponse.json({
        connected: false,
        provider,
      });
    }

    return NextResponse.json({
      connected: integration.status === "active",
      provider,
      integration: {
        id: integration.id,
        status: integration.status,
        externalEmail: integration.externalEmail,
        connectedAt: integration.connectedAt?.toISOString(),
        lastSyncAt: integration.lastSyncAt?.toISOString(),
        lastSyncStatus: integration.lastSyncStatus,
        lastSyncError: integration.lastSyncError,
      },
    });
  } catch (error) {
    console.error(`Error getting integration for ${provider}:`, error);
    return NextResponse.json(
      { error: "Failed to get integration status" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/integrations/[provider]
 * Disconnect an integration
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

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

    // Validate provider
    const validProviders = ["google_calendar", "gmail", "notion", "linear"];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${provider}` },
        { status: 400 },
      );
    }

    // Get integration
    const oauthManager = createOAuthManager(supabase);
    const integration = await oauthManager.getIntegrationByProvider(
      user.id,
      provider as Provider,
    );

    if (!integration) {
      return NextResponse.json(
        { error: "Integration not found" },
        { status: 404 },
      );
    }

    // Stop calendar watch before disconnect (Google Calendar)
    if (provider === "google_calendar") {
      const watchService = createCalendarWatchService(supabase);
      await watchService.stopWatch(integration.id);
    }

    // Disconnect
    await oauthManager.disconnect(integration.id);

    return NextResponse.json({
      success: true,
      message: `Disconnected from ${provider}`,
    });
  } catch (error) {
    console.error(`Error disconnecting ${provider}:`, error);
    return NextResponse.json(
      { error: "Failed to disconnect integration" },
      { status: 500 },
    );
  }
}
