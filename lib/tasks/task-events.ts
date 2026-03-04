import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type {
  TaskEvent,
  TaskEventInsert,
  TaskEventType,
} from "@/types/database";
import * as db from "@/lib/supabase/db";

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

function buildEventKey(
  eventType: string,
  nodeKey?: string | null,
  eventKeySuffix?: string,
): string {
  const normalizedNodeKey = nodeKey ?? "job";
  if (!eventKeySuffix) return `${eventType}:${normalizedNodeKey}`;
  return `${eventType}:${normalizedNodeKey}:${eventKeySuffix}`;
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
    eventKeySuffix?: string;
  },
): Promise<TaskEvent | null> {
  const eventKey = buildEventKey(
    params.eventType,
    params.nodeKey,
    params.eventKeySuffix,
  );
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

  const result = await db.insertOne(client, "task_events", insert, {
    returnRawError: true,
  });

  const rawError = "rawError" in result ? result.rawError : null;
  if (rawError?.code === "23505") {
    return null;
  }

  if (result.error || !result.data) {
    throw new Error(
      `Failed to create task event: ${result.error?.message ?? "Unknown error"}`,
    );
  }

  return result.data as TaskEvent;
}

export async function fetchTaskEventsBySession(
  client: SupabaseClient<Database>,
  sessionId: string,
  userId: string,
): Promise<TaskEventRecord[]> {
  const { data, error } = await db.selectMany(
    client,
    "task_events",
    { session_id: sessionId, user_id: userId },
    { order: { column: "created_at", ascending: true } },
  );

  if (error) {
    throw new Error(`Failed to fetch task events: ${error.message}`);
  }

  return (data ?? []).map((row) => toTaskEventRecord(row as TaskEvent));
}

export { toTaskEventRecord };
