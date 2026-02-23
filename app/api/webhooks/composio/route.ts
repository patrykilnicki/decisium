import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { ActivityAtomInsert } from "@/types/database";
import crypto from "crypto";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

interface ComposioWebhookPayload {
  id?: string;
  type?: string;
  metadata?: {
    log_id?: string;
    trigger_slug?: string;
    trigger_id?: string;
    connected_account_id?: string;
    auth_config_id?: string;
    user_id?: string;
  };
  data?: Record<string, unknown>;
  timestamp?: string;
}

interface TriggerEventData {
  event_id?: string;
  event_type?: string;
  summary?: string;
  description?: string;
  start_time?: string;
  end_time?: string;
  status?: string;
  html_link?: string;
  location?: string;
  organizer_email?: string;
  organizer_name?: string;
  creator_email?: string;
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  hangout_link?: string;
  conference_data?: { entryPoints?: Array<{ uri?: string }> };
  recurring_event_id?: string;
  calendar_id?: string;
  visibility?: string;
  updated_at?: string;
  created_at?: string;
}

function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signatureHeader) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected),
  );
}

function truncateContent(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function triggerEventToAtom(
  event: TriggerEventData,
): Omit<
  ActivityAtomInsert,
  "user_id" | "integration_id" | "provider" | "synced_at"
> | null {
  if (!event.event_id || !event.start_time) return null;

  const startTime = event.start_time;
  const endTime = event.end_time;

  let durationMinutes: number | undefined;
  if (startTime && endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    durationMinutes = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60),
    );
    if (durationMinutes > 24 * 60) durationMinutes = undefined;
  }

  const participants = (event.attendees ?? [])
    .map((a) => a.displayName ?? a.email ?? "")
    .filter(Boolean);

  const conferenceUri =
    event.hangout_link ??
    event.conference_data?.entryPoints?.[0]?.uri;

  const contentParts = [
    event.summary ?? "Untitled Event",
    event.description
      ? `Description: ${truncateContent(event.description, 500)}`
      : "",
    participants.length > 0 ? `Participants: ${participants.join(", ")}` : "",
    event.location ? `Location: ${event.location}` : "",
    conferenceUri ? `Meeting link: ${conferenceUri}` : "",
  ];

  return {
    external_id: event.event_id,
    atom_type: "event",
    title: event.summary ?? "Untitled Event",
    content: contentParts.filter(Boolean).join("\n"),
    occurred_at: new Date(startTime).toISOString(),
    duration_minutes: durationMinutes,
    participants: participants.length > 0 ? participants : undefined,
    source_url: event.html_link ?? undefined,
    metadata: {
      status: event.status,
      location: event.location,
      conferenceUri,
      organizer: event.organizer_email ?? event.creator_email,
      organizerName: event.organizer_name,
      isAllDay: false,
      isMeeting: participants.length > 0 || !!conferenceUri,
      visibility: event.visibility,
      calendarId: event.calendar_id ?? "primary",
      recurringEventId: event.recurring_event_id,
    } as Json,
  };
}

async function findIntegrationByComposioAccount(
  connectedAccountId: string,
  userId: string,
): Promise<{ id: string; user_id: string; provider: string } | null> {
  const { data } = await supabase
    .from("integrations")
    .select("id, user_id, provider, metadata")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .eq("status", "active")
    .limit(5);

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

async function handleCalendarSyncEvent(
  payload: ComposioWebhookPayload,
): Promise<{ processed: number; stored: number }> {
  const event = payload.data as unknown as TriggerEventData;
  const userId = payload.metadata?.user_id;
  const connectedAccountId = payload.metadata?.connected_account_id;

  if (!userId || !connectedAccountId) {
    console.warn("[composio/webhook] Missing user_id or connected_account_id");
    return { processed: 0, stored: 0 };
  }

  const integration = await findIntegrationByComposioAccount(
    connectedAccountId,
    userId,
  );

  if (!integration) {
    console.warn(
      `[composio/webhook] No integration found for user ${userId.slice(0, 8)}... / account ${connectedAccountId}`,
    );
    return { processed: 0, stored: 0 };
  }

  if (event.event_type === "deleted" || event.status === "cancelled") {
    if (event.event_id) {
      await supabase
        .from("activity_atoms")
        .delete()
        .eq("integration_id", integration.id)
        .eq("external_id", event.event_id);
      console.log(
        `[composio/webhook] Deleted event ${event.event_id} for integration ${integration.id}`,
      );
    }
    return { processed: 1, stored: 0 };
  }

  const atom = triggerEventToAtom(event);
  if (!atom) {
    console.warn(
      `[composio/webhook] Could not convert trigger event to atom (event_id: ${event.event_id})`,
    );
    return { processed: 1, stored: 0 };
  }

  const syncedAt = new Date().toISOString();
  const { error } = await supabase.from("activity_atoms").upsert(
    {
      user_id: integration.user_id,
      integration_id: integration.id,
      provider: integration.provider,
      ...atom,
      synced_at: syncedAt,
    },
    { onConflict: "user_id,provider,external_id" },
  );

  if (error) {
    console.error("[composio/webhook] Failed to upsert atom:", error.message);
    return { processed: 1, stored: 0 };
  }

  await supabase
    .from("integrations")
    .update({
      last_sync_at: syncedAt,
      last_sync_status: "success",
      last_sync_error: null,
      updated_at: syncedAt,
    })
    .eq("id", integration.id);

  console.log(
    `[composio/webhook] Upserted event "${atom.title}" for integration ${integration.id}`,
  );
  return { processed: 1, stored: 1 };
}

const CALENDAR_TRIGGER_SLUGS = new Set([
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_SYNC_TRIGGER",
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER",
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_UPDATED_TRIGGER",
  "GOOGLECALENDAR_EVENT_CANCELED_DELETED_TRIGGER",
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CHANGE_TRIGGER",
]);

/**
 * POST /api/webhooks/composio
 * Receives trigger payloads from Composio webhook subscriptions.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const signature =
    request.headers.get("x-composio-signature") ??
    request.headers.get("x-webhook-signature");

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[composio/webhook] Invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: ComposioWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ComposioWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.type !== "composio.trigger.message") {
    return NextResponse.json({ status: "ignored", type: payload.type });
  }

  const triggerSlug = payload.metadata?.trigger_slug;
  if (!triggerSlug || !CALENDAR_TRIGGER_SLUGS.has(triggerSlug)) {
    console.log(
      `[composio/webhook] Unhandled trigger slug: ${triggerSlug}`,
    );
    return NextResponse.json({ status: "ignored", trigger: triggerSlug });
  }

  try {
    const result = await handleCalendarSyncEvent(payload);
    return NextResponse.json({
      status: "ok",
      trigger: triggerSlug,
      ...result,
    });
  } catch (error) {
    console.error("[composio/webhook] Handler error:", error);
    return NextResponse.json(
      { error: "Internal error processing trigger" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/webhooks/composio
 * Health check.
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/webhooks/composio",
    description: "Composio trigger webhook receiver",
  });
}
