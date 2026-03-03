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

const DEFAULT_LIMIT = 30;
const MAX_RESULTS_CAP = 60;

function clampLimit(value: number): number {
  return Math.min(MAX_RESULTS_CAP, Math.max(5, Math.round(value)));
}

/**
 * Unified search across memory (summaries, events, Ask messages) and Vault documents.
 * Use for broad queries like "what do I know about X", "find anything related to project Y".
 * For source-specific queries use memory_search or vault_search instead.
 */
export const knowledgeSearchTool = new DynamicStructuredTool({
  name: "knowledge_search",
  description:
    "Search across all user knowledge: memory (summaries, events, history) AND Vault documents. Use for broad queries (e.g. 'what do I know about X', 'find anything related to project Y'). Returns merged results from both sources sorted by relevance. Use memory_search or vault_search when user explicitly wants one source only.",
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
  }),
  func: async ({ userId, query, maxResults }) => {
    try {
      const limit = clampLimit(maxResults);
      const perSourceLimit = Math.ceil(limit / 2);

      const [integrated, vaultResults] = await Promise.all([
        retrieveIntegratedMemory(query, userId, {
          threshold: 0.4,
          limitMemory: perSourceLimit,
          limitAtoms: Math.floor(perSourceLimit / 2),
          includeAtoms: true,
        }),
        searchVaultChunks(query, userId, {
          threshold: 0.4,
          limit: perSourceLimit,
        }),
      ]);

      const extra = await retrieveMemoryAllTypes(query, userId, {
        threshold: 0.25,
        limit: perSourceLimit,
      });

      const fragmentIds = new Set<string>();
      const items: KnowledgeSearchItem[] = [];

      for (const f of integrated.fragments) {
        if (fragmentIds.has(f.id)) continue;
        fragmentIds.add(f.id);
        items.push({
          content: f.content,
          similarity: f.similarity,
          source: "memory",
          metadata: {
            ...(f.metadata as Record<string, unknown>),
            hierarchy_level: integrated.hierarchyLevel,
          },
        });
      }

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

      for (const atom of integrated.activityAtoms) {
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

      for (const r of vaultResults) {
        items.push({
          content: r.content,
          similarity: r.similarity,
          source: "vault",
          document_id: r.document_id,
          heading_path: r.heading_path,
        });
      }

      const sorted = [...items].sort((a, b) => b.similarity - a.similarity);
      const topResults = sorted.slice(0, limit);

      const memoryCount = topResults.filter((x) => x.source === "memory").length;
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
        total_found: topResults.length,
        memory_count: memoryCount,
        vault_count: vaultCount,
        query_used: query,
      });
    } catch (error) {
      console.error("[knowledge_search] Error:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        memory_count: 0,
        vault_count: 0,
        query_used: query,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
