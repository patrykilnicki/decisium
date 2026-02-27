-- ============================================
-- To-do snapshots generated from integrations
-- ============================================

CREATE TABLE IF NOT EXISTS public.todo_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('latest', 'regenerate')),
  window_from TIMESTAMPTZ NOT NULL,
  window_to TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_from_event TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todo_snapshots_user_created
  ON public.todo_snapshots(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_snapshots_window
  ON public.todo_snapshots(user_id, window_from DESC, window_to DESC);

ALTER TABLE public.todo_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own todo snapshots" ON public.todo_snapshots
  FOR SELECT USING (auth.uid() = user_id);
