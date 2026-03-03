import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import * as db from "@/lib/supabase/db";
import type { TaskInsert, TaskRow, TaskStatus } from "./task-types";

export async function enqueueTask(
  client: SupabaseClient<Database>,
  task: TaskInsert,
): Promise<TaskRow> {
  const { data, error } = await db.insertOne(client, "tasks", {
    ...task,
    status: task.status ?? "pending",
    retry_count: task.retry_count ?? 0,
  });

  if (error || !data) {
    throw new Error(
      `Failed to enqueue task: ${error?.message ?? "Unknown error"}`,
    );
  }

  return data as TaskRow;
}

export async function enqueueTasks(
  client: SupabaseClient<Database>,
  tasks: TaskInsert[],
): Promise<TaskRow[]> {
  if (tasks.length === 0) return [];

  const { data, error } = await db.insertMany(
    client,
    "tasks",
    tasks.map((task) => ({
      ...task,
      status: task.status ?? "pending",
      retry_count: task.retry_count ?? 0,
    })),
  );

  if (error || !data) {
    throw new Error(
      `Failed to enqueue tasks: ${error?.message ?? "Unknown error"}`,
    );
  }

  return data as TaskRow[];
}

export async function claimTasks(
  client: SupabaseClient<Database>,
  options: { maxTasks: number; staleAfterSeconds: number },
): Promise<TaskRow[]> {
  const { data, error } = await client.rpc("claim_tasks", {
    max_tasks: options.maxTasks,
    stale_after_seconds: options.staleAfterSeconds,
  });

  if (error) {
    throw new Error(`Failed to claim tasks: ${error.message}`);
  }

  return (data ?? []) as TaskRow[];
}

export async function updateTaskSuccess(
  client: SupabaseClient<Database>,
  taskId: string,
  output: Record<string, unknown>,
): Promise<TaskRow> {
  const { data, error } = await db.update(
    client,
    "tasks",
    { id: taskId },
    {
      status: "completed" as TaskStatus,
      output: output as Json,
      last_error: null,
    },
    { returning: "single" },
  );

  if (error || !data) {
    throw new Error(
      `Failed to mark task complete: ${error?.message ?? "Unknown error"}`,
    );
  }

  return data as TaskRow;
}

export async function updateTaskFailure(
  client: SupabaseClient<Database>,
  taskId: string,
  params: { status: TaskStatus; retryCount: number; lastError: string },
): Promise<TaskRow> {
  const { data, error } = await db.update(
    client,
    "tasks",
    { id: taskId },
    {
      status: params.status,
      retry_count: params.retryCount,
      last_error: params.lastError,
    },
    { returning: "single" },
  );

  if (error || !data) {
    throw new Error(
      `Failed to mark task failed: ${error?.message ?? "Unknown error"}`,
    );
  }

  return data as TaskRow;
}

export async function fetchTaskById(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<TaskRow | null> {
  const { data } = await db.selectOne(client, "tasks", { id: taskId });
  return data as TaskRow | null;
}

/**
 * Atomically claim a pending task (set status to in_progress).
 * Returns the task row if claimed, null if already in_progress/completed/failed or not found.
 * Prevents the same task from being run by both processTaskImmediately and the worker.
 */
export async function claimTaskById(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<TaskRow | null> {
  const { data } = await db.update(
    client,
    "tasks",
    { id: taskId, status: "pending" },
    { status: "in_progress" as TaskStatus },
    { returning: "single" },
  );
  return data as TaskRow | null;
}

export async function resolveRootTaskId(
  client: SupabaseClient<Database>,
  taskId: string,
): Promise<string> {
  let currentTaskId = taskId;
  let currentTask = await fetchTaskById(client, currentTaskId);

  while (currentTask?.parent_task_id) {
    currentTaskId = currentTask.parent_task_id;
    const parent = await fetchTaskById(client, currentTaskId);
    if (!parent) break;
    currentTask = parent;
  }

  return currentTask?.id ?? taskId;
}
