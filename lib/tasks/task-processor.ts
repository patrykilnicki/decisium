import "@/lib/suppress-url-parse-deprecation";

import { createAdminClient } from "@/lib/supabase/admin";
import type { TaskRow } from "@/lib/tasks/task-types";
import {
  claimTaskById,
  enqueueTasks,
  resolveRootTaskId,
  updateTaskFailure,
  updateTaskSuccess,
} from "@/lib/tasks/task-repository";
import { createTaskEvent } from "@/lib/tasks/task-events";
import { handleTask } from "@/packages/workers/langgraph-handlers";

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Base URL for self-calls (e.g. Vercel: https://app.vercel.app). When set with CRON_SECRET,
 * we trigger next tasks via HTTP so a new serverless invocation runs them (avoids work
 * being killed when the current invocation ends).
 */
function getProcessTaskBaseUrl(): string | null {
  const url = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null);
  return url && process.env.CRON_SECRET ? url : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function buildJobPayload(params: {
  jobId: string;
  taskId: string;
  sessionId: string;
  taskType: string;
}): Record<string, unknown> {
  return {
    jobId: params.jobId,
    taskId: params.taskId,
    sessionId: params.sessionId,
    taskType: params.taskType,
  };
}

/**
 * Trigger task execution. On serverless (VERCEL_URL + CRON_SECRET), calls
 * POST /api/tasks/[taskId]/process so a new invocation runs the task.
 * Otherwise runs in-process (e.g. local dev). Use for both the first task
 * (from actions) and the next task in chain (trigger-driven, no CRON needed).
 */
export function triggerTask(taskId: string): void {
  const baseUrl = getProcessTaskBaseUrl();
  if (baseUrl) {
    const secret = process.env.CRON_SECRET;
    void (async () => {
      try {
        const response = await fetch(`${baseUrl}/api/tasks/${taskId}/process`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
          },
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          console.error(
            `[triggerTask] Failed to trigger task ${taskId}: ${response.status} ${response.statusText} ${body}`,
          );
        }
      } catch (err) {
        console.error(`[triggerTask] Failed to trigger task ${taskId}:`, err);
      }
    })();
    return;
  }
  processTaskImmediately(taskId);
}

function triggerNextTask(taskId: string): void {
  triggerTask(taskId);
}

/**
 * Process a single task by ID. Used for immediate processing after enqueueing,
 * or by cron/worker when they already claimed the task via claim_tasks.
 * Returns true if successful, false if failed (and will be retried by cron).
 */
export async function processTaskById(
  taskId: string,
  options?: { alreadyClaimedTask?: TaskRow },
): Promise<{ ok: boolean; error?: string }> {
  process.env.TASK_WORKER = "true";

  const client = createAdminClient();
  const maxRetries = getNumberEnv("TASK_MAX_RETRIES", 3);

  let task: TaskRow | null;
  if (options?.alreadyClaimedTask) {
    task = options.alreadyClaimedTask;
  } else {
    // Atomically claim the task (pending -> in_progress). Prevents double execution
    // when both processTaskImmediately and the worker could pick the same task.
    task = await claimTaskById(client, taskId);
  }
  if (!task) {
    return { ok: true }; // Already claimed, completed, failed, or not found
  }

  try {
    const jobId = await resolveRootTaskId(client, task.id);
    if (!task.parent_task_id) {
      await createTaskEvent(client, {
        taskId: task.id,
        sessionId: task.session_id,
        userId: task.user_id,
        eventType: "job_started",
        nodeKey: "job",
        payload: buildJobPayload({
          jobId,
          taskId: task.id,
          sessionId: task.session_id,
          taskType: task.task_type,
        }),
      });
    }

    const result = await handleTask(task, { jobId });
    if (result.nextTasks?.length) {
      const inserted = await enqueueTasks(client, result.nextTasks);
      // Trigger next tasks: via HTTP on serverless (new invocation) or in-process locally
      for (const nextTask of inserted) {
        triggerNextTask(nextTask.id);
      }
    } else {
      await createTaskEvent(client, {
        taskId: task.id,
        sessionId: task.session_id,
        userId: task.user_id,
        eventType: "job_completed",
        nodeKey: "job",
        payload: buildJobPayload({
          jobId,
          taskId: task.id,
          sessionId: task.session_id,
          taskType: task.task_type,
        }),
      });
    }
    await updateTaskSuccess(client, task.id, result.output);
    return { ok: true };
  } catch (error) {
    const message = getErrorMessage(error);
    const jobId = await resolveRootTaskId(client, task.id);
    await createTaskEvent(client, {
      taskId: task.id,
      sessionId: task.session_id,
      userId: task.user_id,
      eventType: "job_failed",
      nodeKey: "job",
      payload: {
        ...buildJobPayload({
          jobId,
          taskId: task.id,
          sessionId: task.session_id,
          taskType: task.task_type,
        }),
        error: message,
      },
    });
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
