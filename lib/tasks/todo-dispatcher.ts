import { createAdminClient } from "@/lib/supabase/admin";
import { enqueueTask } from "@/lib/tasks/task-repository";
import { triggerTask } from "@/lib/tasks/task-processor";
import type { TaskRow } from "@/lib/tasks/task-types";
import type { Json } from "@/types/supabase";

export interface DispatchTodoTaskOptions {
  source?: string;
  date?: string;
  force?: boolean;
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

  const { data } = await client
    .from("tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("task_type", "insights.generate_todo_list")
    .in("status", ["pending", "in_progress"])
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const input = data.input as { state?: { date?: string } } | null;
  if (input?.state?.date !== date) return null;

  return data as TaskRow;
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
  const task = await enqueueTask(client, {
    user_id: userId,
    session_id: options.sessionId ?? `system:todos:${userId}`,
    task_type: "insights.generate_todo_list",
    status: "pending",
    input: {
      state: {
        userId,
        date,
        force: options.force ?? true,
        generatedFromEvent: options.source ?? "system.unknown",
      },
    } as Json,
  });

  triggerTask(task.id);
  return { taskId: task.id, reused: false };
}
