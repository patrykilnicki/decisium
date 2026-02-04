import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createCalendarWatchService } from '@/lib/integrations';

// Service role for webhook (no user session)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/webhooks/google-calendar
 * Google Calendar push notification webhook.
 * We enqueue a pending sync and return 200 immediately so we don't timeout.
 * Cron /api/cron/process-pending-calendar-syncs runs every 2 min and processes the queue.
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get('x-goog-channel-id');
  const resourceState = request.headers.get('x-goog-resource-state');

  if (!channelId) {
    return NextResponse.json({ error: 'Missing X-Goog-Channel-ID' }, { status: 400 });
  }

  const watchService = createCalendarWatchService(supabase);
  const watch = await watchService.getWatchByChannelId(channelId);

  if (!watch) {
    return new NextResponse(null, { status: 200 });
  }

  if (resourceState === 'sync') {
    return new NextResponse(null, { status: 200 });
  }

  if (resourceState !== 'exists') {
    console.log(`[webhook] Ignoring resourceState: ${resourceState}`);
    return new NextResponse(null, { status: 200 });
  }

  console.log(`[webhook] Enqueueing sync for integration ${watch.integrationId} (syncToken: ${watch.syncToken ? 'present' : 'null'})`);

  // Enqueue pending sync so cron can run it with full timeout (avoids webhook 30s limit)
  const { data, error } = await supabase
    .from('pending_calendar_syncs')
    .upsert(
      {
        integration_id: watch.integrationId,
        sync_token: watch.syncToken,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'integration_id' }
    )
    .select();

  if (error) {
    console.error('[webhook] Failed to enqueue pending sync:', error);
  } else {
    console.log(`[webhook] Successfully enqueued pending sync for integration ${watch.integrationId}`);
  }

  return new NextResponse(null, { status: 200 });
}
