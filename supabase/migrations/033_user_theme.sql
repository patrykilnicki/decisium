-- ============================================
-- User theme preference (light / dark / system)
-- ============================================

ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'system';

COMMENT ON COLUMN public.users.theme IS
  'UI theme: light, dark, or system (follow OS preference).';
