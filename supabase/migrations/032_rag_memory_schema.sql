-- ============================================
-- RAG memory schema extensions
-- ============================================

ALTER TABLE public.embeddings
  ADD COLUMN IF NOT EXISTS memory_type TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT,
  ADD COLUMN IF NOT EXISTS source_id TEXT,
  ADD COLUMN IF NOT EXISTS importance DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS ttl INTERVAL,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'embeddings_memory_type_check'
  ) THEN
    ALTER TABLE public.embeddings
      ADD CONSTRAINT embeddings_memory_type_check CHECK (
        memory_type IS NULL OR memory_type IN (
          'semantic',
          'episodic',
          'procedural',
          'conversation',
          'task'
        )
      );
  END IF;
END $$;

UPDATE public.embeddings
SET
  memory_type = CASE
    WHEN memory_type IS NOT NULL THEN memory_type
    WHEN metadata->>'type' IN ('ask_message') THEN 'conversation'
    WHEN metadata->>'type' IN ('activity_atom', 'daily_event') THEN 'episodic'
    WHEN metadata->>'type' IN ('daily_summary', 'weekly_summary', 'monthly_summary', 'insight_source') THEN 'semantic'
    ELSE 'semantic'
  END,
  source = CASE
    WHEN source IS NOT NULL THEN source
    WHEN metadata->>'provider' IS NOT NULL THEN metadata->>'provider'
    WHEN metadata->>'type' IN ('ask_message') THEN 'agent'
    WHEN metadata->>'type' IN ('daily_event') THEN 'daily_event'
    WHEN metadata->>'type' IN ('daily_summary', 'weekly_summary', 'monthly_summary') THEN 'summary'
    WHEN metadata->>'type' IN ('insight_source') THEN 'insight'
    ELSE 'agent'
  END,
  source_id = COALESCE(source_id, metadata->>'source_id'),
  importance = CASE
    WHEN metadata->>'importance' IS NULL THEN importance
    ELSE GREATEST(0.1, LEAST(2.0, (metadata->>'importance')::DOUBLE PRECISION))
  END
WHERE memory_type IS NULL OR source IS NULL OR source_id IS NULL OR metadata->>'importance' IS NOT NULL;

UPDATE public.embeddings
SET
  content_hash = md5(COALESCE(content, '')),
  expires_at = CASE
    WHEN expires_at IS NOT NULL THEN expires_at
    WHEN metadata->>'type' = 'ask_message' THEN created_at + INTERVAL '7 days'
    ELSE NULL
  END,
  ttl = CASE
    WHEN ttl IS NOT NULL THEN ttl
    WHEN metadata->>'type' = 'ask_message' THEN INTERVAL '7 days'
    ELSE NULL
  END
WHERE content_hash IS NULL OR expires_at IS NULL OR ttl IS NULL;

CREATE INDEX IF NOT EXISTS idx_embeddings_user_memory_type
  ON public.embeddings(user_id, memory_type);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_source
  ON public.embeddings(user_id, source);

CREATE INDEX IF NOT EXISTS idx_embeddings_user_created_at
  ON public.embeddings(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_embeddings_expires_at
  ON public.embeddings(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_embeddings_user_content_hash
  ON public.embeddings(user_id, content_hash);

-- Semantic search function with optional filters for RAG retrieval.
CREATE OR REPLACE FUNCTION public.match_embeddings(
  query_embedding VECTOR(1536),
  match_user_id UUID,
  match_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10,
  match_type TEXT DEFAULT NULL,
  match_memory_types TEXT[] DEFAULT NULL,
  match_sources TEXT[] DEFAULT NULL,
  include_expired BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  content TEXT,
  metadata JSONB,
  similarity FLOAT,
  created_at TIMESTAMPTZ,
  memory_type TEXT,
  source TEXT,
  source_id TEXT,
  importance DOUBLE PRECISION,
  expires_at TIMESTAMPTZ
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
    e.created_at,
    e.memory_type,
    e.source,
    e.source_id,
    e.importance,
    e.expires_at
  FROM public.embeddings e
  WHERE e.user_id = match_user_id
    AND (match_type IS NULL OR e.metadata->>'type' = match_type)
    AND (
      match_memory_types IS NULL
      OR COALESCE(e.memory_type, 'semantic') = ANY(match_memory_types)
    )
    AND (
      match_sources IS NULL
      OR COALESCE(e.source, 'agent') = ANY(match_sources)
    )
    AND (
      include_expired = TRUE
      OR e.expires_at IS NULL
      OR e.expires_at > NOW()
    )
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
