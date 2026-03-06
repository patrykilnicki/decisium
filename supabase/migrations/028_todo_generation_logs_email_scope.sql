-- ============================================
-- Todo generation logs: store email scope used when fetching Gmail signals
-- ============================================

ALTER TABLE public.todo_generation_logs
ADD COLUMN IF NOT EXISTS email_scope_used JSONB DEFAULT NULL;

COMMENT ON COLUMN public.todo_generation_logs.email_scope_used IS
  'Copy of users.todo_email_scope applied for this run (labelIdsAccepted, labelIdsBlocked, sendersAccepted, sendersBlocked). NULL = no filter.';
