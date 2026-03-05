-- ============================================
-- Composio webhook event logs (full request lifecycle)
-- One row per webhook request: trigger receipt → handler branch → result/errors.
-- Used for debugging Gmail/Calendar triggers and todo dispatch flow.
-- ============================================

CREATE TABLE IF NOT EXISTS public.composio_webhook_event_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type TEXT,
  trigger_slug TEXT,
  payload_metadata JSONB DEFAULT '{}'::jsonb,
  resolved_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  handler_branch TEXT,
  processing_steps JSONB DEFAULT '[]'::jsonb,
  result JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  http_status INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.composio_webhook_event_logs.event_type IS 'Composio payload type: composio.trigger.message, composio.connected_account.expired';
COMMENT ON COLUMN public.composio_webhook_event_logs.trigger_slug IS 'e.g. GMAIL_NEW_EMAIL_RECEIVED_TRIGGER, GMAIL_EMAIL_SENT_TRIGGER, GOOGLECALENDAR_*';
COMMENT ON COLUMN public.composio_webhook_event_logs.payload_metadata IS 'Composio metadata: log_id, trigger_id, connected_account_id, user_id (no full body)';
COMMENT ON COLUMN public.composio_webhook_event_logs.handler_branch IS 'What we did: signature_failed | parse_error | expired | ignored_type | ignored_trigger | calendar_sync | gmail_sent | gmail_new_or_calendar_todo';
COMMENT ON COLUMN public.composio_webhook_event_logs.processing_steps IS 'Optional steps for debugging: [{ step, ok, detail? }]';
COMMENT ON COLUMN public.composio_webhook_event_logs.result IS 'Outcome: dispatch { taskId, reused }, gmail { processed, updated, errors }, calendar { processed, stored }';

CREATE INDEX IF NOT EXISTS idx_composio_webhook_event_logs_created
  ON public.composio_webhook_event_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_composio_webhook_event_logs_trigger
  ON public.composio_webhook_event_logs(trigger_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_composio_webhook_event_logs_user
  ON public.composio_webhook_event_logs(resolved_user_id, created_at DESC) WHERE resolved_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_composio_webhook_event_logs_http_status
  ON public.composio_webhook_event_logs(http_status, created_at DESC);

ALTER TABLE public.composio_webhook_event_logs ENABLE ROW LEVEL SECURITY;

-- Backend only: insert from webhook handler; read via service role (e.g. dashboard).
CREATE POLICY "Backend can insert composio webhook event logs"
  ON public.composio_webhook_event_logs
  FOR INSERT
  WITH CHECK (true);
