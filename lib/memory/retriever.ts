import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
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
}

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

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
    hierarchyLevel?: "monthly" | "weekly" | "daily" | "raw";
  } = {},
): Promise<MemoryRetrievalResult> {
  const { threshold = 0.5, limit = 10, hierarchyLevel = "monthly" } = options;

  // Generate embedding for query
  const { embedding } = await generateEmbedding(query);
  // Convert number array to PostgreSQL array string format for pgvector
  const queryEmbeddingString = `[${embedding.join(",")}]`;

  // Search embeddings using pgvector
  const { data, error } = await supabase.rpc("match_embeddings", {
    query_embedding: queryEmbeddingString,
    match_user_id: userId,
    match_threshold: threshold,
    match_count: limit,
    match_type:
      hierarchyLevel === "raw" ? "daily_event" : `${hierarchyLevel}_summary`,
  });

  if (error) {
    throw new Error(`Memory retrieval failed: ${error.message}`);
  }

  const fragments: MemoryFragment[] = (data || []).map(
    (item: EmbeddingRow) => ({
      id: item.id,
      user_id: item.user_id,
      content: item.content,
      metadata: item.metadata as MemoryMetadata,
      similarity: item.similarity,
      created_at: item.created_at,
    }),
  );

  if (fragments.length === 0 && hierarchyLevel === "monthly") {
    // Log once per query - new daily notes are auto-embedded; backfill needed for existing data
    console.info(
      `[memory] No embeddings for user ${userId}. New notes are auto-embedded. ` +
        "Run `pnpm backfill-embeddings` to populate from existing events/summaries.",
    );
  }

  return {
    fragments,
    hierarchy_level: hierarchyLevel,
    total_found: fragments.length,
  };
}

export async function retrieveHierarchicalMemory(
  query: string,
  userId: string,
  options: {
    threshold?: number;
    limitPerLevel?: number;
  } = {},
): Promise<MemoryRetrievalResult[]> {
  const { threshold = 0.5, limitPerLevel = 5 } = options;

  const levels: Array<"monthly" | "weekly" | "daily" | "raw"> = [
    "monthly",
    "weekly",
    "daily",
    "raw",
  ];

  const results: MemoryRetrievalResult[] = [];

  for (const level of levels) {
    try {
      const result = await retrieveMemory(query, userId, {
        threshold,
        limit: limitPerLevel,
        hierarchyLevel: level,
      });

      if (result.fragments.length > 0) {
        results.push(result);
        // If we found enough at a high level, we might not need lower levels
        if (level !== "raw" && result.fragments.length >= limitPerLevel) {
          break;
        }
      }
    } catch (error) {
      console.error(`Error retrieving ${level} memory:`, error);
      // Continue to next level
    }
  }

  // Fallback: if no results found in hierarchical search, try searching all types with lower threshold
  if (results.length === 0) {
    try {
      const fallbackResult = await retrieveMemoryAllTypes(query, userId, {
        threshold: Math.min(threshold, 0.25), // Use lower threshold for fallback
        limit: limitPerLevel * 3, // Get more results in fallback
      });

      if (fallbackResult.fragments.length > 0) {
        results.push(fallbackResult);
      }
    } catch (error) {
      console.error("Error in fallback memory retrieval:", error);
      // If fallback also fails, return empty results
    }
  }

  return results;
}

/** Search across all embedding types (no match_type filter). Use as fallback when hierarchical returns nothing. */
export async function retrieveMemoryAllTypes(
  query: string,
  userId: string,
  options: { threshold?: number; limit?: number } = {},
): Promise<MemoryRetrievalResult> {
  const { threshold = 0.25, limit = 15 } = options;
  const { embedding } = await generateEmbedding(query);
  // Convert number array to PostgreSQL array string format for pgvector
  const queryEmbeddingString = `[${embedding.join(",")}]`;

  const { data, error } = await supabase.rpc("match_embeddings", {
    query_embedding: queryEmbeddingString,
    match_user_id: userId,
    match_threshold: threshold,
    match_count: limit,
    match_type: undefined,
  });

  if (error) {
    throw new Error(`Memory retrieval failed: ${error.message}`);
  }

  const fragments: MemoryFragment[] = (data || []).map(
    (item: EmbeddingRow) => ({
      id: item.id,
      user_id: item.user_id,
      content: item.content,
      metadata: item.metadata as MemoryMetadata,
      similarity: item.similarity,
      created_at: item.created_at,
    }),
  );

  return {
    fragments,
    hierarchy_level: "raw",
    total_found: fragments.length,
  };
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
  const { threshold = 0.5, limit = 10, provider, atomType } = options;

  // Generate embedding for query
  const { embedding } = await generateEmbedding(query);
  // Convert number array to PostgreSQL array string format for pgvector
  const queryEmbeddingString = `[${embedding.join(",")}]`;

  // Search using the match_activity_atoms function
  const { data, error } = await supabase.rpc("match_activity_atoms", {
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
    threshold = 0.5,
    limitMemory = 10,
    limitAtoms = 10,
    includeAtoms = true,
  } = options;

  // Get hierarchical memory
  const memoryResults = await retrieveHierarchicalMemory(query, userId, {
    threshold,
    limitPerLevel: Math.ceil(limitMemory / 4),
  });

  // Combine all memory fragments
  const allFragments: MemoryFragment[] = memoryResults.flatMap(
    (result) => result.fragments,
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

  // Determine hierarchy level based on what was found
  let hierarchyLevel = "raw";
  if (memoryResults.length > 0) {
    hierarchyLevel = memoryResults[0].hierarchy_level;
  }

  return {
    fragments: allFragments,
    activityAtoms,
    hierarchyLevel,
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

  let query = supabase
    .from("activity_atoms")
    .select("*")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (provider) {
    query = query.eq("provider", provider);
  }

  if (atomType) {
    query = query.eq("atom_type", atomType);
  }

  if (since) {
    query = query.gte("occurred_at", since.toISOString());
  }

  const { data, error } = await query;

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
