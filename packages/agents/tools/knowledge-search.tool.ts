import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  retrieveIntegratedMemory,
  retrieveMemoryAllTypes,
} from "@/lib/memory/retriever";
import { searchVaultChunks } from "@/lib/vault/vault-retriever";

interface KnowledgeSearchItem {
  content: string;
  similarity: number;
  source: "memory" | "vault";
  document_id?: string;
  heading_path?: string | null;
  metadata?: Record<string, unknown>;
}

const MAX_RESULTS_CAP = 60;
const FEW_RESULTS_THRESHOLD = 8;
const EXPAND_THRESHOLD = 0.25;
const EXPAND_LIMIT_MULTIPLIER = 2;

function clampLimit(value: number): number {
  return Math.min(MAX_RESULTS_CAP, Math.max(5, Math.round(value)));
}

/**
 * Unified search across memory (summaries, events, Ask messages) and Vault documents.
 * Implements adaptive retrieval: when results are few, auto-expands with lower threshold.
 * Agent can use expandSearch: true for "list all" or when suggest_follow_up was true.
 */
export const knowledgeSearchTool = new DynamicStructuredTool({
  name: "knowledge_search",
  description:
    "Search across all user knowledge: memory (summaries, events, history) AND Vault documents. Use for broad queries (e.g. 'what do I know about X'). When suggest_follow_up is true, call again with expandSearch: true for broader search. Set minResults when user expects at least N results.",
  schema: z.object({
    userId: z.string().describe("The user ID to search knowledge for"),
    query: z.string().describe("The search query"),
    maxResults: z
      .number()
      .int()
      .min(5)
      .max(MAX_RESULTS_CAP)
      .default(30)
      .describe("Maximum total results to return (from both sources)"),
    minResults: z
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS_CAP)
      .optional()
      .describe(
        "When total_found < minResults, suggest_follow_up is true. Use for 'list all X' or when user expects many results.",
      ),
    expandSearch: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, use lower similarity threshold (0.25) and higher limits for broader retrieval. Use when initial search returned few results or user wants comprehensive coverage.",
      ),
  }),
  func: async ({ userId, query, maxResults, minResults, expandSearch }) => {
    try {
      const limit = clampLimit(maxResults);
      const useExpandedParams = expandSearch;
      const initialThreshold = useExpandedParams ? EXPAND_THRESHOLD : 0.4;
      const limitMultiplier = useExpandedParams ? EXPAND_LIMIT_MULTIPLIER : 1;
      const perSourceLimit = Math.ceil((limit * limitMultiplier) / 2);

      const runSearch = async () => {
        const [integrated, vaultResults] = await Promise.all([
          retrieveIntegratedMemory(query, userId, {
            threshold: initialThreshold,
            limitMemory: perSourceLimit,
            limitAtoms: Math.floor(perSourceLimit / 2),
            includeAtoms: true,
          }),
          searchVaultChunks(query, userId, {
            threshold: initialThreshold,
            limit: perSourceLimit,
          }),
        ]);

        const extra = await retrieveMemoryAllTypes(query, userId, {
          threshold: useExpandedParams ? 0.2 : 0.25,
          limit: perSourceLimit,
        });

        return { integrated, vaultResults, extra };
      };

      const { integrated, vaultResults, extra } = await runSearch();

      const fragmentIds = new Set<string>();
      const atomIds = new Set<string>();
      const items: KnowledgeSearchItem[] = [];

      const addMemoryResults = (
        fragments: {
          id: string;
          content: string;
          similarity: number;
          metadata?: unknown;
        }[],
        atoms: {
          id: string;
          content: string;
          similarity: number;
          provider: string;
          atomType: string;
          occurredAt: Date;
          title?: string;
          sourceUrl?: string;
        }[],
        hierarchyLevel: string,
      ) => {
        for (const f of fragments) {
          if (fragmentIds.has(f.id)) continue;
          fragmentIds.add(f.id);
          items.push({
            content: f.content,
            similarity: f.similarity,
            source: "memory",
            metadata: {
              ...(f.metadata as Record<string, unknown>),
              hierarchy_level: hierarchyLevel,
            },
          });
        }
        for (const atom of atoms) {
          if (atomIds.has(atom.id)) continue;
          atomIds.add(atom.id);
          items.push({
            content: atom.content,
            similarity: atom.similarity,
            source: "memory",
            metadata: {
              type: "activity_atom",
              provider: atom.provider,
              atom_type: atom.atomType,
              occurred_at: atom.occurredAt.toISOString(),
              title: atom.title,
              source_url: atom.sourceUrl,
            },
          });
        }
      };

      addMemoryResults(
        integrated.fragments,
        integrated.activityAtoms,
        integrated.hierarchyLevel,
      );

      for (const f of extra.fragments) {
        if (fragmentIds.has(f.id)) continue;
        fragmentIds.add(f.id);
        items.push({
          content: f.content,
          similarity: f.similarity,
          source: "memory",
          metadata: { hierarchy_level: "all" },
        });
      }

      for (const r of vaultResults) {
        items.push({
          content: r.content,
          similarity: r.similarity,
          source: "vault",
          document_id: r.document_id,
          heading_path: r.heading_path,
        });
      }

      const needsExpand =
        !useExpandedParams && items.length < FEW_RESULTS_THRESHOLD;

      if (needsExpand) {
        const [expandIntegrated, expandVault] = await Promise.all([
          retrieveIntegratedMemory(query, userId, {
            threshold: EXPAND_THRESHOLD,
            limitMemory: perSourceLimit * 2,
            limitAtoms: perSourceLimit,
            includeAtoms: true,
          }),
          searchVaultChunks(query, userId, {
            threshold: EXPAND_THRESHOLD,
            limit: perSourceLimit * 2,
          }),
        ]);

        for (const f of expandIntegrated.fragments) {
          if (fragmentIds.has(f.id)) continue;
          fragmentIds.add(f.id);
          items.push({
            content: f.content,
            similarity: f.similarity,
            source: "memory",
            metadata: {
              ...(f.metadata as Record<string, unknown>),
              hierarchy_level: expandIntegrated.hierarchyLevel,
            },
          });
        }
        for (const atom of expandIntegrated.activityAtoms) {
          if (atomIds.has(atom.id)) continue;
          atomIds.add(atom.id);
          items.push({
            content: atom.content,
            similarity: atom.similarity,
            source: "memory",
            metadata: {
              type: "activity_atom",
              provider: atom.provider,
              atom_type: atom.atomType,
              occurred_at: atom.occurredAt.toISOString(),
              title: atom.title,
              source_url: atom.sourceUrl,
            },
          });
        }
        for (const r of expandVault) {
          items.push({
            content: r.content,
            similarity: r.similarity,
            source: "vault",
            document_id: r.document_id,
            heading_path: r.heading_path,
          });
        }
      }

      const sorted = [...items].sort((a, b) => b.similarity - a.similarity);
      const topResults = sorted.slice(0, limit);

      const totalFound = topResults.length;
      const suggestFollowUp =
        totalFound === 0 ||
        (minResults !== undefined && totalFound < minResults) ||
        (!useExpandedParams && totalFound < FEW_RESULTS_THRESHOLD);

      const memoryCount = topResults.filter(
        (x) => x.source === "memory",
      ).length;
      const vaultCount = topResults.filter((x) => x.source === "vault").length;

      return JSON.stringify({
        results: topResults.map((r) => ({
          content: r.content,
          similarity: r.similarity,
          source: r.source,
          document_id: r.document_id,
          heading_path: r.heading_path,
          metadata: r.metadata,
        })),
        total_found: totalFound,
        memory_count: memoryCount,
        vault_count: vaultCount,
        query_used: query,
        suggest_follow_up: suggestFollowUp,
        expanded_automatically: needsExpand,
      });
    } catch (error) {
      console.error("[knowledge_search] Error:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        memory_count: 0,
        vault_count: 0,
        query_used: query,
        suggest_follow_up: true,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
