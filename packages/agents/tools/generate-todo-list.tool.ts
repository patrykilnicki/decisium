import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTodoGenerator } from "@/lib/integrations";
import { getTaskContext } from "../lib/task-context";

export const generateTodoListTool = new DynamicStructuredTool({
  name: "generate_todo_list",
  description:
    "Generate actionable tasks for a specific date from user's connected integrations (Calendar, Gmail, etc.). Returns structured task list. Use force=true to regenerate fresh tasks even if cached ones exist. Present the results to the user for approval before confirming.",
  schema: z.object({
    userId: z.string().uuid().optional().describe("Authenticated user id"),
    date: z
      .string()
      .optional()
      .describe("Date in YYYY-MM-DD format. Defaults to today."),
    force: z
      .boolean()
      .default(true)
      .describe("Force regenerate tasks from live integration data"),
  }),
  func: async (args) => {
    const contextUserId = getTaskContext()?.userId;
    const userId = args.userId ?? contextUserId;
    if (!userId) {
      throw new Error("userId is required to generate todos");
    }
    const date = args.date ?? new Date().toISOString().split("T")[0];

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
