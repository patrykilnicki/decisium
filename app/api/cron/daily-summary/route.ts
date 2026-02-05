import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateDailySummary } from "@/app/actions/summaries";
import { format, subDays } from "date-fns";
import type { User } from "@/types/database";

// Verify cron secret (set in environment)
const CRON_SECRET = process.env.CRON_SECRET;

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  const isVercelCron = vercelCronHeader === "1";
  const isValidAuth = authHeader === `Bearer ${CRON_SECRET}`;
  return isVercelCron || isValidAuth;
}

async function runDailySummary(): Promise<NextResponse> {
  try {
    const supabase = await createClient();

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, timezone");

    if (usersError || !users) {
      throw new Error("Failed to fetch users");
    }

    const results: Array<{ userId: string; status: string; error?: string }> = [];

    // Type assertion needed because select with specific columns returns a narrowed type
    const typedUsers = users as Array<Pick<User, "id" | "timezone">>;

    for (const user of typedUsers) {
      try {
        const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
        await generateDailySummary(user.id, yesterday);
        results.push({ userId: user.id, status: "success" });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to generate summary for user ${user.id}:`, error);
        results.push({ userId: user.id, status: "error", error: message });
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate daily summaries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Support GET so that when Vercel returns 307 and the client follows with GET, we still run
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized. Use Authorization: Bearer <CRON_SECRET> or call via Vercel Cron." },
      { status: 401 }
    );
  }
  return runDailySummary();
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return runDailySummary();
}
