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

const DEFAULT_ADAPTIVE_FIRST_LIMIT = 15;
const DEFAULT_ADAPTIVE_EXPAND_THRESHOLD = 5;
const ADAPTIVE_EXPAND_LIMIT = 40;
const MAX_RESULTS_CAP = 60;
const FEW_RESULTS_THRESHOLD = 5;

function clampLimit(value: number): number {
  return Math.min(MAX_RESULTS_CAP, Math.max(1, Math.round(value)));
}

/**
 * Single embedding-based memory search used by all agents (daily, root/Ask AI, orchestrator).
 * Uses pgvector similarity over the embeddings table (monthly → weekly → daily → raw).
 * Agent defines how many results to aim for (maxResults / minResults). When results are few, suggest_follow_up signals to offer broadening the search.
 */
export const memorySearchTool = new DynamicStructuredTool({
  name: "memory_search",
  description:
    "Search user's history semantically. Pass userId and query. You must set maxResults (how many results to fetch) based on user intent; set minResults when user expects 'at least N' (e.g. list meetings). When suggest_follow_up is true, offer to broaden the search or try different keywords.",
  schema: z.object({
    userId: z.string().describe("The user ID to search memories for"),
    query: z.string().describe("The search query to find relevant memories"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS_CAP)
      .describe(
        "How many results to fetch. Set from user intent: 5-15 for specific questions, 20-50 for 'list all X' or broad queries.",
      ),
    minResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS_CAP)
      .optional()
      .describe(
        "Optional. Minimum results you expect. When total_found < minResults, suggest_follow_up will be true so you can offer to broaden the search.",
      ),
  }),
  func: async ({ userId, query, maxResults, minResults }) => {
    try {
      const fragmentIds = new Set<string>();
      const fragmentResults: MemorySearchResultItem[] = [];
      const cap = clampLimit(maxResults);
      let integrated: Awaited<ReturnType<typeof retrieveIntegratedMemory>>;
      let extraLimit: number;

      integrated = await retrieveIntegratedMemory(query, userId, {
        threshold: 0.5,
        limitMemory: cap,
        limitAtoms: 10,
        includeAtoms: true,
      });
      extraLimit = cap;

      if (integrated.fragments.length < DEFAULT_ADAPTIVE_EXPAND_THRESHOLD && cap >= ADAPTIVE_EXPAND_LIMIT) {
        const expanded = await retrieveIntegratedMemory(query, userId, {
          threshold: 0.35,
          limitMemory: ADAPTIVE_EXPAND_LIMIT,
          limitAtoms: 10,
          includeAtoms: true,
        });
        for (const f of expanded.fragments) {
          if (fragmentIds.has(f.id)) continue;
          fragmentIds.add(f.id);
          fragmentResults.push({
            content: f.content,
            metadata: f.metadata as Record<string, unknown>,
            similarity: f.similarity,
            hierarchy_level: expanded.hierarchyLevel,
          });
        }
        extraLimit = ADAPTIVE_EXPAND_LIMIT;
      }

      for (const fragment of integrated.fragments) {
        if (fragmentIds.has(fragment.id)) continue;
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
        limit: extraLimit,
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

      const bySimilarity = [...fragmentResults].sort(
        (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0),
      );
      const formattedResults: MemorySearchResultItem[] = [
        ...bySimilarity,
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

      const totalFound = formattedResults.length;
      const suggestFollowUp =
        totalFound === 0 ||
        (minResults !== undefined && totalFound < minResults) ||
        totalFound < FEW_RESULTS_THRESHOLD;

      if (totalFound === 0) {
        console.log(
          `[memory_search] No results found for user ${userId} with query: "${query}"`,
        );
      } else {
        console.log(
          `[memory_search] Found ${totalFound} results for user ${userId} (suggest_follow_up: ${suggestFollowUp})`,
        );
      }

      return JSON.stringify({
        results: formattedResults,
        total_found: totalFound,
        query_used: query,
        suggest_follow_up: suggestFollowUp,
      });
    } catch (error) {
      console.error("[memory_search] Error during memory search:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        query_used: query,
        suggest_follow_up: true,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
