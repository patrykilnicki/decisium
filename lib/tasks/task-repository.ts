import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { TaskInsert, TaskRecord, TaskRow, TaskStatus } from "./task-types";

function toTaskRecord(row: TaskRow): TaskRecord {
  // Cast Json types to Record<string, unknown> for domain model
  const input = (row.input ?? {}) as Record<string, unknown>;
  const output = row.output ? (row.output as Record<string, unknown>) : null;
  
  return {
    id: row.id,
    parentTaskId: row.parent_task_id,
    userId: row.user_id,
    sessionId: row.session_id,
    taskType: row.task_type,
    input,
    output,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
    createdAt: row.created_at ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

export async function enqueueTask(
  client: SupabaseClient<Database>,
  task: TaskInsert
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
    throw new Error(`Failed to enqueue task: ${error?.message ?? "Unknown error"}`);
  }

  return data as TaskRow;
}

export async function enqueueTasks(
  client: SupabaseClient<Database>,
  tasks: TaskInsert[]
): Promise<TaskRow[]> {
  if (tasks.length === 0) return [];

  const { data, error } = await client
    .from("tasks")
    .insert(tasks.map((task) => ({
      ...task,
      status: task.status ?? "pending",
      retry_count: task.retry_count ?? 0,
    })))
    .select();

  if (error || !data) {
    throw new Error(`Failed to enqueue tasks: ${error?.message ?? "Unknown error"}`);
  }

  return data as TaskRow[];
}

export async function claimTasks(
  client: SupabaseClient<Database>,
  options: { maxTasks: number; staleAfterSeconds: number }
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
  output: Record<string, unknown>
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
    throw new Error(`Failed to mark task complete: ${error?.message ?? "Unknown error"}`);
  }

  return data as TaskRow;
}

export async function updateTaskFailure(
  client: SupabaseClient<Database>,
  taskId: string,
  params: { status: TaskStatus; retryCount: number; lastError: string }
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
    throw new Error(`Failed to mark task failed: ${error?.message ?? "Unknown error"}`);
  }

  return data as TaskRow;
}

export async function fetchTasksBySession(
  client: SupabaseClient<Database>,
  sessionId: string,
  userId: string
): Promise<TaskRecord[]> {
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch tasks: ${error.message}`);
  }

  return (data ?? []).map((row) => toTaskRecord(row as TaskRow));
}

export { toTaskRecord };
