import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { generateWeeklySummary } from "@/app/actions/summaries";
import { getLastWeekStartInTimezone } from "@/lib/datetime/user-timezone";
import type { User } from "@/types/database";

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  const isVercelCron = vercelCronHeader === "1";
  const isValidAuth = authHeader === `Bearer ${CRON_SECRET}`;

  if (!isVercelCron && !isValidAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();

    const { data: users, error: usersError } = await db.selectMany(
      admin,
      "users",
      {},
      { columns: "id, timezone" },
    );

    if (usersError || !users) {
      throw new Error("Failed to fetch users");
    }

    const results: Array<{ userId: string; status: string; error?: string }> =
      [];
    const now = new Date();
    const typedUsers = users as Array<Pick<User, "id" | "timezone">>;

    for (const user of typedUsers) {
      try {
        const tz = user.timezone ?? "UTC";
        const lastWeekStart = getLastWeekStartInTimezone(tz, now);
        await generateWeeklySummary(user.id, lastWeekStart);
        results.push({ userId: user.id, status: "success" });
      } catch (error: unknown) {
        console.error(
          `Failed to generate weekly summary for user ${user.id}:`,
          error,
        );
        const message = error instanceof Error ? error.message : String(error);
        results.push({ userId: user.id, status: "error", error: message });
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to generate weekly summaries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
