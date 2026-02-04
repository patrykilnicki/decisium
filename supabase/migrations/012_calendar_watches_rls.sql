-- Migration: 012_calendar_watches_rls.sql
-- Description: RLS policies for calendar_watches so authenticated users and service role can manage watches for their integrations.
-- Fixes: "new row violates row-level security policy for table calendar_watches" when OAuth callback runs setupWatch.

-- Allow users to manage calendar_watches for integrations they own (same pattern as integration_credentials).
CREATE POLICY "Users can view calendar watches for their integrations"
  ON calendar_watches FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = calendar_watches.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert calendar watches for their integrations"
  ON calendar_watches FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = calendar_watches.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update calendar watches for their integrations"
  ON calendar_watches FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = calendar_watches.integration_id
      AND integrations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete calendar watches for their integrations"
  ON calendar_watches FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM integrations
      WHERE integrations.id = calendar_watches.integration_id
      AND integrations.user_id = auth.uid()
    )
  );
