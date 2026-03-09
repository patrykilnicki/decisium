import { NextRequest, NextResponse } from "next/server";
import type { Json } from "@/types/supabase";
import type { ActivityAtomInsert } from "@/types/database";
import crypto from "crypto";
import { dispatchTodoGenerationTask } from "@/lib/tasks/todo-dispatcher";
import { dispatchVaultSyncTask } from "@/lib/tasks/vault-dispatcher";
import {
  resolveGmailReply,
  GMAIL_EMAIL_SENT_TRIGGER,
  type GmailSentEventPayload,
} from "@/lib/integrations/gmail-reply-resolver";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { findIntegrationByConnectedAccountId } from "@/lib/integrations/composio-webhook";

const supabase = createAdminClient();

/** Ensure user exists in users table before enqueueing tasks (avoids tasks_user_id_fkey). */
async function userExistsInDb(userId: string): Promise<boolean> {
  const { data } = await db.selectOne(supabase, "users", { id: userId });
  return Boolean(data);
}

/** Log one webhook request to composio_webhook_event_logs (full event → todo flow). */
async function insertWebhookEventLog(entry: {
  eventType?: string | null;
  triggerSlug?: string | null;
  payloadMetadata?: Record<string, unknown>;
  resolvedUserId?: string | null;
  handlerBranch: string;
  processingSteps?: Json;
  result?: Record<string, unknown>;
  errorMessage?: string | null;
  httpStatus: number;
}): Promise<void> {
  const row = {
    event_type: entry.eventType ?? null,
    trigger_slug: entry.triggerSlug ?? null,
    payload_metadata: (entry.payloadMetadata ?? {}) as Json,
    resolved_user_id: entry.resolvedUserId ?? null,
    handler_branch: entry.handlerBranch,
    processing_steps: entry.processingSteps ?? [],
    result: (entry.result ?? {}) as Json,
    error_message: entry.errorMessage ?? null,
    http_status: entry.httpStatus,
  };
  const { error } = await db.insertOne(
    supabase,
    "composio_webhook_event_logs",
    row as never,
  );
  if (error) {
    console.warn(
      "[composio/webhook] Failed to insert event log:",
      error.message,
    );
  }
}

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

/** composio.connected_account.expired event data */
interface ComposioExpiredEventData {
  id?: string;
  toolkit?: { slug?: string };
  status?: string;
  status_reason?: string;
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

/**
 * Verify Composio webhook signature per official docs.
 * @see https://docs.composio.dev/docs/webhook-verification
 *
 * Supports:
 * - Official format: webhook-signature, webhook-id, webhook-timestamp
 *   Signing string: {webhook_id}.{webhook_timestamp}.{body}
 *   HMAC-SHA256 → base64. Signature format: "v1,<base64>"
 * - Legacy format: x-composio-signature or x-webhook-signature
 *   HMAC-SHA256(rawBody) → hex (for older Composio versions)
 */
function verifyWebhookSignature(
  rawBody: string,
  request: NextRequest,
): boolean {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
  if (!secret) return false; // Reject when secret not configured (prevent accepting forged webhooks)

  const webhookSignature = request.headers.get("webhook-signature");
  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const legacySignature =
    request.headers.get("x-composio-signature") ??
    request.headers.get("x-webhook-signature");

  // Official format (per Composio docs)
  if (webhookSignature && webhookId && webhookTimestamp) {
    const signingString = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signingString)
      .digest("base64");
    const received = webhookSignature.includes(",")
      ? (webhookSignature.split(",")[1]?.trim() ?? webhookSignature)
      : webhookSignature;

    // Reject if timestamp is too old (default tolerance 300s per docs)
    const ts = parseInt(webhookTimestamp, 10);
    if (!Number.isNaN(ts) && Date.now() / 1000 - ts > 300) {
      console.warn("[composio/webhook] Webhook timestamp too old");
      return false;
    }

    try {
      const expectedBuf = Buffer.from(expected, "base64");
      const receivedBuf = Buffer.from(received, "base64");
      return (
        expectedBuf.length === receivedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, receivedBuf)
      );
    } catch {
      return false;
    }
  }

  // Legacy format: x-composio-signature or x-webhook-signature (HMAC-SHA256 hex)
  if (legacySignature) {
    const expectedHex = crypto
      .createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");
    try {
      const expectedBuf = Buffer.from(expectedHex, "hex");
      const receivedBuf = Buffer.from(legacySignature, "hex");
      return (
        expectedBuf.length === receivedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, receivedBuf)
      );
    } catch {
      return false;
    }
  }

  return false;
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
    event.hangout_link ?? event.conference_data?.entryPoints?.[0]?.uri;

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

/** Triggers that should trigger todo merge (all integrations we support for todos). */
const CALENDAR_TRIGGER_SLUGS = new Set([
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_SYNC_TRIGGER",
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER",
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_UPDATED_TRIGGER",
  "GOOGLECALENDAR_EVENT_CANCELED_DELETED_TRIGGER",
  "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CHANGE_TRIGGER",
]);

function isIntegrationTriggerForTodo(triggerSlug: string): boolean {
  if (CALENDAR_TRIGGER_SLUGS.has(triggerSlug)) return true;
  if (triggerSlug.startsWith("GMAIL_")) return true;
  return false;
}

async function handleCalendarSyncEvent(
  payload: ComposioWebhookPayload,
): Promise<{ processed: number; stored: number; userId?: string }> {
  const event = payload.data as unknown as TriggerEventData;
  const connectedAccountId = payload.metadata?.connected_account_id;

  if (!connectedAccountId) {
    console.warn("[composio/webhook] Missing connected_account_id");
    return { processed: 0, stored: 0, userId: undefined };
  }

  const integration = await findIntegrationByConnectedAccountId(
    supabase,
    connectedAccountId,
  );

  if (!integration) {
    console.warn(
      `[composio/webhook] No integration found for account ${connectedAccountId}`,
    );
    return { processed: 0, stored: 0, userId: undefined };
  }

  if (event.event_type === "deleted" || event.status === "cancelled") {
    if (event.event_id) {
      await db.remove(supabase, "activity_atoms", {
        integration_id: integration.id,
        external_id: event.event_id,
      });
      console.log(
        `[composio/webhook] Deleted event ${event.event_id} for integration ${integration.id}`,
      );
    }
    return { processed: 1, stored: 0, userId: integration.user_id };
  }

  const atom = triggerEventToAtom(event);
  if (!atom) {
    console.warn(
      `[composio/webhook] Could not convert trigger event to atom (event_id: ${event.event_id})`,
    );
    return { processed: 1, stored: 0, userId: integration.user_id };
  }

  const syncedAt = new Date().toISOString();
  const { error } = await db.upsert(
    supabase,
    "activity_atoms",
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
    return { processed: 1, stored: 0, userId: integration.user_id };
  }

  await db.update(
    supabase,
    "integrations",
    { id: integration.id },
    {
      last_sync_at: syncedAt,
      last_sync_status: "success",
      last_sync_error: null,
      updated_at: syncedAt,
    },
  );

  console.log(
    `[composio/webhook] Upserted event "${atom.title}" for integration ${integration.id}`,
  );
  return { processed: 1, stored: 1, userId: integration.user_id };
}

/**
 * POST /api/webhooks/composio
 * Receives trigger payloads from Composio webhook subscriptions.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, request)) {
    console.warn("[composio/webhook] Invalid signature");
    await insertWebhookEventLog({
      handlerBranch: "signature_failed",
      errorMessage: "Invalid signature",
      httpStatus: 401,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: ComposioWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ComposioWebhookPayload;
  } catch {
    await insertWebhookEventLog({
      handlerBranch: "parse_error",
      errorMessage: "Invalid JSON",
      httpStatus: 400,
    });
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // composio.connected_account.expired - mark integration for re-auth
  if (payload.type === "composio.connected_account.expired") {
    const expiredData = payload.data as unknown as ComposioExpiredEventData;
    const accountId = expiredData?.id;
    if (accountId) {
      const integration = await findIntegrationByConnectedAccountId(
        supabase,
        accountId,
      );
      if (integration) {
        const reason = expiredData?.status_reason ?? "Token expired";
        await db.update(
          supabase,
          "integrations",
          { id: integration.id },
          {
            status: "error",
            last_sync_error: reason,
            last_sync_status: "error",
            updated_at: new Date().toISOString(),
          },
        );
        console.log(
          `[composio/webhook] Marked integration ${integration.id} expired: ${reason}`,
        );
      }
    }
    await insertWebhookEventLog({
      eventType: payload.type,
      payloadMetadata: payload.metadata ?? undefined,
      handlerBranch: "expired",
      result: { accountId: accountId ?? null },
      httpStatus: 200,
    });
    return NextResponse.json({
      status: "ok",
      type: "composio.connected_account.expired",
    });
  }

  if (payload.type !== "composio.trigger.message") {
    await insertWebhookEventLog({
      eventType: payload.type,
      payloadMetadata: payload.metadata ?? undefined,
      handlerBranch: "ignored_type",
      result: { type: payload.type },
      httpStatus: 200,
    });
    return NextResponse.json({ status: "ignored", type: payload.type });
  }

  const triggerSlug = payload.metadata?.trigger_slug;
  if (!triggerSlug || !isIntegrationTriggerForTodo(triggerSlug)) {
    console.log(`[composio/webhook] Unhandled trigger slug: ${triggerSlug}`);
    await insertWebhookEventLog({
      eventType: payload.type,
      triggerSlug: triggerSlug ?? null,
      payloadMetadata: payload.metadata ?? undefined,
      handlerBranch: "ignored_trigger",
      result: { trigger: triggerSlug },
      httpStatus: 200,
    });
    return NextResponse.json({ status: "ignored", trigger: triggerSlug });
  }

  try {
    let userId: string | undefined;

    if (CALENDAR_TRIGGER_SLUGS.has(triggerSlug)) {
      const result = await handleCalendarSyncEvent(payload);
      userId = result.userId;
      if (result.userId != null) {
        if (!(await userExistsInDb(result.userId))) {
          console.warn(
            `[composio/webhook] Skipping task dispatch: user ${result.userId} not found in users table (FK guard)`,
          );
          await insertWebhookEventLog({
            eventType: payload.type,
            triggerSlug,
            payloadMetadata: payload.metadata ?? undefined,
            resolvedUserId: result.userId,
            handlerBranch: "calendar_sync",
            errorMessage: "User not in users table, skipped dispatch",
            httpStatus: 200,
          });
          return NextResponse.json({
            status: "ok",
            trigger: triggerSlug,
            skipped: "user_not_found",
          });
        }
        const event = payload.data as unknown as TriggerEventData;
        const signalHints = event.event_id
          ? [{ eventId: event.event_id }]
          : undefined;
        const dispatchResult = await dispatchTodoGenerationTask(result.userId, {
          source: "system.webhook.composio.calendar",
          date: new Date().toISOString().split("T")[0],
          incremental: true,
          cooldownMinutes: 2,
          signalHints,
        });
        const vaultResult = await dispatchVaultSyncTask(result.userId, {
          source: "system.webhook.composio.calendar",
          incremental: true,
          cooldownMinutes: 10,
          externalIds: event.event_id ? [event.event_id] : undefined,
        });
        await insertWebhookEventLog({
          eventType: payload.type,
          triggerSlug,
          payloadMetadata: payload.metadata ?? undefined,
          resolvedUserId: result.userId,
          handlerBranch: "calendar_sync",
          processingSteps: [
            {
              step: "calendar_sync",
              ok: true,
              detail: `processed=${result.processed} stored=${result.stored}`,
            },
            {
              step: "todo_dispatch",
              ok: true,
              detail: `taskId=${dispatchResult.taskId} reused=${dispatchResult.reused}`,
            },
            {
              step: "vault_dispatch",
              ok: true,
              detail: `taskId=${vaultResult.taskId} reused=${vaultResult.reused}`,
            },
          ] as Json,
          result: {
            calendar: { processed: result.processed, stored: result.stored },
            dispatch: {
              taskId: dispatchResult.taskId,
              reused: dispatchResult.reused,
            },
            vault: {
              taskId: vaultResult.taskId,
              reused: vaultResult.reused,
              externalIds: event.event_id ? [event.event_id] : undefined,
            },
          },
          httpStatus: 200,
        });
        return NextResponse.json({
          status: "ok",
          trigger: triggerSlug,
          ...result,
        });
      }
    }

    // Resolve our app's user_id only from DB (by connected_account_id).
    // payload.metadata?.user_id is Composio's internal user id — must not be used for tasks (FK to users).
    userId = payload.metadata?.connected_account_id
      ? (
          await findIntegrationByConnectedAccountId(
            supabase,
            String(payload.metadata.connected_account_id),
          )
        )?.user_id
      : undefined;

    // Only SENT (user sent email) triggers resolve — check if related tasks are done.
    // All other Gmail triggers (e.g. GMAIL_NEW_GMAIL_MESSAGE) trigger todo merge only.
    if (triggerSlug === GMAIL_EMAIL_SENT_TRIGGER && userId) {
      const eventData = payload.data as unknown as GmailSentEventPayload;
      const result = await resolveGmailReply(supabase, userId, eventData);
      await insertWebhookEventLog({
        eventType: payload.type,
        triggerSlug,
        payloadMetadata: payload.metadata ?? undefined,
        resolvedUserId: userId,
        handlerBranch: "gmail_sent",
        processingSteps: [
          {
            step: "resolve_gmail_reply",
            ok: result.errors.length === 0,
            detail: `processed=${result.processed} updated=${result.updated}`,
          },
          ...(result.diagnostics
            ? [
                {
                  step: "diagnostics",
                  ok: true,
                  detail: JSON.stringify(result.diagnostics).slice(0, 4000),
                },
              ]
            : []),
        ] as Json,
        result: {
          gmail: {
            processed: result.processed,
            updated: result.updated,
            errors: result.errors,
            diagnostics: result.diagnostics ?? null,
          },
        },
        errorMessage:
          result.errors.length > 0 ? result.errors.join("; ") : null,
        httpStatus: 200,
      });
      return NextResponse.json({
        status: "ok",
        trigger: triggerSlug,
        userId,
        ...result,
      });
    }

    if (userId) {
      if (!(await userExistsInDb(userId))) {
        console.warn(
          `[composio/webhook] Skipping task dispatch: user ${userId} not found in users table (FK guard)`,
        );
        await insertWebhookEventLog({
          eventType: payload.type,
          triggerSlug,
          payloadMetadata: payload.metadata ?? undefined,
          resolvedUserId: userId,
          handlerBranch: "gmail_new_or_calendar_todo",
          errorMessage: "User not in users table, skipped dispatch",
          httpStatus: 200,
        });
        return NextResponse.json({
          status: "ok",
          trigger: triggerSlug,
          userId,
          skipped: "user_not_found",
        });
      }
      const gmailData = payload.data as Record<string, unknown> | undefined;
      const signalHints = gmailData
        ? [
            {
              threadId: gmailData.thread_id as string | undefined,
              messageId: gmailData.message_id as string | undefined,
              subject: gmailData.subject as string | undefined,
            },
          ]
        : undefined;
      const dispatchResult = await dispatchTodoGenerationTask(userId, {
        source: `system.webhook.composio.${triggerSlug.split("_")[0].toLowerCase()}`,
        date: new Date().toISOString().split("T")[0],
        incremental: true,
        cooldownMinutes: 2,
        signalHints,
      });
      const vaultResult = await dispatchVaultSyncTask(userId, {
        source: `system.webhook.composio.${triggerSlug.split("_")[0].toLowerCase()}`,
        incremental: true,
        cooldownMinutes: 10,
      });
      await insertWebhookEventLog({
        eventType: payload.type,
        triggerSlug,
        payloadMetadata: payload.metadata ?? undefined,
        resolvedUserId: userId,
        handlerBranch: "gmail_new_or_calendar_todo",
        processingSteps: [
          {
            step: "todo_dispatch",
            ok: true,
            detail: `taskId=${dispatchResult.taskId} reused=${dispatchResult.reused}`,
          },
          {
            step: "vault_dispatch",
            ok: true,
            detail: `taskId=${vaultResult.taskId} reused=${vaultResult.reused}`,
          },
        ] as Json,
        result: {
          dispatch: {
            taskId: dispatchResult.taskId,
            reused: dispatchResult.reused,
          },
          vault: {
            taskId: vaultResult.taskId,
            reused: vaultResult.reused,
          },
        },
        httpStatus: 200,
      });
    } else {
      await insertWebhookEventLog({
        eventType: payload.type,
        triggerSlug,
        payloadMetadata: payload.metadata ?? undefined,
        resolvedUserId: null,
        handlerBranch: "gmail_new_or_calendar_todo",
        errorMessage:
          "userId not resolved (no integration for connected_account_id)",
        httpStatus: 200,
      });
    }

    return NextResponse.json({
      status: "ok",
      trigger: triggerSlug,
      userId: userId ?? null,
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[composio/webhook] Handler error:", error);
    await insertWebhookEventLog({
      eventType: payload?.type ?? null,
      triggerSlug: payload?.metadata?.trigger_slug ?? null,
      payloadMetadata: payload?.metadata ?? undefined,
      handlerBranch: "handler_error",
      errorMessage: err.message,
      httpStatus: 500,
    });
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
