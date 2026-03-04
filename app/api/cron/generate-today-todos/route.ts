import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { createTodoGenerator } from "@/lib/integrations";

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  const cronSecret = process.env.CRON_SECRET;
  return (
    vercelCronHeader === "1" ||
    (Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`)
  );
}

/**
 * POST /api/cron/generate-today-todos
 * Runs at 06:00 UTC daily. Ensures today's task snapshot exists for all users
 * with active integrations. Uses getOrGenerateForDate so existing snapshots
 * are never overwritten.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().split("T")[0];
  const admin = createAdminClient();
  const generator = createTodoGenerator(admin);

  try {
    const { data: integrations, error } = await db.selectMany(
      admin,
      "integrations",
      { status: "active" },
      { columns: "user_id" },
    );

    if (error) {
      throw new Error(`Failed to fetch integrations: ${error.message}`);
    }

    const userIds = [
      ...new Set(
        (integrations ?? []).map((r) => (r as { user_id: string }).user_id),
      ),
    ];

    if (userIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No users with active integrations",
        date: today,
        results: [],
      });
    }

    const results: Array<{ userId: string; status: string; error?: string }> =
      [];

    for (const userId of userIds) {
      try {
        await generator.getOrGenerateForDate(userId, today, {
          generatedFromEvent: "system.cron.generate_today_todos",
        });
        results.push({ userId, status: "success" });
      } catch (err) {
        console.error(`[generate-today-todos] Failed for user ${userId}:`, err);
        results.push({
          userId,
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: true,
      date: today,
      results,
    });
  } catch (error) {
    console.error("[generate-today-todos]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Generation failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/generate-today-todos",
    description:
      "Cron: ensure today's todo snapshot for users with active integrations (06:00 UTC)",
  });
}
