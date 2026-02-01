-- Add subtype column for daily events (e.g. "welcome" for agent-initiated first message)
ALTER TABLE public.daily_events
  ADD COLUMN IF NOT EXISTS subtype TEXT;

-- Allow type = 'system' for welcome and other system events.
-- Inline CHECK in 001 creates constraint daily_events_type_check (Postgres default).
ALTER TABLE public.daily_events
  DROP CONSTRAINT IF EXISTS daily_events_type_check;

ALTER TABLE public.daily_events
  ADD CONSTRAINT daily_events_type_check
  CHECK (type IN ('note', 'question', 'note+question', 'answer', 'summary', 'system'));

