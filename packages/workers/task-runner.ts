import dotenv from "dotenv";
import type { TaskRow } from "@/lib/tasks/task-types";

dotenv.config({ path: ".env.local" });
dotenv.config();
process.env.TASK_WORKER = "true";

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processTask(
  client: Awaited<
    ReturnType<(typeof import("@/lib/supabase/admin"))["createAdminClient"]>
  >,
  task: TaskRow,
  maxRetries: number,
) {
  const {
    enqueueTasks,
    resolveRootTaskId,
    updateTaskFailure,
    updateTaskSuccess,
  } = await import("@/lib/tasks/task-repository");
  const { handleTask } = await import("@/packages/workers/langgraph-handlers");
  const { createTaskEvent } = await import("@/lib/tasks/task-events");

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
      await enqueueTasks(client, result.nextTasks);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
  }
}

async function runWorker() {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { claimTasks } = await import("@/lib/tasks/task-repository");

  const client = createAdminClient();
  const pollIntervalMs = getNumberEnv("TASK_POLL_INTERVAL_MS", 1500);
  const maxTasks = getNumberEnv("TASK_MAX_CLAIM", 5);
  const staleAfterSeconds = getNumberEnv("TASK_STALE_AFTER_SECONDS", 300);
  const maxRetries = getNumberEnv("TASK_MAX_RETRIES", 3);

  while (true) {
    try {
      const tasks = await claimTasks(client, {
        maxTasks,
        staleAfterSeconds,
      });

      if (tasks.length === 0) {
        await sleep(pollIntervalMs);
        continue;
      }

      await Promise.all(
        tasks.map((task) => processTask(client, task, maxRetries)),
      );
    } catch (error) {
      console.error("[task-runner] Worker loop error:", error);
      await sleep(pollIntervalMs);
    }
  }
}

runWorker().catch((error) => {
  console.error("[task-runner] Fatal worker error:", error);
  process.exit(1);
});
