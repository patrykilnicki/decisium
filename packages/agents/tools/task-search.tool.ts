import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { searchTaskItems } from "@/lib/memory/task-retriever";

export const taskSearchTool = new DynamicStructuredTool({
  name: "task_search",
  description:
    "Search user todo tasks semantically/lexically. Use for task-specific questions, status checks, and planning.",
  schema: z.object({
    userId: z.string().describe("The user ID"),
    query: z.string().describe("Task query"),
    maxResults: z.number().int().min(1).max(50).default(20),
  }),
  func: async ({ userId, query, maxResults }) => {
    const rows = await searchTaskItems({
      userId,
      query,
      limit: maxResults,
    });
    return JSON.stringify({
      results: rows,
      total_found: rows.length,
      query_used: query,
    });
  },
});
