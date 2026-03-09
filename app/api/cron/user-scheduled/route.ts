import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { createTodoGenerator } from "@/lib/integrations";
import {
  generateDailySummary,
  generateWeeklySummary,
  generateMonthlySummary,
} from "@/app/actions/summaries";
import {
  getYesterdayInTimezone,
  getTodayInTimezone,
  getLastWeekStartInTimezone,
  getLastMonthStartInTimezone,
  getHourInTimezone,
  getDayOfWeekInTimezone,
  getDayOfMonthInTimezone,
} from "@/lib/datetime/user-timezone";
import type { User } from "@/types/database";

const CRON_SECRET = process.env.CRON_SECRET;
const TRIGGER_HOUR = 8;

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  return (
    vercelCronHeader === "1" ||
    (Boolean(CRON_SECRET) && authHeader === `Bearer ${CRON_SECRET}`)
  );
}

/**
 * POST /api/cron/user-scheduled
 * Runs every hour. For each user in whose timezone it is 8:00, runs:
 * - daily summary (yesterday)
 * - generate today todos
 * - if Monday 8h: weekly summary (last week)
 * - if 1st of month 8h: monthly summary (last month)
 */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const generator = createTodoGenerator(admin);
  const now = new Date();

  try {
    const { data: users, error: usersError } = await db.selectMany(
      admin,
      "users",
      {},
      { columns: "id, timezone" },
    );

    if (usersError || !users) {
      throw new Error("Failed to fetch users");
    }

    const typedUsers = users as Array<Pick<User, "id" | "timezone">>;
    const results: Array<{
      userId: string;
      daily?: string;
      todos?: string;
      weekly?: string;
      monthly?: string;
    }> = [];

    for (const user of typedUsers) {
      const tz = user.timezone ?? "UTC";
      const hour = getHourInTimezone(tz, now);
      if (hour !== TRIGGER_HOUR) continue;

      const userResults: {
        userId: string;
        daily?: string;
        todos?: string;
        weekly?: string;
        monthly?: string;
      } = { userId: user.id };

      try {
        const yesterday = getYesterdayInTimezone(tz, now);
        await generateDailySummary(user.id, yesterday);
        userResults.daily = "success";
      } catch (err) {
        console.error(
          `[user-scheduled] daily summary failed for ${user.id}:`,
          err,
        );
        userResults.daily =
          err instanceof Error ? err.message : "Unknown error";
      }

      try {
        const today = getTodayInTimezone(tz, now);
        await generator.getOrGenerateForDate(user.id, today, {
          generatedFromEvent: "system.cron.user_scheduled",
        });
        userResults.todos = "success";
      } catch (err) {
        console.error(
          `[user-scheduled] today todos failed for ${user.id}:`,
          err,
        );
        userResults.todos =
          err instanceof Error ? err.message : "Unknown error";
      }

      const dow = getDayOfWeekInTimezone(tz, now);
      if (dow === 1) {
        try {
          const lastWeekStart = getLastWeekStartInTimezone(tz, now);
          await generateWeeklySummary(user.id, lastWeekStart);
          userResults.weekly = "success";
        } catch (err) {
          console.error(
            `[user-scheduled] weekly summary failed for ${user.id}:`,
            err,
          );
          userResults.weekly =
            err instanceof Error ? err.message : "Unknown error";
        }
      }

      const dom = getDayOfMonthInTimezone(tz, now);
      if (dom === 1) {
        try {
          const lastMonthStart = getLastMonthStartInTimezone(tz, now);
          await generateMonthlySummary(user.id, lastMonthStart);
          userResults.monthly = "success";
        } catch (err) {
          console.error(
            `[user-scheduled] monthly summary failed for ${user.id}:`,
            err,
          );
          userResults.monthly =
            err instanceof Error ? err.message : "Unknown error";
        }
      }

      results.push(userResults);
    }

    return NextResponse.json({
      success: true,
      triggered: results.length,
      results,
    });
  } catch (error) {
    console.error("[user-scheduled]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "User-scheduled cron failed",
      },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/user-scheduled",
    description:
      "Cron: every hour; at 8:00 user local runs daily summary, today todos; Monday 8h = weekly; 1st 8h = monthly",
  });
}
