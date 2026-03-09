import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import * as db from "@/lib/supabase/db";

export interface ComposioIntegration {
  id: string;
  user_id: string;
  provider: string;
}

/**
 * Find integration by Composio connected account ID (any provider: calendar, gmail, etc.).
 * Used by webhook handler and replay endpoint.
 */
export async function findIntegrationByConnectedAccountId(
  client: SupabaseClient<Database>,
  connectedAccountId: string,
): Promise<ComposioIntegration | null> {
  const { data } = await db.selectMany(
    client,
    "integrations",
    { status: "active" },
    { limit: 200 },
  );

  if (!data) return null;

  for (const row of data) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (meta?.composio_connected_account_id === connectedAccountId) {
      return {
        id: row.id,
        user_id: row.user_id,
        provider: row.provider,
      };
    }
  }

  return null;
}

/** Row shape we need from composio_webhook_event_logs */
export interface WebhookLogRow {
  id: string;
  resolved_user_id: string | null;
  payload_metadata: Record<string, unknown> | null;
}

/**
 * Resolve our app's user_id from a webhook log row.
 * Uses resolved_user_id when set; otherwise resolves from payload_metadata.connected_account_id.
 */
export async function resolveUserIdFromWebhookLog(
  client: SupabaseClient<Database>,
  log: WebhookLogRow,
): Promise<string | null> {
  if (log.resolved_user_id) return log.resolved_user_id;

  const connectedAccountId = log.payload_metadata?.connected_account_id;
  if (typeof connectedAccountId !== "string") return null;

  const integration = await findIntegrationByConnectedAccountId(
    client,
    connectedAccountId,
  );
  return integration?.user_id ?? null;
}
