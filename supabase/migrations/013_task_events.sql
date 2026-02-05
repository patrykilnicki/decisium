-- ============================================
-- Task event log (append-only)
-- ============================================

CREATE TABLE IF NOT EXISTS public.task_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  node_key TEXT,
  event_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency and fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_events_unique
  ON public.task_events(task_id, event_key);
CREATE INDEX IF NOT EXISTS idx_task_events_session
  ON public.task_events(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_events_task
  ON public.task_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_events_user
  ON public.task_events(user_id, created_at DESC);

-- RLS: read-only for users, service role writes/updates
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own task events" ON public.task_events
  FOR SELECT USING (auth.uid() = user_id);
