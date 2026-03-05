import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { enqueueTask } from "@/lib/tasks/task-repository";
import { triggerTask } from "@/lib/tasks/task-processor";
import type { TaskRow } from "@/lib/tasks/task-types";
import type { Json } from "@/types/supabase";

export interface DispatchVaultTaskOptions {
  source?: string;
  sinceAt?: string;
  cooldownMinutes?: number;
  incremental?: boolean;
  sessionId?: string;
  /** Event external IDs (e.g. from webhook) — vault agent will process only these atoms. */
  externalIds?: string[];
}

async function findRecentVaultTask(
  userId: string,
  cooldownMinutes: number,
): Promise<TaskRow | null> {
  const client = createAdminClient();
  const cutoff = new Date(
    Date.now() - cooldownMinutes * 60 * 1000,
  ).toISOString();

  const { data } = await db.selectMany(
    client,
    "tasks",
    {
      user_id: userId,
      task_type: "vault.sync_from_events",
      status: ["pending", "in_progress"],
    },
    {
      rangeFilters: { created_at: { gte: cutoff } },
      order: { column: "created_at", ascending: false },
      limit: 1,
    },
  );

  return (data[0] as TaskRow) ?? null;
}

export async function dispatchVaultSyncTask(
  userId: string,
  options: DispatchVaultTaskOptions = {},
): Promise<{ taskId: string; reused: boolean }> {
  const cooldownMinutes = options.cooldownMinutes ?? 10;

  const existing = await findRecentVaultTask(userId, cooldownMinutes);
  if (existing) {
    return { taskId: existing.id, reused: true };
  }

  const client = createAdminClient();
  const incremental = options.incremental ?? true;

  const task = await enqueueTask(client, {
    user_id: userId,
    session_id: options.sessionId ?? `system:vault:${userId}`,
    task_type: "vault.sync_from_events",
    status: "pending",
    input: {
      state: {
        userId,
        sinceAt: options.sinceAt ?? null,
        incremental,
        generatedFromEvent: options.source ?? "system.unknown",
        externalIds: options.externalIds ?? undefined,
      },
    } as Json,
  });

  triggerTask(task.id);
  return { taskId: task.id, reused: false };
}
