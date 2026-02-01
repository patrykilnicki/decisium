import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { retrieveHierarchicalMemory } from "@/lib/memory/retriever";

export const memorySearchTool = new DynamicStructuredTool({
  name: "memory_search",
  description:
    "Search user's history semantically. Pass userId and query. Start with monthly summaries, then weekly, daily, raw events.",
  schema: z.object({
    userId: z.string().describe("The user ID to search memories for"),
    query: z.string().describe("The search query to find relevant memories"),
  }),
  func: async ({ userId, query }) => {
    try {
      const results = await retrieveHierarchicalMemory(query, userId, {
        threshold: 0.5,
        limitPerLevel: 5,
      });

      // Format results for the agent
      const formattedResults = results.flatMap((result) =>
        result.fragments.map((fragment) => ({
          content: fragment.content,
          metadata: fragment.metadata,
          similarity: fragment.similarity,
          hierarchy_level: result.hierarchy_level,
        }))
      );

      if (formattedResults.length === 0) {
        console.log(
          `[memory_search] No results found for user ${userId} with query: "${query}"`
        );
      } else {
        console.log(
          `[memory_search] Found ${formattedResults.length} results for user ${userId}`
        );
      }

      return JSON.stringify({
        results: formattedResults,
        total_found: formattedResults.length,
      });
    } catch (error) {
      console.error("[memory_search] Error during memory search:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
