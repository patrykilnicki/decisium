-- ============================================
-- Reflection settings: on/off and trigger time per frequency
-- ============================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS reflection_settings JSONB DEFAULT NULL;

COMMENT ON COLUMN public.users.reflection_settings IS
  'Per-frequency reflection settings: daily, weekly, monthly, quarterly, yearly. Each can have enabled, time (HH:mm), and optional dayOfWeek (0-6), dayOfMonth (1-28/31), month (1-12).';