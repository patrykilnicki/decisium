import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

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

    const shouldUseAdmin = process.env.TASK_WORKER === "true";
    const supabase = shouldUseAdmin
      ? (await import("@/lib/supabase/admin")).createAdminClient()
      : await (await import("@/lib/supabase/server")).createClient();

    const { data: result, error } = await supabase
      .from(table)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic insert per table; schema validated above
      .insert(data as any)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to store data in ${table}: ${error.message}`);
    }

    return JSON.stringify(result);
  },
});
