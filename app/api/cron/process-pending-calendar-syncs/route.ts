import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createOAuthManager, createSyncPipeline } from '@/lib/integrations';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/cron/process-pending-calendar-syncs
 * Processes pending calendar syncs enqueued by the webhook (runs every 2 min).
 * Sync runs here with full timeout so events get written to DB.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: pending, error: fetchError } = await supabase
    .from('pending_calendar_syncs')
    .select('integration_id, sync_token');

  if (fetchError || !pending?.length) {
    return NextResponse.json({
      success: true,
      processed: 0,
      message: fetchError ? fetchError.message : 'No pending syncs',
    });
  }

  const oauthManager = createOAuthManager(supabase);
  const syncPipeline = createSyncPipeline(supabase, oauthManager);
  let processed = 0;

  for (const row of pending) {
    try {
      await syncPipeline.sync(row.integration_id, {
        syncToken: row.sync_token ?? undefined,
        fullSync: !row.sync_token,
        generateEmbeddings: true,
        calendarId: 'primary',
      });
      await supabase
        .from('pending_calendar_syncs')
        .delete()
        .eq('integration_id', row.integration_id);
      processed++;
    } catch (err) {
      console.error(`[process-pending-calendar-syncs] Failed for ${row.integration_id}:`, err);
      // Leave row in place so next run retries
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    total: pending.length,
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/cron/process-pending-calendar-syncs',
    description: 'Processes pending calendar syncs enqueued by webhook (every 2 min)',
  });
}
