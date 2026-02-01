-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create index for vector similarity search on embeddings
CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON public.embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Function for semantic search
CREATE OR REPLACE FUNCTION public.match_embeddings(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  match_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.user_id,
    e.content,
    e.metadata,
    1 - (e.embedding <=> query_embedding) AS similarity,
    e.created_at
  FROM public.embeddings e
  WHERE e.user_id = match_user_id
    AND (match_type IS NULL OR e.metadata->>'type' = match_type)
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
