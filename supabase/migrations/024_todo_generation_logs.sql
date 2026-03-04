-- ============================================
-- Todo generation logs (append-only, full debug)
-- Read only via service role / separate instance; no SELECT for app users.
-- ============================================

CREATE TABLE IF NOT EXISTS public.todo_generation_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  run_type TEXT NOT NULL,
  generated_from_event TEXT,
  signals_count INT NOT NULL DEFAULT 0,
  signals_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  llm_system_prompt_preview TEXT,
  llm_user_content_preview TEXT,
  llm_raw_response TEXT,
  extracted_count INT NOT NULL DEFAULT 0,
  extracted_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_ms INT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todo_generation_logs_user_created
  ON public.todo_generation_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_generation_logs_date
  ON public.todo_generation_logs(date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_todo_generation_logs_run_type
  ON public.todo_generation_logs(run_type, created_at DESC);

ALTER TABLE public.todo_generation_logs ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for authenticated users: only service role can read (e.g. separate dashboard instance).
-- Allow insert from service role / backend (authenticated as same user_id is allowed to insert for audit).
CREATE POLICY "Backend can insert todo generation logs"
  ON public.todo_generation_logs
  FOR INSERT
  WITH CHECK (true);
