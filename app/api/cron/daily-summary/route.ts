import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateDailySummary } from "@/app/actions/summaries";
import { format, subDays } from "date-fns";

// Verify cron secret (set in environment)
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed. Use POST with Authorization: Bearer <CRON_SECRET>." },
    { status: 405 }
  );
}

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

    // Get all users
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, timezone");

    if (usersError || !users) {
      throw new Error("Failed to fetch users");
    }

    const results = [];

    for (const user of users) {
      try {
        // Generate summary for yesterday (or today if it's late)
        const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
        await generateDailySummary(user.id, yesterday);
        results.push({ userId: user.id, status: "success" });
      } catch (error: any) {
        console.error(`Failed to generate summary for user ${user.id}:`, error);
        results.push({ userId: user.id, status: "error", error: error.message });
      }
    }

    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to generate daily summaries" },
      { status: 500 }
    );
  }
}
