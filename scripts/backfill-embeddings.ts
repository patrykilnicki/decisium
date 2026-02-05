/**
 * Backfill embeddings for existing daily_events and summaries.
 * Run: pnpm backfill-embeddings
 *
 * New daily notes are auto-embedded when saved. This script populates
 * embeddings for existing data created before that feature.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import { storeEmbedding } from "../lib/embeddings/store";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function backfillDailyEvents() {
  const { data: events, error } = await supabase
    .from("daily_events")
    .select("id, user_id, date, content, role, type")
    .eq("role", "user")
    .in("type", ["note", "question", "note+question"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch daily events: ${error.message}`);
  }

  const { data: existingEmbeddings } = await supabase
    .from("embeddings")
    .select("metadata")
    .eq("metadata->>type", "daily_event");

  const embeddedSourceIds = new Set(
    (existingEmbeddings || [])
      .map((e) => (e.metadata as { source_id?: string } | null)?.source_id)
      .filter((id): id is string => Boolean(id))
  );

  const toEmbed = (events || []).filter(
    (e) => !embeddedSourceIds.has(e.id) && e.content?.trim()
  );

  console.log(
    `[backfill] Found ${toEmbed.length} daily events without embeddings (${events?.length || 0} total user messages)`
  );

  let count = 0;
  for (const event of toEmbed) {
    try {
      await storeEmbedding({
        userId: event.user_id,
        content: event.content,
        metadata: {
          type: "daily_event",
          source_id: event.id,
          date: event.date,
        },
      });
      count++;
      if (count % 10 === 0) console.log(`[backfill] Embedded ${count} events...`);
    } catch (err) {
      console.error(`[backfill] Failed to embed event ${event.id}:`, err);
    }
  }

  return count;
}

interface SummaryRow {
  id: string;
  user_id: string;
  content: unknown;
  date?: string;
  week_start?: string;
  month_start?: string;
}

async function backfillSummaries() {
  const types = [
    { table: "daily_summaries" as const, type: "daily_summary" as const, dateCol: "date" as const },
    { table: "weekly_summaries" as const, type: "weekly_summary" as const, dateCol: "week_start" as const },
    { table: "monthly_summaries" as const, type: "monthly_summary" as const, dateCol: "month_start" as const },
  ];

  let total = 0;
  for (const { table, type, dateCol } of types) {
    const { data: summaries, error } = await supabase
      .from(table)
      .select("id, user_id, content, " + dateCol)
      .order(dateCol, { ascending: false });

    if (error) {
      console.error(`[backfill] Failed to fetch ${table}:`, error);
      continue;
    }

    const { data: existing } = await supabase
      .from("embeddings")
      .select("metadata")
      .eq("metadata->>type", type);

    const embeddedIds = new Set(
      (existing || [])
        .map((e) => (e.metadata as { source_id?: string } | null)?.source_id)
        .filter((id): id is string => Boolean(id))
    );

    const rows = (summaries || []) as unknown as SummaryRow[];
    const toEmbed = rows.filter(
      (s) => !embeddedIds.has(s.id) && s.content
    );

    const contentStr = (c: unknown) =>
      typeof c === "string" ? c : JSON.stringify(c);

    for (const s of toEmbed) {
      try {
        await storeEmbedding({
          userId: s.user_id,
          content: contentStr(s.content),
          metadata: {
            type,
            source_id: s.id,
            date: String(s[dateCol] ?? ""),
          },
        });
        total++;
      } catch (err) {
        console.error(`[backfill] Failed to embed ${type} ${s.id}:`, err);
      }
    }

    console.log(`[backfill] ${table}: embedded ${toEmbed.length} summaries`);
  }

  return total;
}

async function main() {
  console.log("[backfill] Starting embeddings backfill...\n");

  const eventsCount = await backfillDailyEvents();
  const summariesCount = await backfillSummaries();

  console.log(
    `\n[backfill] Done. Embedded ${eventsCount} daily events, ${summariesCount} summaries.`
  );
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
