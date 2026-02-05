import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type { EmbeddingInsert } from "@/types/database";
import { generateEmbedding } from "./generate";

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface StoreEmbeddingParams {
  userId: string;
  content: string;
  metadata: {
    type: "daily_event" | "daily_summary" | "weekly_summary" | "monthly_summary";
    source_id: string;
    date: string;
  };
}

export async function storeEmbedding(params: StoreEmbeddingParams): Promise<string> {
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
  
  const { data, error } = await supabase
    .from("embeddings")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to store embedding: ${error.message}`);
  }

  return data.id;
}
