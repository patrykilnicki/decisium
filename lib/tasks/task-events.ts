import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type {
  TaskEvent,
  TaskEventInsert,
  TaskEventType,
} from "@/types/database";

export type { TaskEvent as TaskEventRow, TaskEventInsert, TaskEventType };

export interface TaskEventRecord {
  id: string;
  taskId: string;
  sessionId: string;
  userId: string;
  eventType: TaskEventType;
  nodeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

function buildEventKey(eventType: string, nodeKey?: string | null): string {
  const normalizedNodeKey = nodeKey ?? "job";
  return `${eventType}:${normalizedNodeKey}`;
}

function toTaskEventRecord(row: TaskEvent): TaskEventRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    userId: row.user_id,
    eventType: row.event_type,
    nodeKey: row.node_key ?? null,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    createdAt: row.created_at ?? "",
  };
}

export async function createTaskEvent(
  client: SupabaseClient<Database>,
  params: {
    taskId: string;
    sessionId: string;
    userId: string;
    eventType: TaskEventType;
    nodeKey?: string | null;
    payload?: Record<string, unknown> | null;
  },
): Promise<TaskEvent | null> {
  const eventKey = buildEventKey(params.eventType, params.nodeKey);
  const payloadJson: Json = (params.payload ?? {}) as Json;
  const insert: TaskEventInsert = {
    task_id: params.taskId,
    session_id: params.sessionId,
    user_id: params.userId,
    event_type: params.eventType,
    node_key: params.nodeKey ?? null,
    event_key: eventKey,
    payload: payloadJson,
  };

  const { data, error } = await client
    .from("task_events")
    .insert(insert)
    .select()
    .single();

  if (error?.code === "23505") {
    return null;
  }

  if (error || !data) {
    throw new Error(
      `Failed to create task event: ${error?.message ?? "Unknown error"}`,
    );
  }

  return data as TaskEvent;
}

export async function fetchTaskEventsBySession(
  client: SupabaseClient<Database>,
  sessionId: string,
  userId: string,
): Promise<TaskEventRecord[]> {
  const { data, error } = await client
    .from("task_events")
    .select("*")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch task events: ${error.message}`);
  }

  return (data ?? []).map((row) => toTaskEventRecord(row as TaskEvent));
}

export { toTaskEventRecord };
