import { createClient } from "@supabase/supabase-js";
import { generateEmbedding } from "./generate";

const supabase = createClient(
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

  // Store in Supabase (pgvector expects array format)
  const { data, error } = await supabase
    .from("embeddings")
    .insert({
      user_id: userId,
      content,
      embedding: embedding, // pgvector accepts array directly
      metadata,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to store embedding: ${error.message}`);
  }

  return data.id;
}
