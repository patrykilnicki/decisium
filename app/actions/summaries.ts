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

  const prompt = `GYou are generating a **Daily Summary** for Decisium.

Your goal is not to evaluate performance, but to **reflect what actually happened**, surface **one meaningful pattern**, and optionally offer a **gentle noticing cue** for the future.

Date: ${date}

Input data (events, notes, calendar signals, reflections):
${eventsText}

══════════════════════════════════════
RULES (IMPORTANT)
══════════════════════════════════════

- Base everything strictly on the provided data
- Do NOT invent context, intent, or emotions
- Use neutral, non-judgmental language
- Avoid productivity framing (no “productive / unproductive”)
- Avoid advice unless it naturally follows from the pattern
- If data is sparse, reflect that explicitly

══════════════════════════════════════
OUTPUT STRUCTURE
══════════════════════════════════════

Return valid JSON in the following format:

{
  "facts": string[],
  "insight": string,
  "suggestion"?: string
}

══════════════════════════════════════
CONTENT GUIDELINES
══════════════════════════════════════

### facts (2-4 items)
- Concrete, observable statements
- Describe *what happened*, not why
- Examples:
  - "Most calendar time was spent in meetings related to one topic."
  - "There were few written notes despite multiple scheduled events."
  - "Activity was clustered in the first half of the day."

### insight (1 item)
- A soft interpretation that connects multiple facts
- Phrase as a possibility, not a conclusion
- Use language like:
  - "This suggests…"
  - "A possible pattern is…"
  - "It appears that…"
- Focus on attention, momentum, or decision-making

### suggestion (optional)
- Include only if it emerges naturally from the data
- Must be lightweight and reflective, not prescriptive
- Frame as noticing, not doing
- Examples:
  - "You might want to notice when this kind of day starts to form."
  - "It could be worth paying attention to how meetings affect follow-up thinking."

Do NOT include:
- tasks
- goals
- habits
- motivation
- instructions

══════════════════════════════════════
TONE CHECK
══════════════════════════════════════

The summary should feel:
- accurate
- calm
- reflective
- slightly clarifying

Not:
- motivating
- corrective
- analytical-heavy
- managerial
`;

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

export async function getDailySummaries(userId: string, limit = 30) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_summaries")
    .select("*")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch daily summaries: ${error.message}`);
  return data ?? [];
}

export async function getWeeklySummaries(userId: string, limit = 12) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weekly_summaries")
    .select("*")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch weekly summaries: ${error.message}`);
  return data ?? [];
}

export async function getMonthlySummaries(userId: string, limit = 12) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monthly_summaries")
    .select("*")
    .eq("user_id", userId)
    .order("month_start", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to fetch monthly summaries: ${error.message}`);
  return data ?? [];
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

  const prompt = `You are generating a **Weekly Summary** for Decisium.

Your role is to synthesize multiple daily summaries into **clear patterns, recurring themes, and higher-level insights** — without judging performance or prescribing action.

Week starting: ${weekStart}

Input (daily summaries from this week):
${summariesText}

══════════════════════════════════════
RULES (STRICT)
══════════════════════════════════════

- Base everything ONLY on the provided daily summaries
- Do NOT invent missing days, intentions, or causes
- Do NOT evaluate productivity or success
- Prefer cautious language over certainty
- If signals are weak or inconsistent, say so implicitly by keeping insights lighter
- Patterns must span multiple days (not single-day observations)

══════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════

Return valid JSON only:

{
  "patterns": string[],
  "themes": string[],
  "insights": string[]
}

══════════════════════════════════════
CONTENT DEFINITIONS
══════════════════════════════════════

### patterns
- Observable repetitions across days
- Grounded in facts from daily summaries
- Descriptive, not interpretive
- Examples:
  - "Meetings consistently occupied the majority of scheduled time."
  - "Most days showed limited follow-up activity after discussions."
  - "Energy and activity appeared front-loaded earlier in the week."

(2-5 items recommended)

---

### themes
- Broader recurring subjects or areas of attention
- More abstract than patterns, but still grounded
- Often expressed as nouns or short phrases
- Examples:
  - "Reactive communication"
  - "Fragmented focus"
  - "Exploration without closure"
  - "Context switching"

(2-4 items recommended)

---

### insights
- Higher-level interpretations that connect patterns and themes
- Must remain soft, reflective, and non-judgmental
- Phrase as possibilities, not conclusions
- Use language like:
  - "This week suggests…"
  - "Across the week, it appears that…"
  - "One emerging insight is…"

Focus on:
- attention flow
- momentum or stagnation
- decision-making (or avoidance)
- alignment or drift from intent

(1-3 items recommended)

══════════════════════════════════════
TONE CHECK
══════════════════════════════════════

The summary should feel:
- clarifying
- calm
- grounded in reality
- easy to recognize as true

Not:
- motivational
- corrective
- prescriptive
- overly analytical
`;

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

  const prompt = `You are generating a **Monthly Summary** for Decisium.

Your role is to synthesize multiple weekly summaries into **clear trends, strategic-level insights, and reflective observations** about how the user’s work, attention, and decisions evolved over the month.

This is not a performance review.
This is a **sense-making artifact**.

Month starting: ${monthStart}

Input (weekly summaries from this month):
${summariesText}

══════════════════════════════════════
RULES (VERY IMPORTANT)
══════════════════════════════════════

- Base everything ONLY on the provided weekly summaries
- Do NOT invent causes, motivations, or outcomes
- Do NOT evaluate success or productivity
- Avoid advice, goals, or action items
- Prefer cautious, reflective language over certainty
- Trends must be visible across multiple weeks
- If data is thin or inconsistent, reflect that subtly

══════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════

Return valid JSON only:

{
  "trends": string[],
  "strategic_insights": string[],
  "reflections": string[]
}

══════════════════════════════════════
CONTENT DEFINITIONS
══════════════════════════════════════

### trends
- Sustained patterns visible across weeks
- Descriptive and observational
- Focus on *direction*, not judgment
- Examples:
  - "Attention gradually shifted from exploration to execution."
  - "Meetings increasingly shaped the structure of most workdays."
  - "Several projects showed intermittent momentum rather than steady progress."

(2-5 items recommended)

---

### strategic_insights
- Higher-level interpretations that connect trends together
- Concern *how* the user operates over time
- Frame as possibilities, not conclusions
- Use language such as:
  - "Over the month, it appears that…"
  - "A strategic pattern that emerges is…"
  - "This month suggests a tendency toward…"

Focus on:
- decision-making style
- attention allocation
- momentum vs stagnation
- alignment or drift between intent and reality

Avoid:
- prescriptions
- optimization framing
- moral language

(2-4 items recommended)

---

### reflections
- Gentle, human-level observations meant to resonate
- Less analytical, more integrative
- Can reference tension, ambiguity, or learning
- Examples:
  - "Much of the month was shaped by reacting rather than choosing."
  - "Clarity often followed moments where decisions were made explicit."
  - "The month reflects ongoing exploration rather than closure."

These should feel like:
> “Yes — that describes this month.”

(2-4 items recommended)

══════════════════════════════════════
TONE CHECK
══════════════════════════════════════

The monthly summary should feel:
- calm
- accurate
- reflective
- identity-aware

Not:
- motivational
- corrective
- instructional
- managerial
`;

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
