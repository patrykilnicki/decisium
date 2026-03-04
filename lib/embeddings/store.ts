import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import type { EmbeddingInsert } from "@/types/database";
import { generateEmbedding } from "./generate";

export interface StoreEmbeddingParams {
  userId: string;
  content: string;
  metadata: {
    type:
      | "daily_event"
      | "daily_summary"
      | "weekly_summary"
      | "monthly_summary";
    source_id: string;
    date: string;
  };
}

export async function storeEmbedding(
  params: StoreEmbeddingParams,
): Promise<string> {
  const { userId, content, metadata } = params;

  // Generate embedding
  const { embedding } = await generateEmbedding(content);

  // Convert number array to PostgreSQL array string format for pgvector
  // Format: [1,2,3] -> "[1,2,3]"
  const embeddingString = `[${embedding.join(",")}]`;

  // Store in Supabase (pgvector expects string format)
  const insertData: EmbeddingInsert = {
    user_id: userId,
    content,
    embedding: embeddingString,
    metadata,
  };

  const supabase = createAdminClient();
  const { data, error } = await db.insertOne(
    supabase,
    "embeddings",
    insertData as never,
  );

  if (error || !data) {
    throw new Error(
      `Failed to store embedding: ${error?.message ?? "Unknown error"}`,
    );
  }

  return (data as { id: string }).id;
}
