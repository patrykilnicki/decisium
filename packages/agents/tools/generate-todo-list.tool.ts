import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTodoGenerator } from "@/lib/integrations";
import { GenerateTodoListInputSchema } from "../schemas/todo.schema";
import { getTaskContext } from "../lib/task-context";

export const generateTodoListTool = new DynamicStructuredTool({
  name: "generate_todo_list",
  description:
    "Generate integration-based todo list from connected apps. Use mode=latest for quick retrieval, mode=regenerate for a fresh extraction. Returns normalized JSON for UI/agent consumption.",
  schema: z.object({
    userId: z.string().uuid().optional().describe("Authenticated user id"),
    mode: z.enum(["latest", "regenerate"]).default("latest"),
    persist: z.boolean().default(true),
    maxItems: z.number().int().min(1).max(200).default(50),
    windowHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 14),
  }),
  func: async (args) => {
    const contextUserId = getTaskContext()?.userId;
    if (!args.userId && !contextUserId) {
      throw new Error("userId is required to generate todos");
    }
    const input = GenerateTodoListInputSchema.parse({
      ...args,
      userId: args.userId ?? contextUserId,
    });
    const generator = createTodoGenerator(createAdminClient());
    const payload = await generator.generate(input, {
      generatedFromEvent: "agent.tool.generate_todo_list",
    });
    return JSON.stringify(payload);
  },
});
