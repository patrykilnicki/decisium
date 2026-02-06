import { AsyncLocalStorage } from "node:async_hooks";

export interface TaskRunContext {
  userId: string;
  sessionId: string;
  taskId: string;
  taskType: string;
  nodeKey: string;
  jobId: string;
}

const taskContextStore = new AsyncLocalStorage<TaskRunContext>();

export function getTaskContext(): TaskRunContext | undefined {
  return taskContextStore.getStore();
}

export function runWithTaskContext<T>(
  context: TaskRunContext,
  handler: () => Promise<T> | T,
): Promise<T> | T {
  return taskContextStore.run(context, handler);
}
