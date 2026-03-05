-- ============================================
-- Todo prompt settings: toggles + custom instructions for task generation
-- ============================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS todo_prompt_settings JSONB DEFAULT NULL;

COMMENT ON COLUMN public.users.todo_prompt_settings IS
  'Optional: toggles (fromCalendar, fromEmails, replyTasks, fromNewsletters, prepForMeetings, fromAutomatedBots) and customInstructions string. NULL = use defaults.';
