import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskInsert, TaskRecord, TaskRow, TaskStatus } from "./task-types";

function toTaskRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    parentTaskId: row.parent_task_id,
    userId: row.user_id,
    sessionId: row.session_id,
    taskType: row.task_type,
    input: row.input ?? {},
    output: row.output ?? null,
    status: row.status,
    retryCount: row.retry_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function enqueueTask(
  client: SupabaseClient,
  task: TaskInsert
): Promise<TaskRow> {
  const { data, error } = await client
    .from("tasks")
    .insert({
      status: "pending",
      retry_count: 0,
      ...task,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue task: ${error?.message ?? "Unknown error"}`);
  }

  return data as TaskRow;
}

export async function enqueueTasks(
  client: SupabaseClient,
  tasks: TaskInsert[]
): Promise<TaskRow[]> {
  if (tasks.length === 0) return [];

  const { data, error } = await client
    .from("tasks")
    .insert(tasks.map((task) => ({
      status: "pending",
      retry_count: 0,
      ...task,
    })))
    .select();

  if (error || !data) {
    throw new Error(`Failed to enqueue tasks: ${error?.message ?? "Unknown error"}`);
  }

  return data as TaskRow[];
}

export async function claimTasks(
  client: SupabaseClient,
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
  client: SupabaseClient,
  taskId: string,
  output: Record<string, unknown>
): Promise<TaskRow> {
  const { data, error } = await client
    .from("tasks")
    .update({
      status: "completed" as TaskStatus,
      output,
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
  client: SupabaseClient,
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
  client: SupabaseClient,
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
