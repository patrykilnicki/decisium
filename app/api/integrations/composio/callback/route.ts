import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import * as db from "@/lib/supabase/db";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  listComposioConnectedAccounts,
  isComposioEnabled,
  setupCalendarTrigger,
} from "@agents/lib/composio";

const TOOLKIT_TO_PROVIDER: Record<string, string> = {
  GOOGLECALENDAR: "google_calendar",
  GMAIL: "gmail",
};

/**
 * GET /api/integrations/composio/callback
 * Composio redirects here after user completes OAuth.
 * Query params: provider (e.g. google_calendar)
 *
 * Composio does not have a "Redirect URL" setting in the dashboard. The callback
 * URL is passed when starting the connection (getComposioConnectUrl with
 * options.callbackUrl), so no manual configuration in Composio is needed.
 */
export async function GET(request: NextRequest) {
  const baseUrl = getAppUrl(request);
  const authUrl = new URL("/auth", baseUrl);
  const settingsUrl = new URL("/settings", baseUrl);

  try {
    if (!isComposioEnabled()) {
      settingsUrl.searchParams.set("error", "composio_not_configured");
      return NextResponse.redirect(settingsUrl);
    }

    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      authUrl.searchParams.set("error", "unauthorized");
      authUrl.searchParams.set(
        "redirect",
        "/api/integrations/composio/callback?" +
          request.nextUrl.searchParams.toString(),
      );
      return NextResponse.redirect(authUrl);
    }

    const provider =
      request.nextUrl.searchParams.get("provider") ??
      request.cookies.get("composio_connect_provider")?.value ??
      "google_calendar";

    const toolkit =
      provider === "google_calendar"
        ? "GOOGLECALENDAR"
        : provider === "gmail"
          ? "GMAIL"
          : "GOOGLECALENDAR";

    const accounts = await listComposioConnectedAccounts(user.id, toolkit);

    if (accounts.length === 0) {
      console.warn("[composio/callback] No active connection found for user");
      settingsUrl.searchParams.set("error", "connection_not_found");
      return NextResponse.redirect(settingsUrl);
    }

    const connectedAccount = accounts[0];
    const resolvedProvider = TOOLKIT_TO_PROVIDER[toolkit] ?? "google_calendar";

    const { data: existing } = await db.selectOne(
      supabase,
      "integrations",
      { user_id: user.id, provider: resolvedProvider },
      { columns: "id" },
    );

    const updatePayload = {
      status: "active",
      metadata: {
        composio_connected_account_id: connectedAccount.id,
      },
      external_email:
        (connectedAccount as { appName?: string }).appName ?? null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as {
      status: string;
      metadata: import("@/types/supabase").Json;
      external_email: string | null;
      connected_at: string;
      updated_at: string;
    };

    let integrationId: string | undefined;

    if (existing) {
      await db.update(
        supabase,
        "integrations",
        { id: (existing as { id: string }).id },
        updatePayload,
      );
      integrationId = (existing as { id: string }).id;
    } else {
      const metadata: import("@/types/supabase").Json = {
        composio_connected_account_id: connectedAccount.id,
      };
      const { data: inserted } = await db.insertOne(supabase, "integrations", {
        user_id: user.id,
        provider: resolvedProvider,
        status: "active",
        metadata,
        external_email:
          (connectedAccount as { appName?: string }).appName ?? null,
        connected_at: new Date().toISOString(),
      });
      integrationId = inserted ? (inserted as { id: string }).id : undefined;
    }

    // Set up real-time trigger for Google Calendar
    // Composio webhooks must be publicly reachable - localhost won't work. Prefer
    // NEXT_PUBLIC_APP_URL if it's a production URL (e.g. when developing against deployed app).
    if (resolvedProvider === "google_calendar" && integrationId) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        const isLocalhost = (url: string) =>
          url.startsWith("http://localhost") ||
          url.startsWith("https://localhost");
        const webhookBase =
          appUrl && !isLocalhost(appUrl) ? appUrl.replace(/\/$/, "") : baseUrl;
        const webhookUrl = `${webhookBase}/api/webhooks/composio`;

        if (isLocalhost(webhookUrl)) {
          console.warn(
            "[composio/callback] Webhook URL is localhost — Composio cannot reach it. " +
              "Set NEXT_PUBLIC_APP_URL to a public URL (e.g. ngrok or deployed app) for real-time sync.",
          );
        }

        const triggerId = await setupCalendarTrigger(
          user.id,
          webhookUrl,
          connectedAccount.id,
        );

        if (triggerId) {
          await db.update(
            supabase,
            "integrations",
            { id: integrationId },
            {
              metadata: {
                composio_connected_account_id: connectedAccount.id,
                composio_trigger_id: triggerId,
              } as import("@/types/supabase").Json,
              updated_at: new Date().toISOString(),
            },
          );
          console.log(
            `[composio/callback] Created trigger ${triggerId} for integration ${integrationId}`,
          );
        }
      } catch (triggerErr) {
        console.warn(
          "[composio/callback] Failed to set up trigger (non-blocking):",
          triggerErr instanceof Error ? triggerErr.message : triggerErr,
        );
      }
    }

    settingsUrl.searchParams.set("connected", resolvedProvider);
    if (integrationId) {
      settingsUrl.searchParams.set("integration_id", integrationId);
    }

    const response = NextResponse.redirect(settingsUrl);
    response.cookies.delete("composio_connect_provider");
    return response;
  } catch (error) {
    console.error("[composio/callback] Error:", error);
    settingsUrl.searchParams.set("error", "callback_failed");
    return NextResponse.redirect(settingsUrl);
  }
}
