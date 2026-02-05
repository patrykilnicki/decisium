import { NextRequest, NextResponse } from "next/server";
import { processTaskById } from "@/lib/tasks/task-processor";

type RouteParams = { params: Promise<{ taskId: string }> };

/**
 * POST /api/tasks/[taskId]/process
 * Run a single task by ID. Used internally to trigger the next task in the chain
 * from another serverless invocation (so work is not lost when the current one ends).
 * Secured by CRON_SECRET so only our app can call it.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isValid =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;

  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    if (!taskId) {
      return NextResponse.json(
        { ok: false, error: "taskId required" },
        { status: 400 },
      );
    }

    const result = await processTaskById(taskId);
    return NextResponse.json(
      result.ok ? { ok: true } : { ok: false, error: result.error },
      { status: result.ok ? 200 : 500 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process task";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
