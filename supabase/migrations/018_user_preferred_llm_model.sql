-- ============================================
-- User preferred LLM model
-- ============================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS preferred_llm_model TEXT;

COMMENT ON COLUMN public.users.preferred_llm_model IS
  'Optional OpenRouter model id preferred by the user, e.g. google/gemini-3-flash-preview';
