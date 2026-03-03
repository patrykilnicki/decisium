import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { generateEmbedding } from "@/packages/agents/lib/embeddings";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface VaultChunkResult {
  id: string;
  document_id: string;
  chunk_index: number;
  heading_path: string | null;
  content: string;
  similarity: number;
  updated_at: string | null;
}

export async function searchVaultChunks(
  query: string,
  userId: string,
  options?: {
    documentId?: string;
    collectionId?: string;
    threshold?: number;
    limit?: number;
  },
): Promise<VaultChunkResult[]> {
  const { embedding } = await generateEmbedding(query);
  const queryEmbeddingString = `[${embedding.join(",")}]`;

  const { data, error } = await supabase.rpc("match_vault_chunks", {
    query_embedding: queryEmbeddingString,
    match_tenant_id: userId,
    match_document_id: options?.documentId ?? null,
    match_collection_id: options?.collectionId ?? null,
    match_threshold: options?.threshold ?? 0.5,
    match_count: options?.limit ?? 10,
  });

  if (error) {
    throw new Error(`Vault search failed: ${error.message}`);
  }

  return (data ?? []) as VaultChunkResult[];
}
