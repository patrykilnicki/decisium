import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  getComposioConnectUrl,
  isComposioEnabled,
  COMPOSIO_TOOLKIT,
} from "@agents/lib/composio";

const PROVIDER_TO_TOOLKIT: Record<string, keyof typeof COMPOSIO_TOOLKIT> = {
  google_calendar: "GOOGLECALENDAR",
  gmail: "GMAIL",
};

/**
 * POST /api/integrations/composio/connect
 * Start Composio Connect flow - returns redirect URL for user to authenticate.
 * Body: { provider: "google_calendar" }
 */
export async function POST(request: NextRequest) {
  try {
    if (!isComposioEnabled()) {
      return NextResponse.json(
        { error: "Composio is not configured" },
        { status: 503 },
      );
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { provider } = body;

    if (!provider) {
      return NextResponse.json(
        { error: "provider is required" },
        { status: 400 },
      );
    }

    const toolkit = PROVIDER_TO_TOOLKIT[provider];
    if (!toolkit) {
      return NextResponse.json(
        { error: `Unsupported provider for Composio: ${provider}` },
        { status: 400 },
      );
    }

    const baseUrl = getAppUrl(request);
    const callbackUrl = `${baseUrl}/api/integrations/composio/callback`;
    const redirectUrl = await getComposioConnectUrl(user.id, toolkit, {
      callbackUrl,
    });

    if (!redirectUrl) {
      return NextResponse.json(
        { error: "Failed to create Composio connect link" },
        { status: 500 },
      );
    }

    const response = NextResponse.json({ redirectUrl });
    response.cookies.set("composio_connect_provider", provider, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 10,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("[composio/connect] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to start connection",
      },
      { status: 500 },
    );
  }
}
