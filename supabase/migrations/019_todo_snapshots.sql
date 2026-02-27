-- ============================================
-- To-do snapshots generated from integrations
-- One snapshot per user per date
-- ============================================

CREATE TABLE IF NOT EXISTS public.todo_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_from_event TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_todo_snapshots_user_date
  ON public.todo_snapshots(user_id, date);
CREATE INDEX IF NOT EXISTS idx_todo_snapshots_user_created
  ON public.todo_snapshots(user_id, created_at DESC);

ALTER TABLE public.todo_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own todo snapshots" ON public.todo_snapshots
  FOR SELECT USING (auth.uid() = user_id);
