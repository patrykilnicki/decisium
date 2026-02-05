import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createInsightGenerator } from "@/lib/integrations";

/**
 * GET /api/integrations/insights
 * Get recent insights for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const sourceType = searchParams.get("sourceType") || undefined;
    const granularity = searchParams.get("granularity") || undefined;
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    // Get insights
    const insightGenerator = createInsightGenerator(supabase);
    const insights = await insightGenerator.getRecentInsights(user.id, {
      sourceType,
      granularity,
      limit,
    });

    return NextResponse.json({
      insights: insights.map((insight) => ({
        id: insight.id,
        sourceType: insight.sourceType,
        granularity: insight.granularity,
        periodStart: insight.periodStart.toISOString(),
        periodEnd: insight.periodEnd.toISOString(),
        summary: insight.summary,
        keyFacts: insight.keyFacts,
        actionableInsights: insight.actionableInsights,
        createdAt: insight.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error fetching insights:", error);
    return NextResponse.json(
      { error: "Failed to fetch insights" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/integrations/insights
 * Generate insights for a specific period
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const {
      granularity = "day",
      periodStart,
      periodEnd,
      provider,
      forceRegenerate = false,
    } = body;

    // Validate granularity
    if (!["day", "week", "month"].includes(granularity)) {
      return NextResponse.json(
        { error: "Invalid granularity. Must be day, week, or month." },
        { status: 400 },
      );
    }

    // Parse dates
    const start = periodStart ? new Date(periodStart) : new Date();
    const end = periodEnd ? new Date(periodEnd) : new Date();

    // Generate insights
    const insightGenerator = createInsightGenerator(supabase);
    const insight = await insightGenerator.generateInsights(user.id, {
      granularity,
      periodStart: start,
      periodEnd: end,
      provider,
      forceRegenerate,
    });

    return NextResponse.json({
      insight: {
        id: insight.id,
        sourceType: insight.sourceType,
        granularity: insight.granularity,
        periodStart: insight.periodStart.toISOString(),
        periodEnd: insight.periodEnd.toISOString(),
        summary: insight.summary,
        keyFacts: insight.keyFacts,
        actionableInsights: insight.actionableInsights,
        createdAt: insight.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error generating insights:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate insights",
      },
      { status: 500 },
    );
  }
}
