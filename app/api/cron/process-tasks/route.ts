import "@/lib/suppress-url-parse-deprecation";

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimTasks } from "@/lib/tasks/task-repository";
import { processTaskById } from "@/lib/tasks/task-processor";

/**
 * Optional fallback: process pending tasks (e.g. if triggerTask HTTP failed).
 * Normal flow is trigger-driven (first task → HTTP process → next task → …); no CRON required.
 * If you use Vercel Cron, it can run this every 1–5 min to catch stuck tasks.
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

async function runProcessTasks(triggeredBy: string) {
  process.env.TASK_WORKER = "true";

  const client = createAdminClient();
  const maxTasks = getNumberEnv("TASK_MAX_CLAIM", 5);
  const staleAfterSeconds = getNumberEnv("TASK_STALE_AFTER_SECONDS", 300);

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
    // Pass task row so we don't re-claim (claim_tasks already set in_progress)
    const { ok } = await processTaskById(task.id, {
      alreadyClaimedTask: task,
    });
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
          "Optional fallback: process pending tasks. Normal flow is trigger-driven (no CRON). Use POST with Authorization: Bearer CRON_SECRET to run manually.",
      },
      { status: 200 },
    );
  }

  try {
    return await runProcessTasks("Vercel Cron GET");
  } catch (error) {
    console.error("[process-tasks] Cron run error:", error);
    const message = error instanceof Error ? error.message : String(error);
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
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: message, triggeredBy: "manual POST" },
      { status: 500 },
    );
  }
}
