/**
 * Backfill embeddings for existing memory sources.
 * Run: pnpm backfill-embeddings
 *
 * This script populates embeddings for historical data and migrates
 * memory coverage for RAG retrieval (events, summaries, tasks, signals, ask messages).
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/supabase";
import * as db from "../lib/supabase/db";
import { storeMemory } from "../lib/memory/memory-service";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function backfillDailyEvents() {
  const { data: events, error } = await db.selectMany(
    supabase,
    "daily_events",
    {
      role: "user",
      type: ["note", "question", "note+question"],
    },
    {
      columns: "id, user_id, date, content, role, type",
      order: { column: "created_at", ascending: true },
    },
  );

  if (error) {
    throw new Error(`Failed to fetch daily events: ${error.message}`);
  }

  const { data: existingEmbeddings } = await db.selectMany(
    supabase,
    "embeddings",
    { "metadata->>type": "daily_event" },
    { columns: "metadata" },
  );

  const embeddedSourceIds = new Set(
    (existingEmbeddings || [])
      .map((e) => (e.metadata as { source_id?: string } | null)?.source_id)
      .filter((id): id is string => Boolean(id)),
  );

  const toEmbed = (events || []).filter(
    (e) => !embeddedSourceIds.has(e.id) && e.content?.trim(),
  );

  console.log(
    `[backfill] Found ${toEmbed.length} daily events without embeddings (${events?.length || 0} total user messages)`,
  );

  let count = 0;
  for (const event of toEmbed) {
    try {
      await storeMemory({
        userId: event.user_id,
        content: event.content,
        memoryType: "episodic",
        source: "daily_event",
        sourceId: event.id,
        ttl: "7 days",
        metadata: {
          type: "daily_event",
          date: event.date,
        },
      });
      count++;
      if (count % 10 === 0)
        console.log(`[backfill] Embedded ${count} events...`);
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
    {
      table: "daily_summaries" as const,
      type: "daily_summary" as const,
      dateCol: "date" as const,
    },
    {
      table: "weekly_summaries" as const,
      type: "weekly_summary" as const,
      dateCol: "week_start" as const,
    },
    {
      table: "monthly_summaries" as const,
      type: "monthly_summary" as const,
      dateCol: "month_start" as const,
    },
  ];

  let total = 0;
  for (const { table, type, dateCol } of types) {
    const { data: summaries, error } = await db.selectMany(
      supabase,
      table,
      {},
      {
        columns: `id, user_id, content, ${dateCol}`,
        order: { column: dateCol, ascending: false },
      },
    );

    if (error) {
      console.error(`[backfill] Failed to fetch ${table}:`, error);
      continue;
    }

    const { data: existing } = await db.selectMany(
      supabase,
      "embeddings",
      { "metadata->>type": type },
      { columns: "metadata" },
    );

    const embeddedIds = new Set(
      (existing || [])
        .map((e) => (e.metadata as { source_id?: string } | null)?.source_id)
        .filter((id): id is string => Boolean(id)),
    );

    const rows = (summaries || []) as unknown as SummaryRow[];
    const toEmbed = rows.filter((s) => !embeddedIds.has(s.id) && s.content);

    const contentStr = (c: unknown) =>
      typeof c === "string" ? c : JSON.stringify(c);

    for (const s of toEmbed) {
      try {
        await storeMemory({
          userId: s.user_id,
          content: contentStr(s.content),
          memoryType: "semantic",
          source: "summary",
          sourceId: s.id,
          importance:
            type === "monthly_summary"
              ? 1.2
              : type === "weekly_summary"
                ? 1.0
                : 0.8,
          metadata: {
            type,
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

async function backfillTodoItems() {
  const { data: todos, error } = await db.selectMany(
    supabase,
    "todo_items",
    {},
    {
      columns:
        "id, user_id, date, title, summary, priority, status, source_provider, source_type, suggested_next_action",
      order: { column: "updated_at", ascending: false },
    },
  );
  if (error) throw new Error(`Failed to fetch todo_items: ${error.message}`);
  let count = 0;
  for (const todo of todos ?? []) {
    const content = [todo.title, todo.summary, todo.suggested_next_action]
      .filter(Boolean)
      .join(". ");
    if (!content) continue;
    try {
      await storeMemory({
        userId: todo.user_id,
        content,
        memoryType: "task",
        source: "task",
        sourceId: todo.id,
        importance: todo.priority === "urgent" ? 1.4 : 1.0,
        ttl: todo.status === "done" ? "14 days" : null,
        metadata: {
          type: "task_item",
          date: todo.date,
          status: todo.status,
          source_provider: todo.source_provider,
          source_type: todo.source_type,
        },
      });
      count++;
    } catch (err) {
      console.error(`[backfill] Failed to embed todo ${todo.id}:`, err);
    }
  }
  return count;
}

async function backfillUserSignals() {
  const { data: signals, error } = await db.selectMany(
    supabase,
    "user_signals",
    {},
    {
      columns: "id, user_id, signal_type, description, impact_area",
      order: { column: "created_at", ascending: false },
    },
  );
  if (error) throw new Error(`Failed to fetch user_signals: ${error.message}`);
  let count = 0;
  for (const signal of signals ?? []) {
    if (!signal.description?.trim()) continue;
    try {
      await storeMemory({
        userId: signal.user_id,
        content: signal.description,
        memoryType: "semantic",
        source: "insight",
        sourceId: signal.id,
        importance: 1.5,
        metadata: {
          type: "user_signal",
          signal_type: signal.signal_type,
          impact_area: signal.impact_area,
        },
      });
      count++;
    } catch (err) {
      console.error(`[backfill] Failed to embed signal ${signal.id}:`, err);
    }
  }
  return count;
}

async function backfillAskMessages() {
  const { data: messages, error } = await db.selectMany(
    supabase,
    "ask_messages",
    {},
    {
      columns: "id, thread_id, role, content, created_at",
      order: { column: "created_at", ascending: false },
    },
  );
  if (error) throw new Error(`Failed to fetch ask_messages: ${error.message}`);

  // map thread -> user
  const threadIds = [...new Set((messages ?? []).map((row) => row.thread_id))];
  const { data: threads } = await db.selectMany(
    supabase,
    "ask_threads",
    { id: threadIds },
    { columns: "id,user_id" },
  );
  const threadUser = new Map(
    (threads ?? []).map((row) => [row.id, row.user_id]),
  );
  let count = 0;
  for (const message of messages ?? []) {
    const userId = threadUser.get(message.thread_id);
    if (!userId || !message.content?.trim()) continue;
    try {
      await storeMemory({
        userId,
        content: message.content,
        memoryType: "conversation",
        source: "agent",
        sourceId: message.id,
        ttl: "7 days",
        metadata: {
          type: "ask_message",
          thread_id: message.thread_id,
          role: message.role,
          date: (message.created_at ?? "").slice(0, 10),
        },
      });
      count++;
    } catch (err) {
      console.error(
        `[backfill] Failed to embed ask message ${message.id}:`,
        err,
      );
    }
  }
  return count;
}

async function main() {
  console.log("[backfill] Starting embeddings backfill...\n");

  const eventsCount = await backfillDailyEvents();
  const summariesCount = await backfillSummaries();
  const tasksCount = await backfillTodoItems();
  const signalsCount = await backfillUserSignals();
  const askCount = await backfillAskMessages();

  console.log(
    `\n[backfill] Done. Embedded ${eventsCount} events, ${summariesCount} summaries, ${tasksCount} tasks, ${signalsCount} user signals, ${askCount} ask messages.`,
  );
}

main().catch((err) => {
  console.error("[backfill] Fatal error:", err);
  process.exit(1);
});
