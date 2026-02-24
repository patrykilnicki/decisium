-- ============================================
-- Agent prompt logs (append-only, redacted)
-- ============================================

CREATE TABLE IF NOT EXISTS public.agent_prompt_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  session_id TEXT,
  task_type TEXT,
  node_key TEXT,
  agent_type TEXT NOT NULL,
  model TEXT,
  temperature NUMERIC(4, 2),
  system_prompt TEXT NOT NULL DEFAULT '',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_prompt_logs_user
  ON public.agent_prompt_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_logs_task
  ON public.agent_prompt_logs(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_logs_session
  ON public.agent_prompt_logs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_prompt_logs_agent
  ON public.agent_prompt_logs(agent_type, created_at DESC);

ALTER TABLE public.agent_prompt_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prompt logs" ON public.agent_prompt_logs
  FOR SELECT USING (auth.uid() = user_id);
