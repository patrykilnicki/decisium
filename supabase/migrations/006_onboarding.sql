-- Add onboarding tracking columns to users table
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Create index for faster onboarding status lookups
CREATE INDEX IF NOT EXISTS idx_users_onboarding ON public.users(id) WHERE onboarding_completed = FALSE;
