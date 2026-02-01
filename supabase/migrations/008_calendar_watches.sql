-- Migration: 008_calendar_watches.sql
-- Description: Google Calendar Watch (webhooks) + sync token for incremental sync

-- ============================================
-- Calendar Watches (Google Calendar push notifications)
-- ============================================
CREATE TABLE calendar_watches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  calendar_id TEXT NOT NULL DEFAULT 'primary',

  -- Watch channel (from Google events.watch response)
  channel_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_uri TEXT,
  expiration_ms BIGINT NOT NULL,

  -- Incremental sync token (from events.list nextSyncToken)
  sync_token TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(integration_id, calendar_id)
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_calendar_watches_integration ON calendar_watches(integration_id);
CREATE INDEX idx_calendar_watches_channel ON calendar_watches(channel_id);
CREATE INDEX idx_calendar_watches_expiration ON calendar_watches(expiration_ms);

-- ============================================
-- RLS (backend-only table, no user policies)
-- ============================================
ALTER TABLE calendar_watches ENABLE ROW LEVEL SECURITY;

-- No policies: anon gets denied. Service role bypasses RLS for webhook/cron.
