import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  claimTasks,
  enqueueTasks,
  updateTaskFailure,
  updateTaskSuccess,
} from "@/lib/tasks/task-repository";
import type { TaskRow } from "@/lib/tasks/task-types";
import { handleTask } from "@/packages/workers/langgraph-handlers";

/**
 * Vercel Cron invokes this route every minute to process pending tasks
 * (Daily and Ask AI agent responses). No separate long-running worker needed.
 */

function isCronAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = vercelCronHeader === "1";
  const isValidAuth = Boolean(
    cronSecret && authHeader === `Bearer ${cronSecret}`,
  );
  return isVercelCron || isValidAuth;
}

function getNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

async function processOneTask(
  task: TaskRow,
  maxRetries: number,
): Promise<{ ok: boolean }> {
  const client = createAdminClient();
  try {
    const result = await handleTask(task);
    if (result.nextTasks?.length) {
      await enqueueTasks(client, result.nextTasks);
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
    return { ok: false };
  }
}

async function runProcessTasks(triggeredBy: string) {
  process.env.TASK_WORKER = "true";

  const client = createAdminClient();
  const maxTasks = getNumberEnv("TASK_MAX_CLAIM", 5);
  const staleAfterSeconds = getNumberEnv("TASK_STALE_AFTER_SECONDS", 300);
  const maxRetries = getNumberEnv("TASK_MAX_RETRIES", 3);

  const tasks = await claimTasks(client, {
    maxTasks,
    staleAfterSeconds,
  });

  if (tasks.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      message: "No pending tasks",
      triggeredBy,
    });
  }

  let completed = 0;
  let failed = 0;
  for (const task of tasks) {
    const { ok } = await processOneTask(task, maxRetries);
    if (ok) completed++;
    else failed++;
  }

  return NextResponse.json({
    success: true,
    processed: tasks.length,
    completed,
    failed,
    triggeredBy,
  });
}

/**
 * GET - Vercel Cron invokes with GET. Process one batch when authorized.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json(
      {
        status: "ok",
        endpoint: "/api/cron/process-tasks",
        description:
          "Processes pending agent tasks (Daily / Ask AI). Runs every 1 min via Vercel Cron. Use POST with Authorization: Bearer CRON_SECRET to run manually.",
      },
      { status: 200 },
    );
  }

  try {
    return await runProcessTasks("Vercel Cron GET");
  } catch (error) {
    console.error("[process-tasks] Cron run error:", error);
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message, triggeredBy: "Vercel Cron GET" },
      { status: 500 },
    );
  }
}

/**
 * POST - Manual trigger with Authorization: Bearer CRON_SECRET
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return await runProcessTasks("manual POST");
  } catch (error) {
    console.error("[process-tasks] Manual run error:", error);
    const message =
      error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message, triggeredBy: "manual POST" },
      { status: 500 },
    );
  }
}
