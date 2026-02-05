import type { Task, TaskInsert, TaskStatus } from "@/types/database";

// Re-export types from database.ts for convenience
export type { Task as TaskRow, TaskInsert, TaskStatus };

export interface TaskExecutionResult {
  output: Record<string, unknown>;
  nextTasks?: TaskInsert[];
}
