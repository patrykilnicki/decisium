import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";
import { getAppUrl } from "@/lib/utils/app-url";
import {
  listComposioConnectedAccounts,
  isComposioEnabled,
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
    const resolvedProvider =
      TOOLKIT_TO_PROVIDER[toolkit] ?? "google_calendar";

    const typedSupabase =
      supabase as import("@supabase/supabase-js").SupabaseClient<Database>;

    const { data: existing } = await typedSupabase
      .from("integrations")
      .select("id")
      .eq("user_id", user.id)
      .eq("provider", resolvedProvider)
      .maybeSingle();

    const updatePayload = {
      status: "active",
      metadata: {
        composio_connected_account_id: connectedAccount.id,
      },
      external_email: (connectedAccount as { appName?: string }).appName ?? null,
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
      await typedSupabase
        .from("integrations")
        .update(updatePayload)
        .eq("id", existing.id);
      integrationId = existing.id;
    } else {
      const metadata: import("@/types/supabase").Json = {
        composio_connected_account_id: connectedAccount.id,
      };
      const { data: inserted } = await typedSupabase
        .from("integrations")
        .insert({
          user_id: user.id,
          provider: resolvedProvider,
          status: "active",
          metadata,
          external_email: (connectedAccount as { appName?: string }).appName ?? null,
          connected_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      integrationId = inserted?.id;
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
