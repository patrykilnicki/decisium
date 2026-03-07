import "@/lib/suppress-url-parse-deprecation";

import type { Database } from "@/types/supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { generateEmbedding } from "@/packages/agents/lib/embeddings";
import {
  MemoryFragment,
  MemoryRetrievalResult,
  type MemoryMetadata,
} from "@/packages/agents/schemas/memory.schema";

interface EmbeddingRow {
  id: string;
  user_id: string;
  content: string;
  metadata: unknown;
  similarity: number;
  created_at: string;
  memory_type?: string | null;
  source?: string | null;
  source_id?: string | null;
  importance?: number | null;
  expires_at?: string | null;
}

type MemoryTypeValue =
  | "semantic"
  | "episodic"
  | "procedural"
  | "conversation"
  | "task";

interface ActivityAtomRow {
  id: string;
  user_id: string;
  provider: string;
  atom_type: string;
  title?: string;
  content: string;
  occurred_at: string;
  source_url?: string;
  similarity?: number; // Optional - only present when returned from RPC functions
}

function getSupabase() {
  return createAdminClient() as import("@supabase/supabase-js").SupabaseClient<Database>;
}

function scoreWithImportanceAndRecency(params: {
  similarity: number;
  importance?: number | null;
  createdAt: string;
}): number {
  const importanceWeight = (params.importance ?? 0.5) * 0.15;
  const createdAtMs = new Date(params.createdAt).getTime();
  const ageDays = Number.isFinite(createdAtMs)
    ? Math.max(0, (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24))
    : 365;
  const recencyWeight = Math.max(0, 1 - ageDays / 30) * 0.2;
  return params.similarity + importanceWeight + recencyWeight;
}

function uniqueMemoryKey(fragment: MemoryFragment): string {
  const metadata = (fragment.metadata ?? {}) as Record<string, unknown>;
  const source = fragment.source ?? String(metadata.source ?? "unknown");
  const sourceId = fragment.source_id ?? String(metadata.source_id ?? "none");
  return `${source}:${sourceId}:${fragment.content}`;
}

function toMemoryType(
  value: string | null | undefined,
): MemoryTypeValue | undefined {
  if (
    value === "semantic" ||
    value === "episodic" ||
    value === "procedural" ||
    value === "conversation" ||
    value === "task"
  ) {
    return value;
  }
  return undefined;
}

// ============================================
// Activity Atom Types
// ============================================

export interface ActivityAtomFragment {
  id: string;
  userId: string;
  provider: string;
  atomType: string;
  title?: string;
  content: string;
  occurredAt: Date;
  sourceUrl?: string;
  similarity: number;
}

export interface IntegrationMemoryResult {
  fragments: MemoryFragment[];
  activityAtoms: ActivityAtomFragment[];
  hierarchyLevel: string;
  totalFound: number;
}

export async function retrieveMemory(
  query: string,
  userId: string,
  options: {
    threshold?: number;
    limit?: number;
    memoryTypes?: Array<
      "semantic" | "episodic" | "procedural" | "conversation" | "task"
    >;
    sources?: string[];
    includeExpired?: boolean;
  } = {},
): Promise<MemoryRetrievalResult> {
  const {
    threshold = 0.4,
    limit = 30,
    memoryTypes,
    sources,
    includeExpired = false,
  } = options;

  // Generate embedding for query
  const { embedding } = await generateEmbedding(query);
  // Convert number array to PostgreSQL array string format for pgvector
  const queryEmbeddingString = `[${embedding.join(",")}]`;

  // Search embeddings using pgvector.
  // New SQL supports memory_types/source filters, but we keep this loosely typed
  // to stay compatible with generated TS types during migration rollout.
  const { data, error } = await getSupabase().rpc("match_embeddings", {
    query_embedding: queryEmbeddingString,
    match_user_id: userId,
    match_threshold: threshold,
    match_count: limit,
    match_type: undefined,
    match_memory_types: memoryTypes,
    match_sources: sources,
    include_expired: includeExpired,
  } as never);

  if (error) {
    throw new Error(`Memory retrieval failed: ${error.message}`);
  }

  const fragments: MemoryFragment[] = (data || [])
    .map((item: EmbeddingRow) => ({
      id: item.id,
      user_id: item.user_id,
      content: item.content,
      metadata: item.metadata as MemoryMetadata,
      similarity: item.similarity,
      created_at: item.created_at,
      memory_type: toMemoryType(item.memory_type),
      source: item.source ?? undefined,
      source_id: item.source_id ?? undefined,
      importance: item.importance ?? undefined,
      final_score: scoreWithImportanceAndRecency({
        similarity: item.similarity,
        importance: item.importance,
        createdAt: item.created_at,
      }),
    }))
    .sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));

  return {
    fragments,
    hierarchy_level: "semantic",
    total_found: fragments.length,
  };
}

/**
 * Embedding-based memory search for agents. Queries the embeddings table via pgvector
 * (match_embeddings) in order: monthly → weekly → daily → raw; fallback searches all types.
 * Used by memory_search tool for daily, root, and orchestrator agents.
 */
export async function retrieveHierarchicalMemory(
  query: string,
  userId: string,
  options: {
    threshold?: number;
    limitPerLevel?: number;
  } = {},
): Promise<MemoryRetrievalResult[]> {
  const { threshold = 0.4, limitPerLevel = 20 } = options;
  const result = await retrieveMemory(query, userId, {
    threshold,
    limit: limitPerLevel * 2,
  });
  return result.fragments.length > 0 ? [result] : [];
}

/** Search across all embedding types (no match_type filter). Use as fallback when hierarchical returns nothing. */
export async function retrieveMemoryAllTypes(
  query: string,
  userId: string,
  options: { threshold?: number; limit?: number } = {},
): Promise<MemoryRetrievalResult> {
  const { threshold = 0.25, limit = 40 } = options;
  return retrieveMemory(query, userId, {
    threshold,
    limit,
  });
}

// ============================================
// Activity Atom Retrieval
// ============================================

/**
 * Search activity atoms by embedding similarity
 */
export async function retrieveActivityAtoms(
  query: string,
  userId: string,
  options: {
    threshold?: number;
    limit?: number;
    provider?: string;
    atomType?: string;
  } = {},
): Promise<ActivityAtomFragment[]> {
  const { threshold = 0.4, limit = 20, provider, atomType } = options;

  // Generate embedding for query
  const { embedding } = await generateEmbedding(query);
  // Convert number array to PostgreSQL array string format for pgvector
  const queryEmbeddingString = `[${embedding.join(",")}]`;

  // Search using the match_activity_atoms function
  const { data, error } = await getSupabase().rpc("match_activity_atoms", {
    query_embedding: queryEmbeddingString,
    match_user_id: userId,
    match_threshold: threshold,
    match_count: limit,
    filter_provider: provider ?? undefined,
    filter_atom_type: atomType ?? undefined,
  });

  if (error) {
    console.error("Error retrieving activity atoms:", error);
    return [];
  }

  return (data || []).map((item: ActivityAtomRow) => ({
    id: item.id,
    userId: item.user_id,
    provider: item.provider,
    atomType: item.atom_type,
    title: item.title,
    content: item.content,
    occurredAt: new Date(item.occurred_at),
    sourceUrl: item.source_url,
    similarity: item.similarity ?? 0, // RPC should always return similarity, but default to 0 if missing
  }));
}

/**
 * Retrieve both traditional memory and activity atoms
 * This provides a unified context for AI agents
 */
export async function retrieveIntegratedMemory(
  query: string,
  userId: string,
  options: {
    threshold?: number;
    limitMemory?: number;
    limitAtoms?: number;
    includeAtoms?: boolean;
  } = {},
): Promise<IntegrationMemoryResult> {
  const {
    threshold = 0.35,
    limitMemory = 40,
    limitAtoms = 25,
    includeAtoms = true,
  } = options;

  const memoryResult = await retrieveMemory(query, userId, {
    threshold,
    limit: limitMemory,
  });
  const uniqueFragments = new Map<string, MemoryFragment>();
  for (const fragment of memoryResult.fragments) {
    const key = uniqueMemoryKey(fragment);
    if (uniqueFragments.has(key)) continue;
    uniqueFragments.set(key, fragment);
  }
  const allFragments = [...uniqueFragments.values()].sort(
    (a, b) => (b.final_score ?? b.similarity) - (a.final_score ?? a.similarity),
  );

  // Get activity atoms if enabled
  let activityAtoms: ActivityAtomFragment[] = [];
  if (includeAtoms) {
    try {
      activityAtoms = await retrieveActivityAtoms(query, userId, {
        threshold,
        limit: limitAtoms,
      });
    } catch (error) {
      console.error("Error retrieving activity atoms:", error);
      // Continue without atoms
    }
  }

  return {
    fragments: allFragments,
    activityAtoms,
    hierarchyLevel: "semantic",
    totalFound: allFragments.length + activityAtoms.length,
  };
}

/**
 * Format integrated memory results for AI context
 */
export function formatIntegratedMemoryForContext(
  result: IntegrationMemoryResult,
): string {
  const sections: string[] = [];

  // Format memory fragments
  if (result.fragments.length > 0) {
    const memorySection = result.fragments
      .map((f) => {
        const date = f.metadata?.date || f.created_at;
        const type = f.metadata?.type || "memory";
        return `[${type}${date ? ` - ${date}` : ""}]\n${f.content}`;
      })
      .join("\n\n");
    sections.push(`## Relevant Memories\n${memorySection}`);
  }

  // Format activity atoms
  if (result.activityAtoms.length > 0) {
    const atomSection = result.activityAtoms
      .map((a) => {
        const date = a.occurredAt.toISOString().split("T")[0];
        const providerLabel = a.provider.replace("_", " ");
        const titlePart = a.title ? `"${a.title}"` : "";
        const urlPart = a.sourceUrl ? ` [link](${a.sourceUrl})` : "";
        return `[${providerLabel} ${a.atomType} - ${date}]${titlePart}${urlPart}\n${a.content}`;
      })
      .join("\n\n");
    sections.push(`## Activity from Connected Apps\n${atomSection}`);
  }

  if (sections.length === 0) {
    return "No relevant context found.";
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Get recent activity atoms for a user (no semantic search, just recency)
 */
export async function getRecentActivityAtoms(
  userId: string,
  options: {
    limit?: number;
    provider?: string;
    atomType?: string;
    since?: Date;
  } = {},
): Promise<ActivityAtomFragment[]> {
  const { limit = 20, provider, atomType, since } = options;

  const filters: Record<string, string> = { user_id: userId };
  if (provider) filters.provider = provider;
  if (atomType) filters.atom_type = atomType;

  const { data, error } = await db.selectMany(
    getSupabase(),
    "activity_atoms",
    filters,
    {
      rangeFilters: since
        ? { occurred_at: { gte: since.toISOString() } }
        : undefined,
      order: { column: "occurred_at", ascending: false },
      limit,
    },
  );

  if (error) {
    console.error("Error fetching recent activity atoms:", error);
    return [];
  }

  return (data || []).map((item) => ({
    id: item.id,
    userId: item.user_id,
    provider: item.provider,
    atomType: item.atom_type,
    title: item.title ?? undefined,
    content: item.content,
    occurredAt: new Date(item.occurred_at),
    sourceUrl: item.source_url ?? undefined,
    similarity: 1.0, // Not from similarity search - default to 1.0 for recent atoms
  }));
}
