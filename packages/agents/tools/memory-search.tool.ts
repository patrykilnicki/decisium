import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  retrieveIntegratedMemory,
  retrieveMemoryAllTypes,
} from "@/lib/memory/retriever";

interface MemorySearchResultItem {
  content: string;
  metadata?: Record<string, unknown>;
  similarity?: number;
  hierarchy_level?: string;
}

/**
 * Single embedding-based memory search used by all agents (daily, root/Ask AI, orchestrator).
 * Uses pgvector similarity over the embeddings table (monthly → weekly → daily → raw).
 */
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
      const integrated = await retrieveIntegratedMemory(query, userId, {
        threshold: 0.5,
        limitMemory: 10,
        limitAtoms: 10,
        includeAtoms: true,
      });

      const fragmentResults: MemorySearchResultItem[] = [];
      const fragmentIds = new Set<string>();

      for (const fragment of integrated.fragments) {
        fragmentIds.add(fragment.id);
        fragmentResults.push({
          content: fragment.content,
          metadata: fragment.metadata as Record<string, unknown>,
          similarity: fragment.similarity,
          hierarchy_level: integrated.hierarchyLevel,
        });
      }

      const extra = await retrieveMemoryAllTypes(query, userId, {
        threshold: 0.25,
        limit: 20,
      });

      for (const fragment of extra.fragments) {
        if (fragmentIds.has(fragment.id)) continue;
        fragmentIds.add(fragment.id);
        fragmentResults.push({
          content: fragment.content,
          metadata: fragment.metadata as Record<string, unknown>,
          similarity: fragment.similarity,
          hierarchy_level: "all",
        });
      }

      const formattedResults: MemorySearchResultItem[] = [
        ...fragmentResults,
        ...integrated.activityAtoms.map((atom) => ({
          content: atom.content,
          metadata: {
            type: "activity_atom",
            provider: atom.provider,
            atom_type: atom.atomType,
            occurred_at: atom.occurredAt.toISOString(),
            title: atom.title,
            source_url: atom.sourceUrl,
          },
          similarity: atom.similarity,
          hierarchy_level: "activity_atom",
        })),
      ];

      if (formattedResults.length === 0) {
        console.log(
          `[memory_search] No results found for user ${userId} with query: "${query}"`,
        );
      } else {
        console.log(
          `[memory_search] Found ${formattedResults.length} results for user ${userId}`,
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
