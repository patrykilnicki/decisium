import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTodoGenerator } from "@/lib/integrations";
import { getCurrentDate } from "../lib/date-utils";
import { getTaskContext } from "../lib/task-context";
import * as db from "@/lib/supabase/db";

export const generateTodoListTool = new DynamicStructuredTool({
  name: "generate_todo_list",
  description:
    "Get or generate actionable tasks for a specific date. First returns existing snapshot for that date if available (no regeneration). Only generates from integrations (Calendar, Gmail) when no snapshot exists for the date. Integrations are queried for that single calendar day only. Use force=true only when user explicitly asks to refresh or regenerate. Present the results to the user for approval before confirming.",
  schema: z.object({
    userId: z.string().uuid().optional().describe("Authenticated user id"),
    date: z
      .string()
      .optional()
      .describe(
        "Calendar day in YYYY-MM-DD. Must be the exact date the user asked tasks for (e.g. 'taski na 20.02' → 2026-02-20). Do NOT use the date of the emails or thread being viewed—always use the user-requested target date so created tasks have the correct due date. Defaults to today when omitted.",
      ),
    force: z
      .boolean()
      .default(false)
      .describe(
        "If true, regenerate from live integrations even when snapshot exists. Default false: show cached snapshot or generate only when missing.",
      ),
  }),
  func: async (args) => {
    const taskContext = getTaskContext();
    const contextUserId = taskContext?.userId;
    const userId = args.userId ?? contextUserId;
    if (!userId) {
      throw new Error("userId is required to generate todos");
    }
    let date = args.date;
    if (!date) {
      const admin = createAdminClient();
      const { data: userRow } = await db.selectOne(
        admin,
        "users",
        { id: userId },
        { columns: "timezone" },
      );
      const timezone =
        (userRow as { timezone?: string | null } | null)?.timezone ?? undefined;
      date = taskContext?.currentDate ?? getCurrentDate(timezone);
    }

    const generator = createTodoGenerator(createAdminClient());
    const payload = args.force
      ? await generator.regenerateForDate(userId, date, {
          generatedFromEvent: "agent.tool.generate_todo_list",
        })
      : await generator.getOrGenerateForDate(userId, date, {
          generatedFromEvent: "agent.tool.generate_todo_list",
        });

    return JSON.stringify(payload);
  },
});
