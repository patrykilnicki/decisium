import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWeeklySummary } from "@/app/actions/summaries";
import { format, startOfWeek, subWeeks } from "date-fns";

const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
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

    const results = [];
    const lastWeekStart = format(startOfWeek(subWeeks(new Date(), 1)), "yyyy-MM-dd");

    for (const user of users) {
      try {
        await generateWeeklySummary(user.id, lastWeekStart);
        results.push({ userId: user.id, status: "success" });
      } catch (error: any) {
        console.error(`Failed to generate weekly summary for user ${user.id}:`, error);
        results.push({ userId: user.id, status: "error", error: error.message });
      }
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to generate weekly summaries" },
      { status: 500 }
    );
  }
}
