-- Additional performance indexes

-- Index for date-based queries on daily_events
CREATE INDEX IF NOT EXISTS idx_daily_events_date ON public.daily_events(date DESC);

-- Index for metadata queries on embeddings (using BTREE for extracted text values)
CREATE INDEX IF NOT EXISTS idx_embeddings_metadata_type ON public.embeddings((metadata->>'type'));

-- Index for metadata date queries
CREATE INDEX IF NOT EXISTS idx_embeddings_metadata_date ON public.embeddings((metadata->>'date'));

-- GIN index on entire metadata JSONB column for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_embeddings_metadata_gin ON public.embeddings USING GIN (metadata);

-- Index for ask_threads updated_at for sorting
CREATE INDEX IF NOT EXISTS idx_ask_threads_updated ON public.ask_threads(updated_at DESC);
