import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
  retrieveIntegratedMemory,
  retrieveMemoryAllTypes,
} from "@/lib/memory/retriever";
import { searchVaultChunks } from "@/lib/vault/vault-retriever";
import { searchTaskItems } from "@/lib/memory/task-retriever";
import { rerankCandidates } from "@/packages/agents/lib/rerank";

interface KnowledgeSearchItem {
  id: string;
  content: string;
  similarity: number;
  source: "memory" | "vault" | "task";
  document_id?: string;
  heading_path?: string | null;
  metadata?: Record<string, unknown>;
  base_score?: number;
  rerank_score?: number;
}

const MAX_RESULTS_CAP = 60;
const FEW_RESULTS_THRESHOLD = 8;
const EXPAND_THRESHOLD = 0.25;
const EXPAND_LIMIT_MULTIPLIER = 2;
const RAG_RETRIEVER_V2_ENABLED =
  (process.env.RAG_RETRIEVER_V2_ENABLED || "true").toLowerCase() !== "false";

function clampLimit(value: number): number {
  return Math.min(MAX_RESULTS_CAP, Math.max(5, Math.round(value)));
}

/**
 * Unified search across memory (summaries, events, Ask messages) and Collections documents.
 * Implements adaptive retrieval: when results are few, auto-expands with lower threshold.
 * Agent can use expandSearch: true for "list all" or when suggest_follow_up was true.
 */
export const knowledgeSearchTool = new DynamicStructuredTool({
  name: "knowledge_search",
  description:
    "Search across all user knowledge: memory (summaries, events, history) AND Collections documents. Use for broad queries (e.g. 'what do I know about X'). When suggest_follow_up is true, call again with expandSearch: true for broader search. Set minResults when user expects at least N results.",
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
      const [integrated, vaultResults, extra, taskResults] = await Promise.all([
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
        retrieveMemoryAllTypes(query, userId, {
          threshold: useExpandedParams ? 0.2 : 0.25,
          limit: perSourceLimit,
        }),
        RAG_RETRIEVER_V2_ENABLED
          ? searchTaskItems({
              userId,
              query,
              limit: perSourceLimit,
            })
          : Promise.resolve([]),
      ]);

      // MergeCandidates stage: normalize, dedupe, and prepare candidate set for reranking.
      const candidateMap = new Map<string, KnowledgeSearchItem>();
      const upsertCandidate = (item: KnowledgeSearchItem) => {
        const existing = candidateMap.get(item.id);
        if (!existing || (item.base_score ?? 0) > (existing.base_score ?? 0)) {
          candidateMap.set(item.id, item);
        }
      };

      for (const fragment of integrated.fragments) {
        upsertCandidate({
          id: `memory:${fragment.id}`,
          content: fragment.content,
          similarity: fragment.similarity,
          source: "memory",
          base_score: fragment.final_score ?? fragment.similarity,
          metadata: {
            ...(fragment.metadata as Record<string, unknown>),
            hierarchy_level: integrated.hierarchyLevel,
            memory_type: fragment.memory_type,
            source: fragment.source,
            source_id: fragment.source_id,
            importance: fragment.importance,
          },
        });
      }

      for (const atom of integrated.activityAtoms) {
        upsertCandidate({
          id: `atom:${atom.id}`,
          content: atom.content,
          similarity: atom.similarity,
          source: "memory",
          base_score: atom.similarity,
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

      for (const fragment of extra.fragments) {
        upsertCandidate({
          id: `memory-extra:${fragment.id}`,
          content: fragment.content,
          similarity: fragment.similarity,
          source: "memory",
          base_score: fragment.final_score ?? fragment.similarity,
          metadata: {
            ...(fragment.metadata as Record<string, unknown>),
            hierarchy_level: "all",
          },
        });
      }

      for (const vault of vaultResults) {
        upsertCandidate({
          id: `vault:${vault.id}`,
          content: vault.content,
          similarity: vault.similarity,
          source: "vault",
          document_id: vault.document_id,
          heading_path: vault.heading_path,
          base_score: vault.similarity,
        });
      }

      for (const task of taskResults) {
        upsertCandidate({
          id: `task:${task.id}`,
          content: task.content,
          similarity: task.similarity,
          source: "task",
          base_score: task.similarity,
          metadata: {
            type: "task_item",
            status: task.status,
            priority: task.priority,
            due_at: task.due_at,
            updated_at: task.updated_at,
          },
        });
      }

      const mergedCandidates = [...candidateMap.values()];
      const needsExpand =
        !useExpandedParams && mergedCandidates.length < FEW_RESULTS_THRESHOLD;

      if (needsExpand) {
        const [expandIntegrated, expandVault, expandTasks] = await Promise.all([
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
          searchTaskItems({
            userId,
            query,
            limit: perSourceLimit * 2,
          }),
        ]);

        for (const fragment of expandIntegrated.fragments) {
          upsertCandidate({
            id: `memory-expand:${fragment.id}`,
            content: fragment.content,
            similarity: fragment.similarity,
            source: "memory",
            base_score: fragment.final_score ?? fragment.similarity,
            metadata: {
              ...(fragment.metadata as Record<string, unknown>),
              hierarchy_level: expandIntegrated.hierarchyLevel,
            },
          });
        }
        for (const vault of expandVault) {
          upsertCandidate({
            id: `vault-expand:${vault.id}`,
            content: vault.content,
            similarity: vault.similarity,
            source: "vault",
            document_id: vault.document_id,
            heading_path: vault.heading_path,
            base_score: vault.similarity,
          });
        }
        for (const task of expandTasks) {
          upsertCandidate({
            id: `task-expand:${task.id}`,
            content: task.content,
            similarity: task.similarity,
            source: "task",
            base_score: task.similarity,
            metadata: {
              type: "task_item",
              status: task.status,
              priority: task.priority,
              due_at: task.due_at,
              updated_at: task.updated_at,
            },
          });
        }
      }

      const reranked = RAG_RETRIEVER_V2_ENABLED
        ? await rerankCandidates({
            query,
            items: [...candidateMap.values()].map((item) => ({
              id: item.id,
              content: item.content,
              score: item.base_score ?? item.similarity,
            })),
          })
        : [...candidateMap.values()]
            .sort(
              (a, b) =>
                (b.base_score ?? b.similarity) - (a.base_score ?? a.similarity),
            )
            .map((item) => ({
              id: item.id,
              score: item.base_score ?? item.similarity,
            }));
      const rerankById = new Map(reranked.map((row) => [row.id, row.score]));

      const topResults = [...candidateMap.values()]
        .map((item) => ({
          ...item,
          rerank_score: rerankById.get(item.id),
        }))
        .sort(
          (a, b) =>
            (b.rerank_score ?? b.base_score ?? b.similarity) -
            (a.rerank_score ?? a.base_score ?? a.similarity),
        )
        .slice(0, Math.min(limit, 8));

      const totalFound = topResults.length;
      const suggestFollowUp =
        totalFound === 0 ||
        (minResults !== undefined && totalFound < minResults) ||
        (!useExpandedParams && totalFound < FEW_RESULTS_THRESHOLD);

      const memoryCount = topResults.filter(
        (x) => x.source === "memory",
      ).length;
      const vaultCount = topResults.filter((x) => x.source === "vault").length;
      const taskCount = topResults.filter((x) => x.source === "task").length;

      return JSON.stringify({
        results: topResults.map((r) => ({
          content: r.content,
          similarity: r.similarity,
          source: r.source,
          document_id: r.document_id,
          heading_path: r.heading_path,
          metadata: r.metadata,
          rerank_score: r.rerank_score,
        })),
        total_found: totalFound,
        memory_count: memoryCount,
        vault_count: vaultCount,
        task_count: taskCount,
        query_used: query,
        suggest_follow_up: suggestFollowUp,
        expanded_automatically: needsExpand,
        metrics: {
          merged_candidates: candidateMap.size,
          reranked_candidates: reranked.length,
        },
      });
    } catch (error) {
      console.error("[knowledge_search] Error:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        memory_count: 0,
        vault_count: 0,
        task_count: 0,
        query_used: query,
        suggest_follow_up: true,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  },
});
