-- ============================================
-- Todo email scope: user-configurable filters for which emails generate to-do tasks
-- ============================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS todo_email_scope JSONB DEFAULT NULL;

COMMENT ON COLUMN public.users.todo_email_scope IS
  'Optional filters for to-do generation: labelIdsAccepted, labelIdsBlocked, sendersAccepted, sendersBlocked (each string[]). NULL or {} = no filter.';
