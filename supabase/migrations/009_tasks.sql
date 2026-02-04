-- ============================================
-- Durable task execution
-- ============================================

CREATE TABLE IF NOT EXISTS public.tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB,
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast polling and session lookups
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON public.tasks(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON public.tasks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON public.tasks(user_id, created_at DESC);

-- RLS: read-only for users, service role writes/updates
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tasks" ON public.tasks
  FOR SELECT USING (auth.uid() = user_id);

-- Keep updated_at fresh on any update
CREATE OR REPLACE FUNCTION public.update_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_tasks_updated_at();

-- Claim tasks with FOR UPDATE SKIP LOCKED for safe concurrency
CREATE OR REPLACE FUNCTION public.claim_tasks(
  max_tasks INTEGER DEFAULT 1,
  stale_after_seconds INTEGER DEFAULT 300
)
RETURNS SETOF public.tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM public.tasks
    WHERE status = 'pending'
       OR (status = 'in_progress'
           AND updated_at < NOW() - make_interval(secs => stale_after_seconds))
    ORDER BY created_at ASC
    LIMIT max_tasks
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.tasks
  SET status = 'in_progress',
      updated_at = NOW()
  WHERE id IN (SELECT id FROM candidates)
  RETURNING *;
END;
$$;
