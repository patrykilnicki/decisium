import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as db from "@/lib/supabase/db";
import { storeMemory } from "@/lib/memory/memory-service";

function formatEmbeddingValue(value: unknown): string | null | undefined {
  if (value == null) return value as null | undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const numbers = value.filter(
      (item): item is number =>
        typeof item === "number" && Number.isFinite(item),
    );
    return `[${numbers.join(",")}]`;
  }
  return undefined;
}

export const supabaseStoreTool = new DynamicStructuredTool({
  name: "supabase_store",
  description: `Store data in Supabase. Available tables:
- daily_events: For daily journaling events
  Required fields: user_id (UUID), date (YYYY-MM-DD), role ('user'|'agent'|'system'), type ('note'|'question'|'note+question'|'answer'|'summary'|'system'), content (string)
  Optional: subtype (string)
- daily_summaries: For daily summaries (requires: user_id, date, content as JSONB)
- weekly_summaries: For weekly summaries (requires: user_id, week_start, content as JSONB)
- monthly_summaries: For monthly summaries (requires: user_id, month_start, content as JSONB)
- ask_threads: For Ask AI conversation threads (requires: user_id, title)
- ask_messages: For Ask AI messages (requires: thread_id, role ('user'|'assistant'|'system'), content)
- todo_items: For task items (requires: user_id, id, date, title, summary, source_provider, source_type, suggested_next_action)
- user_signals: For user preference/signals (requires: user_id, signal_type, description)
- embeddings: For vector embeddings (requires: user_id, content, embedding as array, metadata as JSONB)`,
  schema: z.object({
    table: z
      .enum([
        "daily_events",
        "daily_summaries",
        "weekly_summaries",
        "monthly_summaries",
        "ask_threads",
        "ask_messages",
        "todo_items",
        "user_signals",
        "embeddings",
      ])
      .describe(
        "The Supabase table name to insert into. Must be one of the available tables.",
      ),
    data: z
      .record(z.any())
      .describe("The data object to insert into the table"),
  }),
  func: async ({ table, data }) => {
    // Validate daily_events data
    if (table === "daily_events") {
      const validTypes = [
        "note",
        "question",
        "note+question",
        "answer",
        "summary",
        "system",
      ];
      const validRoles = ["user", "agent", "system"];

      if (data.type && !validTypes.includes(data.type)) {
        throw new Error(
          `Invalid type for daily_events: "${data.type}". Must be one of: ${validTypes.join(", ")}`,
        );
      }

      if (data.role && !validRoles.includes(data.role)) {
        throw new Error(
          `Invalid role for daily_events: "${data.role}". Must be one of: ${validRoles.join(", ")}`,
        );
      }

      // Validate required fields
      if (
        !data.user_id ||
        !data.date ||
        !data.role ||
        !data.type ||
        !data.content
      ) {
        throw new Error(
          `Missing required fields for daily_events. Required: user_id, date, role, type, content`,
        );
      }
    }

    // Validate ask_messages data
    if (table === "ask_messages") {
      const validRoles = ["user", "assistant", "system"];
      if (data.role && !validRoles.includes(data.role)) {
        throw new Error(
          `Invalid role for ask_messages: "${data.role}". Must be one of: ${validRoles.join(", ")}`,
        );
      }
    }

    if (table === "embeddings") {
      const formattedEmbedding = formatEmbeddingValue(data.embedding);
      if (formattedEmbedding) {
        data.embedding = formattedEmbedding;
      }
    }

    const shouldUseAdmin = process.env.TASK_WORKER === "true";
    const supabase = shouldUseAdmin
      ? (await import("@/lib/supabase/admin")).createAdminClient()
      : await (await import("@/lib/supabase/server")).createClient();

    const { data: result, error } = await db.insertOne(
      supabase,
      table as
        | "daily_events"
        | "daily_summaries"
        | "weekly_summaries"
        | "monthly_summaries"
        | "ask_threads"
        | "ask_messages"
        | "todo_items"
        | "user_signals"
        | "embeddings",
      data as never,
    );

    if (error) {
      throw new Error(`Failed to store data in ${table}: ${error.message}`);
    }

    // Unified memory ingestion for high-value sources written through this tool.
    try {
      if (
        table === "daily_events" &&
        typeof data.user_id === "string" &&
        typeof data.content === "string"
      ) {
        await storeMemory({
          userId: data.user_id,
          content: data.content,
          memoryType: "episodic",
          source: "daily_event",
          sourceId:
            typeof (result as { id?: string })?.id === "string"
              ? (result as { id?: string }).id
              : undefined,
          importance: 0.5,
          ttl: "7 days",
          metadata: {
            type: "daily_event",
            date: data.date,
            role: data.role,
          },
        });
      }

      if (
        table === "todo_items" &&
        typeof data.user_id === "string" &&
        (typeof data.title === "string" || typeof data.summary === "string")
      ) {
        const todoContent = [
          data.title,
          data.summary,
          data.suggested_next_action,
        ]
          .filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
          .join(". ");
        if (todoContent) {
          await storeMemory({
            userId: data.user_id,
            content: todoContent,
            memoryType: "task",
            source: "task",
            sourceId: typeof data.id === "string" ? data.id : undefined,
            importance:
              data.status === "done"
                ? 0.7
                : data.priority === "urgent"
                  ? 1.4
                  : 1.0,
            ttl: data.status === "done" ? "14 days" : null,
            metadata: {
              type: "task_item",
              date: data.date,
              status: data.status,
              priority: data.priority,
            },
          });
        }
      }

      if (
        table === "user_signals" &&
        typeof data.user_id === "string" &&
        typeof data.description === "string"
      ) {
        await storeMemory({
          userId: data.user_id,
          content: data.description,
          memoryType: "semantic",
          source: "insight",
          sourceId:
            typeof (result as { id?: string })?.id === "string"
              ? (result as { id?: string }).id
              : undefined,
          importance: 1.5,
          metadata: {
            type: "user_signal",
            signal_type: data.signal_type,
            impact_area: data.impact_area,
          },
        });
      }
    } catch (ingestError) {
      console.error(
        `[supabase_store] Memory ingestion failed for ${table}:`,
        ingestError,
      );
    }

    return JSON.stringify(result);
  },
});
