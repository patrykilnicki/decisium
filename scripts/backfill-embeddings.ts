/**
 * Backfill embeddings from existing daily_events and summaries.
 * Memory search uses the embeddings table only; without embeddings, retrieval returns nothing.
 *
 * Usage: pnpm backfill-embeddings [--user-id=UUID]
 * Requires: OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Loads .env and .env.local via dotenv (must run before importing embeddings).
 */

import { config } from "dotenv";

config();
config({ path: ".env.local", override: true });

async function run(): Promise<void> {
  const { createClient } = await import("@supabase/supabase-js");
  const { generateEmbedding } = await import("../packages/agents/lib/embeddings");

  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY. Set it in .env or .env.local.");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env or .env.local.");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function embeddingExists(
    userId: string,
    sourceId: string,
    type: string
  ): Promise<boolean> {
    const { data } = await supabase
      .from("embeddings")
      .select("id")
      .eq("user_id", userId)
      .filter("metadata->>source_id", "eq", sourceId)
      .filter("metadata->>type", "eq", type)
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  async function insertEmbedding(
    userId: string,
    content: string,
    metadata: { type: string; source_id: string; date: string }
  ): Promise<void> {
    const { embedding } = await generateEmbedding(content);
    const { error } = await supabase.from("embeddings").insert({
      user_id: userId,
      content,
      embedding,
      metadata,
    });
    if (error) throw new Error(`Insert failed: ${error.message}`);
  }

  function dailySummaryToText(c: {
    facts: string[];
    insight: string;
    suggestion?: string;
  }): string {
    return `${c.facts.join(". ")}. ${c.insight}`;
  }

  function weeklySummaryToText(c: {
    patterns: string[];
    themes: string[];
    insights: string[];
  }): string {
    return `${c.patterns.join(". ")}. ${c.themes.join(". ")}. ${c.insights.join(". ")}`;
  }

  function monthlySummaryToText(c: {
    trends: string[];
    strategic_insights: string[];
    reflections: string[];
  }): string {
    return `${c.trends.join(". ")}. ${c.strategic_insights.join(". ")}. ${c.reflections.join(". ")}`;
  }

  async function backfillUser(
    userId: string
  ): Promise<{ events: number; daily: number; weekly: number; monthly: number }> {
    const counts = { events: 0, daily: 0, weekly: 0, monthly: 0 };

    const { data: events } = await supabase
      .from("daily_events")
      .select("id, content, date")
      .eq("user_id", userId);

    for (const e of events ?? []) {
      if (await embeddingExists(userId, e.id, "daily_event")) continue;
      await insertEmbedding(userId, e.content, {
        type: "daily_event",
        source_id: e.id,
        date: e.date,
      });
      counts.events++;
      await sleep(150);
    }

    const { data: dailySummaries } = await supabase
      .from("daily_summaries")
      .select("id, content, date")
      .eq("user_id", userId);

    for (const s of dailySummaries ?? []) {
      if (await embeddingExists(userId, s.id, "daily_summary")) continue;
      const content = dailySummaryToText(s.content as Parameters<typeof dailySummaryToText>[0]);
      await insertEmbedding(userId, content, {
        type: "daily_summary",
        source_id: s.id,
        date: s.date,
      });
      counts.daily++;
      await sleep(150);
    }

    const { data: weeklySummaries } = await supabase
      .from("weekly_summaries")
      .select("id, content, week_start")
      .eq("user_id", userId);

    for (const s of weeklySummaries ?? []) {
      if (await embeddingExists(userId, s.id, "weekly_summary")) continue;
      const content = weeklySummaryToText(s.content as Parameters<typeof weeklySummaryToText>[0]);
      await insertEmbedding(userId, content, {
        type: "weekly_summary",
        source_id: s.id,
        date: s.week_start,
      });
      counts.weekly++;
      await sleep(150);
    }

    const { data: monthlySummaries } = await supabase
      .from("monthly_summaries")
      .select("id, content, month_start")
      .eq("user_id", userId);

    for (const s of monthlySummaries ?? []) {
      if (await embeddingExists(userId, s.id, "monthly_summary")) continue;
      const content = monthlySummaryToText(s.content as Parameters<typeof monthlySummaryToText>[0]);
      await insertEmbedding(userId, content, {
        type: "monthly_summary",
        source_id: s.id,
        date: s.month_start,
      });
      counts.monthly++;
      await sleep(150);
    }

    return counts;
  }

  const userIdArg = process.argv.find((a) => a.startsWith("--user-id="));
  const filterUserId = userIdArg?.slice("--user-id=".length);

  let userIds: string[];
  if (filterUserId) {
    const { data } = await supabase.from("users").select("id").eq("id", filterUserId).limit(1);
    if (!data?.length) {
      console.error("User not found:", filterUserId);
      process.exit(1);
    }
    userIds = [filterUserId];
  } else {
    const { data } = await supabase
      .from("users")
      .select("id")
      .order("created_at", { ascending: true });
    userIds = (data ?? []).map((r: { id: string }) => r.id);
  }

  if (!userIds.length) {
    console.log("No users found.");
    return;
  }

  console.log(`Backfilling embeddings for ${userIds.length} user(s)...`);

  for (const uid of userIds) {
    const c = await backfillUser(uid);
    const total = c.events + c.daily + c.weekly + c.monthly;
    console.log(
      `User ${uid}: +${c.events} events, +${c.daily} daily, +${c.weekly} weekly, +${c.monthly} monthly (${total} new)`
    );
  }

  console.log("Done.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
