import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMonthlySummary } from "@/app/actions/summaries";
import { format, startOfMonth, subMonths } from "date-fns";
import type { User } from "@/types/database";

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  // Verify cron secret - support both Vercel Cron (automatic) and manual calls
  const authHeader = request.headers.get("authorization");
  const vercelCronHeader = request.headers.get("x-vercel-cron");
  
  // Allow if it's a Vercel Cron job OR if Authorization header matches
  const isVercelCron = vercelCronHeader === "1";
  const isValidAuth = authHeader === `Bearer ${CRON_SECRET}`;
  
  if (!isVercelCron && !isValidAuth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createClient();

    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id");

    if (usersError || !users) {
      throw new Error("Failed to fetch users");
    }

    const results: Array<{ userId: string; status: string; error?: string }> = [];
    const lastMonthStart = format(startOfMonth(subMonths(new Date(), 1)), "yyyy-MM-dd");

    // Type assertion needed because select with specific columns returns a narrowed type
    const typedUsers = users as Array<Pick<User, "id">>;

    for (const user of typedUsers) {
      try {
        await generateMonthlySummary(user.id, lastMonthStart);
        results.push({ userId: user.id, status: "success" });
      } catch (error: unknown) {
        console.error(`Failed to generate monthly summary for user ${user.id}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        results.push({ userId: user.id, status: "error", error: message });
      }
    }

    return NextResponse.json({ results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to generate monthly summaries";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
