import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { TaskInsert, TaskRow, TaskStatus } from "./task-types";

export async function enqueueTask(
  client: SupabaseClient<Database>,
  task: TaskInsert,
): Promise<TaskRow> {
  const { data, error } = await client
    .from("tasks")
    .insert({
      ...task,
      status: task.status ?? "pending",
      retry_count: task.retry_count ?? 0,
    })
    .select()
    .single();

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

  const { data, error } = await client
    .from("tasks")
    .insert(
      tasks.map((task) => ({
        ...task,
        status: task.status ?? "pending",
        retry_count: task.retry_count ?? 0,
      })),
    )
    .select();

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
  // Cast Record<string, unknown> to Json for database insert
  const outputJson: Json = output as Json;

  const { data, error } = await client
    .from("tasks")
    .update({
      status: "completed" as TaskStatus,
      output: outputJson,
      last_error: null,
    })
    .eq("id", taskId)
    .select()
    .single();

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
  const { data, error } = await client
    .from("tasks")
    .update({
      status: params.status,
      retry_count: params.retryCount,
      last_error: params.lastError,
    })
    .eq("id", taskId)
    .select()
    .single();

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
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (error || !data) {
    return null;
  }

  return data as TaskRow;
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
