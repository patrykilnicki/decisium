-- Migration: 011_pending_calendar_syncs.sql
-- Description: Queue for webhook-triggered calendar syncs (processed by cron)

CREATE TABLE pending_calendar_syncs (
  integration_id UUID PRIMARY KEY REFERENCES integrations(id) ON DELETE CASCADE,
  sync_token TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pending_calendar_syncs_created ON pending_calendar_syncs(created_at);

ALTER TABLE pending_calendar_syncs ENABLE ROW LEVEL SECURITY;
-- No policies: service role only (webhook + cron).
