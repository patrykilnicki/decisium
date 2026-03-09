import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { dispatchTodoGenerationTask } from "@/lib/tasks/todo-dispatcher";
import { dispatchVaultSyncTask } from "@/lib/tasks/vault-dispatcher";
import {
  resolveUserIdFromWebhookLog,
  type WebhookLogRow,
} from "@/lib/integrations/composio-webhook";

/**
 * Replay Composio webhook effect for a user: dispatch todo + vault tasks.
 * For internal use only (e.g. your other app). Not exposed to end users.
 *
 * Auth: POST with header Authorization: Bearer <WEBHOOK_REPLAY_SECRET>
 *
 * Body (one of):
 *   - { logId: string }  → resolve user from composio_webhook_event_logs (resolved_user_id or connected_account_id)
 *   - { userId: string } → use this user id directly
 *
 * Returns: { ok: true, userId, todo: { taskId, reused }, vault: { taskId, reused } }
 */
export async function POST(request: NextRequest) {
  const secret = process.env.WEBHOOK_REPLAY_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { logId?: string; userId?: string };
  try {
    body = (await request.json()) as { logId?: string; userId?: string };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Use { logId?: string, userId?: string }" },
      { status: 400 },
    );
  }

  const { logId, userId: bodyUserId } = body;
  if (!logId && !bodyUserId) {
    return NextResponse.json(
      { error: "Provide either logId or userId in body" },
      { status: 400 },
    );
  }

  const client = createAdminClient();
  let userId: string | null = bodyUserId ?? null;

  if (logId && !userId) {
    const { data: logRow, error } = await db.selectOne(
      client,
      "composio_webhook_event_logs",
      { id: logId },
    );

    if (error || !logRow) {
      return NextResponse.json(
        { error: "Webhook log not found", logId },
        { status: 404 },
      );
    }

    const log: WebhookLogRow = {
      id: logRow.id,
      resolved_user_id: logRow.resolved_user_id,
      payload_metadata: (logRow.payload_metadata ?? {}) as Record<
        string,
        unknown
      >,
    };
    userId = await resolveUserIdFromWebhookLog(client, log);

    if (!userId) {
      return NextResponse.json(
        {
          error:
            "Could not resolve user from log (no resolved_user_id and no integration for connected_account_id)",
          logId,
        },
        { status: 400 },
      );
    }
  }

  const date = new Date().toISOString().split("T")[0];

  const todoResult = await dispatchTodoGenerationTask(userId, {
    source: "system.replay",
    date,
    incremental: true,
    cooldownMinutes: 0,
    sessionId: `system:replay:${userId}`,
  });

  const vaultResult = await dispatchVaultSyncTask(userId, {
    source: "system.replay",
    incremental: true,
    cooldownMinutes: 0,
    sessionId: `system:replay:${userId}`,
  });

  return NextResponse.json({
    ok: true,
    userId,
    todo: { taskId: todoResult.taskId, reused: todoResult.reused },
    vault: { taskId: vaultResult.taskId, reused: vaultResult.reused },
  });
}
