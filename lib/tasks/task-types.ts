export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface TaskRow {
  id: string;
  parent_task_id: string | null;
  user_id: string;
  session_id: string;
  task_type: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: TaskStatus;
  retry_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  parentTaskId: string | null;
  userId: string;
  sessionId: string;
  taskType: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: TaskStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInsert {
  parent_task_id?: string | null;
  user_id: string;
  session_id: string;
  task_type: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  status?: TaskStatus;
  retry_count?: number;
  last_error?: string | null;
}

export interface TaskExecutionResult {
  output: Record<string, unknown>;
  nextTasks?: TaskInsert[];
}
