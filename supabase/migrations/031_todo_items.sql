-- ============================================
-- Todo items as per-task records
-- Source of truth for individual tasks
-- ============================================

CREATE TABLE IF NOT EXISTS public.todo_items (
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  date DATE NOT NULL,
  snapshot_id UUID REFERENCES public.todo_snapshots(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('normal', 'urgent')),
  urgent_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'done')) DEFAULT 'open',
  due_at TIMESTAMPTZ,
  source_provider TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  suggested_next_action TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_todo_items_user_date
  ON public.todo_items(user_id, date);

CREATE INDEX IF NOT EXISTS idx_todo_items_user_date_status
  ON public.todo_items(user_id, date, status);

CREATE INDEX IF NOT EXISTS idx_todo_items_user_source
  ON public.todo_items(user_id, source_provider, source_type);

CREATE INDEX IF NOT EXISTS idx_todo_items_user_thread
  ON public.todo_items(user_id, ((source_ref->>'threadId')));

ALTER TABLE public.todo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own todo items" ON public.todo_items;
CREATE POLICY "Users can view own todo items" ON public.todo_items
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own todo items" ON public.todo_items;
CREATE POLICY "Users can insert own todo items" ON public.todo_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own todo items" ON public.todo_items;
CREATE POLICY "Users can update own todo items" ON public.todo_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own todo items" ON public.todo_items;
CREATE POLICY "Users can delete own todo items" ON public.todo_items
  FOR DELETE USING (auth.uid() = user_id);

-- Backfill per-task rows from snapshot payload.items (idempotent).
INSERT INTO public.todo_items (
  user_id,
  id,
  date,
  snapshot_id,
  title,
  summary,
  priority,
  urgent_reason,
  status,
  due_at,
  source_provider,
  source_type,
  source_ref,
  confidence,
  tags,
  suggested_next_action
)
SELECT
  ts.user_id,
  item->>'id' AS id,
  ts.date,
  ts.id AS snapshot_id,
  COALESCE(item->>'title', '') AS title,
  COALESCE(item->>'summary', '') AS summary,
  CASE
    WHEN item->>'priority' IN ('normal', 'urgent') THEN item->>'priority'
    ELSE 'normal'
  END AS priority,
  NULLIF(item->>'urgentReason', '') AS urgent_reason,
  CASE
    WHEN item->>'status' IN ('open', 'in_progress', 'done') THEN item->>'status'
    ELSE 'open'
  END AS status,
  CASE
    WHEN item->>'dueAt' IS NULL OR item->>'dueAt' = '' THEN NULL
    ELSE (item->>'dueAt')::timestamptz
  END AS due_at,
  COALESCE(item->>'sourceProvider', 'unknown') AS source_provider,
  COALESCE(item->>'sourceType', 'unknown') AS source_type,
  CASE
    WHEN jsonb_typeof(item->'sourceRef') = 'object' THEN item->'sourceRef'
    ELSE '{}'::jsonb
  END AS source_ref,
  LEAST(1, GREATEST(0, COALESCE((item->>'confidence')::double precision, 0.8))) AS confidence,
  CASE
    WHEN jsonb_typeof(item->'tags') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(item->'tags'))
    ELSE '{}'::text[]
  END AS tags,
  COALESCE(item->>'suggestedNextAction', '') AS suggested_next_action
FROM public.todo_snapshots ts
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ts.payload->'items', '[]'::jsonb)) AS item
WHERE item->>'id' IS NOT NULL AND item->>'id' <> ''
ON CONFLICT (user_id, id) DO UPDATE SET
  date = EXCLUDED.date,
  snapshot_id = EXCLUDED.snapshot_id,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  priority = EXCLUDED.priority,
  urgent_reason = EXCLUDED.urgent_reason,
  status = EXCLUDED.status,
  due_at = EXCLUDED.due_at,
  source_provider = EXCLUDED.source_provider,
  source_type = EXCLUDED.source_type,
  source_ref = EXCLUDED.source_ref,
  confidence = EXCLUDED.confidence,
  tags = EXCLUDED.tags,
  suggested_next_action = EXCLUDED.suggested_next_action,
  updated_at = NOW();

-- Keep snapshots as metadata-only history records.
UPDATE public.todo_snapshots
SET payload = payload - 'items'
WHERE payload ? 'items';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'todo_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_items;
  END IF;
END $$;
