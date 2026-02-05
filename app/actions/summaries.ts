"use server";

import { createClient } from "@/lib/supabase/server";
import { rootAgent } from "@/packages/agents/core/root.agent";
import {
  DailySummaryContent,
  WeeklySummaryContent,
  MonthlySummaryContent,
} from "@/packages/agents/schemas/summary.schema";
import { storeEmbedding } from "@/lib/embeddings/store";
import { format } from "date-fns";

function lastMessageContentAsString(
  content: string | Array<{ text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => b.text ?? "").join("");
  return "";
}

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

  const prompt = `You are generating a **DAILY WORK SUMMARY** for a cognitive productivity app.

This summary is a reflective snapshot, not a performance evaluation.
The goal is clarity and sense-making — never pressure or judgment.

Date: ${date}

INPUT DATA (events, notes, calendar signals, reflections):
${eventsText}

══════════════════════════════════════
OUTPUT STRUCTURE (required)
══════════════════════════════════════

Return valid JSON only. No markdown, no extra text.

{
  "score": number (0-100),
  "score_label": string (e.g. "Excellent", "Solid", "Mixed"),
  "explanation": string (one short supportive sentence),
  "time_allocation": {
    "meetings": number (0-100, percentage of time),
    "deep_work": number (0-100),
    "other": number (0-100)
  },
  "notes_added": number (integer, count from data),
  "new_ideas": number (integer, count ideas/captures from data),
  "narrative_summary": string (2-3 sentences describing the day)
}

time_allocation values must sum to 100. Infer from event types: notes/answers suggest deep work, summary/system or calendar cues suggest meetings; default to reasonable splits if unclear.

══════════════════════════════════════
RULES FOR OVERALL SCORE
══════════════════════════════════════

- Score reflects alignment, momentum, and sustainability — not hours worked
- Favor deep work continuity over raw activity
- Meetings are neutral, not negative
- Never imply obligation, failure, or expectations
- Do NOT explain the score mathematically

══════════════════════════════════════
RULES FOR TONE
══════════════════════════════════════

- Calm, observational, supportive, non-judgmental
- No motivational slogans, no "you should"

══════════════════════════════════════
RULES FOR NARRATIVE SUMMARY
══════════════════════════════════════

- Describe what happened, not what should have happened
- Connect activities into a coherent picture
- Avoid exaggeration or praise inflation
- Be concrete and grounded

══════════════════════════════════════
EXAMPLE (style reference only)
══════════════════════════════════════

{
  "score": 86,
  "score_label": "Excellent",
  "explanation": "You made steady progress and maintained focus without draining your energy.",
  "time_allocation": { "meetings": 15, "deep_work": 70, "other": 15 },
  "notes_added": 4,
  "new_ideas": 2,
  "narrative_summary": "You spent most of the day in focused work, moving key design tasks forward. Meetings didn't disrupt your momentum, allowing you to stay mentally present through the afternoon. The notes and ideas suggest active exploration rather than reactive work."
}

Generate the summary for the given date and data. Return only the JSON object.

══════════════════════════════════════
`;

  const result = await rootAgent.invoke({
    messages: [{ role: "user", content: prompt }],
  });

  const responseContent = lastMessageContentAsString(
    result.messages[result.messages.length - 1]?.content,
  );

  // Parse JSON from response (might need to extract JSON from markdown)
  let summaryContent: DailySummaryContent;
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const notesCount = events.filter(
        (e) => e.type === "note" || e.type === "note+question",
      ).length;
      const ideasCount = events.filter(
        (e) => e.type === "question" || e.type === "note+question",
      ).length;
      const total =
        (parsed.time_allocation?.meetings ?? 0) +
        (parsed.time_allocation?.deep_work ?? 0) +
        (parsed.time_allocation?.other ?? 0);
      const norm = total > 0 ? total : 1;
      summaryContent = {
        score: Math.min(100, Math.max(0, Number(parsed.score) ?? 70)),
        score_label: parsed.score_label ?? "Solid",
        explanation:
          parsed.explanation ?? "Review your day and reflect on patterns.",
        time_allocation: {
          meetings: Math.round(
            (Number(parsed.time_allocation?.meetings) ?? 20) * (100 / norm),
          ),
          deep_work: Math.round(
            (Number(parsed.time_allocation?.deep_work) ?? 60) * (100 / norm),
          ),
          other: Math.round(
            (Number(parsed.time_allocation?.other) ?? 20) * (100 / norm),
          ),
        },
        notes_added:
          typeof parsed.notes_added === "number" && parsed.notes_added >= 0
            ? parsed.notes_added
            : notesCount,
        new_ideas:
          typeof parsed.new_ideas === "number" && parsed.new_ideas >= 0
            ? parsed.new_ideas
            : ideasCount,
        narrative_summary:
          parsed.narrative_summary ??
          "Review your day and reflect on patterns.",
      };
    } else {
      throw new Error("No JSON found in response");
    }
  } catch {
    const notesCount = events.filter(
      (e) => e.type === "note" || e.type === "note+question",
    ).length;
    const ideasCount = events.filter(
      (e) => e.type === "question" || e.type === "note+question",
    ).length;
    summaryContent = {
      score: 70,
      score_label: "Solid",
      explanation: "Review your day and reflect on patterns.",
      time_allocation: { meetings: 20, deep_work: 60, other: 20 },
      notes_added: notesCount,
      new_ideas: ideasCount,
      narrative_summary: "Review your day and reflect on patterns.",
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
    let summaryText: string;
    if ("score_label" in summaryContent && summaryContent.score_label) {
      summaryText = `${summaryContent.score_label}: ${summaryContent.explanation} ${summaryContent.narrative_summary}`;
    } else if (
      "facts" in summaryContent &&
      Array.isArray((summaryContent as { facts?: string[] }).facts)
    ) {
      const s = summaryContent as unknown as {
        facts: string[];
        insight: string;
      };
      summaryText = `${s.facts.join(". ")}. ${s.insight}`;
    } else {
      summaryText = JSON.stringify(summaryContent);
    }
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
  if (error)
    throw new Error(`Failed to fetch daily summaries: ${error.message}`);
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
  if (error)
    throw new Error(`Failed to fetch weekly summaries: ${error.message}`);
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
  if (error)
    throw new Error(`Failed to fetch monthly summaries: ${error.message}`);
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

  const responseContent = lastMessageContentAsString(
    result.messages[result.messages.length - 1]?.content,
  );

  let summaryContent: WeeklySummaryContent;
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryContent = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found in response");
    }
  } catch {
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

export async function generateMonthlySummary(
  userId: string,
  monthStart: string,
) {
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

  const responseContent = lastMessageContentAsString(
    result.messages[result.messages.length - 1]?.content,
  );

  let summaryContent: MonthlySummaryContent;
  try {
    const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryContent = JSON.parse(jsonMatch[0]);
    } else {
      throw new Error("No JSON found in response");
    }
  } catch {
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
