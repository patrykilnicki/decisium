"use server";

import { createClient } from "@/lib/supabase/server";
import { rootAgent } from "@/packages/agents/core/root.agent";
import { DailySummaryContent, WeeklySummaryContent, MonthlySummaryContent } from "@/packages/agents/schemas/summary.schema";
import { storeEmbedding } from "@/lib/embeddings/store";
import { format, startOfWeek, startOfMonth, subDays, subWeeks, subMonths } from "date-fns";

export async function generateDailySummary(userId: string, date: string) {
  const supabase = await createClient();

  // Check if summary already exists
  const { data: existing } = await supabase
    .from("daily_summaries")
    .select("id")
    .eq("user_id", userId)
    .eq("date", date)
    .single();

  if (existing) {
    return existing;
  }

  // Get all daily events for the date
  const { data: events, error: eventsError } = await supabase
    .from("daily_events")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .order("created_at", { ascending: true });

  if (eventsError || !events || events.length === 0) {
    throw new Error("No events found for this date");
  }

  // Format events for agent
  const eventsText = events
    .map((e) => `[${e.role}] ${e.type}: ${e.content}`)
    .join("\n");

  const prompt = `Generate a daily summary for ${date} based on these events:

${eventsText}

Generate a summary with:
- 2-4 key facts about the day
- 1 insight about patterns or themes
- 1 optional suggestion for the future

Return as JSON: {facts: string[], insight: string, suggestion?: string}`;

  const result = await rootAgent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  const responseContent = result.messages[result.messages.length - 1]?.content || "";

  // Parse JSON from response (might need to extract JSON from markdown)
  let summaryContent: DailySummaryContent;
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryContent = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found in response");
    }
  } catch (error) {
    // Fallback: create basic summary
    summaryContent = {
      facts: events.slice(0, 3).map((e) => e.content.substring(0, 100)),
      insight: "Review your day and reflect on patterns.",
    };
  }

  // Store summary
  const { data: summary, error: summaryError } = await supabase
    .from("daily_summaries")
    .insert({
      user_id: userId,
      date,
      content: summaryContent,
    })
    .select()
    .single();

  if (summaryError) {
    throw new Error(`Failed to store summary: ${summaryError.message}`);
  }

  // Generate and store embedding
  try {
    const summaryText = `${summaryContent.facts.join(". ")}. ${summaryContent.insight}`;
    await storeEmbedding({
      userId,
      content: summaryText,
      metadata: {
        type: "daily_summary",
        source_id: summary.id,
        date,
      },
    });
  } catch (error) {
    console.error("Failed to store summary embedding:", error);
  }

  return summary;
}

export async function generateWeeklySummary(userId: string, weekStart: string) {
  const supabase = await createClient();

  // Check if summary already exists
  const { data: existing } = await supabase
    .from("weekly_summaries")
    .select("id")
    .eq("user_id", userId)
    .eq("week_start", weekStart)
    .single();

  if (existing) {
    return existing;
  }

  // Get daily summaries for the week
  const weekStartDate = new Date(weekStart);
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekEndDate.getDate() + 6);

  const { data: dailySummaries, error: summariesError } = await supabase
    .from("daily_summaries")
    .select("*")
    .eq("user_id", userId)
    .gte("date", weekStart)
    .lte("date", format(weekEndDate, "yyyy-MM-dd"))
    .order("date", { ascending: true });

  if (summariesError || !dailySummaries || dailySummaries.length === 0) {
    throw new Error("No daily summaries found for this week");
  }

  const summariesText = dailySummaries
    .map((s) => `${s.date}: ${JSON.stringify(s.content)}`)
    .join("\n");

  const prompt = `Generate a weekly summary for week starting ${weekStart} based on these daily summaries:

${summariesText}

Generate a summary with:
- patterns: array of patterns observed
- themes: array of recurring themes
- insights: array of insights

Return as JSON: {patterns: string[], themes: string[], insights: string[]}`;

  const result = await rootAgent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  const responseContent = result.messages[result.messages.length - 1]?.content || "";

  let summaryContent: WeeklySummaryContent;
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryContent = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found in response");
    }
  } catch (error) {
    summaryContent = {
      patterns: [],
      themes: [],
      insights: ["Review your week for patterns."],
    };
  }

  const { data: summary, error: summaryError } = await supabase
    .from("weekly_summaries")
    .insert({
      user_id: userId,
      week_start: weekStart,
      content: summaryContent,
    })
    .select()
    .single();

  if (summaryError) {
    throw new Error(`Failed to store weekly summary: ${summaryError.message}`);
  }

  // Generate embedding
  try {
    const summaryText = `${summaryContent.patterns.join(". ")}. ${summaryContent.themes.join(". ")}. ${summaryContent.insights.join(". ")}`;
    await storeEmbedding({
      userId,
      content: summaryText,
      metadata: {
        type: "weekly_summary",
        source_id: summary.id,
        date: weekStart,
      },
    });
  } catch (error) {
    console.error("Failed to store weekly summary embedding:", error);
  }

  return summary;
}

export async function generateMonthlySummary(userId: string, monthStart: string) {
  const supabase = await createClient();

  // Check if summary already exists
  const { data: existing } = await supabase
    .from("monthly_summaries")
    .select("id")
    .eq("user_id", userId)
    .eq("month_start", monthStart)
    .single();

  if (existing) {
    return existing;
  }

  // Get weekly and daily summaries for the month
  const monthStartDate = new Date(monthStart);
  const monthEndDate = new Date(monthStartDate);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  monthEndDate.setDate(monthEndDate.getDate() - 1);

  const { data: weeklySummaries } = await supabase
    .from("weekly_summaries")
    .select("*")
    .eq("user_id", userId)
    .gte("week_start", monthStart)
    .lte("week_start", format(monthEndDate, "yyyy-MM-dd"))
    .order("week_start", { ascending: true });

  const summariesText = (weeklySummaries || [])
    .map((s) => `Week ${s.week_start}: ${JSON.stringify(s.content)}`)
    .join("\n");

  const prompt = `Generate a monthly summary for month starting ${monthStart} based on these weekly summaries:

${summariesText}

Generate a summary with:
- trends: array of trends observed
- strategic_insights: array of strategic insights
- reflections: array of reflections

Return as JSON: {trends: string[], strategic_insights: string[], reflections: string[]}`;

  const result = await rootAgent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  const responseContent = result.messages[result.messages.length - 1]?.content || "";

  let summaryContent: MonthlySummaryContent;
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryContent = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found in response");
    }
  } catch (error) {
    summaryContent = {
      trends: [],
      strategic_insights: [],
      reflections: ["Review your month for strategic insights."],
    };
  }

  const { data: summary, error: summaryError } = await supabase
    .from("monthly_summaries")
    .insert({
      user_id: userId,
      month_start: monthStart,
      content: summaryContent,
    })
    .select()
    .single();

  if (summaryError) {
    throw new Error(`Failed to store monthly summary: ${summaryError.message}`);
  }

  // Generate embedding
  try {
    const summaryText = `${summaryContent.trends.join(". ")}. ${summaryContent.strategic_insights.join(". ")}. ${summaryContent.reflections.join(". ")}`;
    await storeEmbedding({
      userId,
      content: summaryText,
      metadata: {
        type: "monthly_summary",
        source_id: summary.id,
        date: monthStart,
      },
    });
  } catch (error) {
    console.error("Failed to store monthly summary embedding:", error);
  }

  return summary;
}
