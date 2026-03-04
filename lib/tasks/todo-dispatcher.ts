import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { enqueueTask } from "@/lib/tasks/task-repository";
import { triggerTask } from "@/lib/tasks/task-processor";
import type { TaskRow } from "@/lib/tasks/task-types";
import type { Json } from "@/types/supabase";

export interface DispatchTodoTaskOptions {
  source?: string;
  date?: string;
  /** Full regenerate (overwrite snapshot). If false and incremental true, merge only new tasks. */
  force?: boolean;
  /** When true, add only new tasks from integrations (no overwrite). Use for webhook/sync. */
  incremental?: boolean;
  sessionId?: string;
  cooldownMinutes?: number;
}

async function findRecentTodoTask(
  userId: string,
  date: string,
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
      task_type: "insights.generate_todo_list",
      status: ["pending", "in_progress"],
    },
    {
      rangeFilters: { created_at: { gte: cutoff } },
      order: { column: "created_at", ascending: false },
      limit: 1,
    },
  );

  const row = data[0];
  if (!row) return null;

  const input = (row as TaskRow).input as { state?: { date?: string } } | null;
  if (input?.state?.date !== date) return null;

  return row as TaskRow;
}

export async function dispatchTodoGenerationTask(
  userId: string,
  options: DispatchTodoTaskOptions = {},
): Promise<{ taskId: string; reused: boolean }> {
  const date = options.date ?? new Date().toISOString().split("T")[0];
  const cooldownMinutes = options.cooldownMinutes ?? 5;

  const existing = await findRecentTodoTask(userId, date, cooldownMinutes);
  if (existing) {
    return { taskId: existing.id, reused: true };
  }

  const client = createAdminClient();
  const incremental = options.incremental ?? false;
  const force = options.force ?? !incremental;

  const task = await enqueueTask(client, {
    user_id: userId,
    session_id: options.sessionId ?? `system:todos:${userId}`,
    task_type: "insights.generate_todo_list",
    status: "pending",
    input: {
      state: {
        userId,
        date,
        force,
        incremental,
        generatedFromEvent: options.source ?? "system.unknown",
      },
    } as Json,
  });

  triggerTask(task.id);
  return { taskId: task.id, reused: false };
}
