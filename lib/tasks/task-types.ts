import type { Task, TaskInsert, TaskStatus } from "@/types/database";

// Re-export types from database.ts for convenience
export type { Task as TaskRow, TaskInsert, TaskStatus };

// TaskRecord is a transformed type (camelCase) - keep it local
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

export interface TaskExecutionResult {
  output: Record<string, unknown>;
  nextTasks?: TaskInsert[];
}
