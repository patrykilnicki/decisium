import "@/lib/suppress-url-parse-deprecation";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchTaskById,
  enqueueTasks,
  updateTaskFailure,
  updateTaskSuccess,
} from "@/lib/tasks/task-repository";
import { handleTask } from "@/packages/workers/langgraph-handlers";

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Process a single task by ID. Used for immediate processing after enqueueing.
 * Returns true if successful, false if failed (and will be retried by cron).
 */
export async function processTaskById(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  process.env.TASK_WORKER = "true";

  const client = createAdminClient();
  const maxRetries = getNumberEnv("TASK_MAX_RETRIES", 3);

  // Fetch the task
  const task = await fetchTaskById(client, taskId);
  if (!task) {
    return { ok: false, error: "Task not found" };
  }

  // If already claimed/processing, skip (another process is handling it)
  if (task.status === "in_progress") {
    return { ok: true }; // Already being processed
  }

  // If not pending, skip
  if (task.status !== "pending") {
    return { ok: true }; // Already completed or failed
  }

  try {
    const result = await handleTask(task);
    if (result.nextTasks?.length) {
      const inserted = await enqueueTasks(client, result.nextTasks);
      // Trigger next tasks immediately so the chain continues without waiting for cron
      for (const nextTask of inserted) {
        processTaskImmediately(nextTask.id);
      }
    }
    await updateTaskSuccess(client, task.id, result.output);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextRetryCount = task.retry_count + 1;
    const shouldRetry = nextRetryCount <= maxRetries;
    const status = shouldRetry ? "pending" : "failed";
    await updateTaskFailure(client, task.id, {
      status,
      retryCount: nextRetryCount,
      lastError: message,
    });
    return { ok: false, error: message };
  }
}

/**
 * Process a task immediately in the background (fire-and-forget).
 * Does not await - returns immediately so HTTP response isn't blocked.
 * Errors are logged but don't affect the response.
 */
export function processTaskImmediately(taskId: string): void {
  // Fire-and-forget: don't await, don't block the HTTP response
  processTaskById(taskId).catch((error) => {
    console.error(
      `[processTaskImmediately] Failed to process task ${taskId}:`,
      error,
    );
    // Task will be picked up by cron if this fails
  });
}
