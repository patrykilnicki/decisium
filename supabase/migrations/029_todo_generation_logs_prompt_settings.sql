-- ============================================
-- Todo generation logs: store prompt settings used (toggles + custom instructions)
-- ============================================

ALTER TABLE public.todo_generation_logs
ADD COLUMN IF NOT EXISTS prompt_settings_used JSONB DEFAULT NULL;

COMMENT ON COLUMN public.todo_generation_logs.prompt_settings_used IS
  'Copy of effective todo_prompt_settings for this run: toggles (fromCalendar, fromEmails, replyTasks, fromNewsletters, prepForMeetings, fromAutomatedBots) and customInstructions. NULL = defaults.';
