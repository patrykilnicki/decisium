-- ============================================
-- Agent LLM usage log (append-only)
-- ============================================

CREATE TABLE IF NOT EXISTS public.agent_llm_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  session_id TEXT,
  task_type TEXT,
  node_key TEXT,
  agent_type TEXT,
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  estimated_cost_usd NUMERIC(12, 6),
  usage_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_llm_usage_user
  ON public.agent_llm_usage(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_llm_usage_task
  ON public.agent_llm_usage(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_llm_usage_session
  ON public.agent_llm_usage(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_llm_usage_agent
  ON public.agent_llm_usage(agent_type, created_at DESC);

-- RLS: read-only for users, service role writes/updates
ALTER TABLE public.agent_llm_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own LLM usage" ON public.agent_llm_usage
  FOR SELECT USING (auth.uid() = user_id);
