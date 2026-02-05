import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { createOAuthManager, createSyncPipeline } from '@/lib/integrations';

const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Vercel invokes cron jobs with GET requests (see vercel.com/docs/cron-jobs).
 * When CRON_SECRET is set, Vercel sends Authorization: Bearer <CRON_SECRET>.
 * We run the same processing for both GET (Vercel automatic) and POST (manual).
 */
function isCronAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const vercelCronHeader = request.headers.get('x-vercel-cron');
  const cronSecret = process.env.CRON_SECRET;
  const isVercelCron = vercelCronHeader === '1';
  const isValidAuth = Boolean(cronSecret && authHeader === `Bearer ${cronSecret}`);
  return isVercelCron || isValidAuth;
}

async function processPendingSyncs(_triggeredBy: string) {
  void _triggeredBy;
  const { data: pending, error: fetchError } = await supabase
    .from('pending_calendar_syncs')
    .select('integration_id, sync_token, created_at');

  if (fetchError) {
    console.error('[process-pending-calendar-syncs] Error fetching pending syncs:', fetchError);
    return NextResponse.json(
      { success: false, processed: 0, error: fetchError.message },
      { status: 500 }
    );
  }

  if (!pending || pending.length === 0) {
    console.log('[process-pending-calendar-syncs] No pending syncs');
    return NextResponse.json({
      success: true,
      processed: 0,
      message: 'No pending syncs',
    });
  }

  console.log(`[process-pending-calendar-syncs] Found ${pending.length} pending sync(s)`);

  const oauthManager = createOAuthManager(supabase);
  const syncPipeline = createSyncPipeline(supabase, oauthManager);
  let processed = 0;
  const errors: Array<{ integrationId: string; error: string }> = [];

  for (const row of pending) {
    try {
      console.log(`[process-pending-calendar-syncs] Processing sync for integration ${row.integration_id} (syncToken: ${row.sync_token ? 'present' : 'none'})`);

      const progress = await syncPipeline.sync(row.integration_id, {
        syncToken: row.sync_token ?? undefined,
        fullSync: !row.sync_token,
        generateEmbeddings: true,
        calendarId: 'primary',
      });

      console.log(`[process-pending-calendar-syncs] Sync completed for ${row.integration_id}: status=${progress.status}, atomsProcessed=${progress.atomsProcessed}, atomsStored=${progress.atomsStored}`);

      if (progress.status === 'error') {
        throw new Error(progress.error || 'Sync failed');
      }

      await supabase
        .from('pending_calendar_syncs')
        .delete()
        .eq('integration_id', row.integration_id);

      processed++;
      console.log(`[process-pending-calendar-syncs] Successfully processed and deleted pending sync for ${row.integration_id}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[process-pending-calendar-syncs] Failed for ${row.integration_id}:`, errorMessage, err);
      errors.push({ integrationId: row.integration_id, error: errorMessage });
    }
  }

  return NextResponse.json({
    success: true,
    processed,
    total: pending.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}

/**
 * GET - Vercel invokes cron with GET. Run processing when request is authorized.
 * Unauthorized GET returns diagnostic info (pending count) for debugging.
 */
export async function GET(request: NextRequest) {
  if (isCronAuthorized(request)) {
    console.log('[process-pending-calendar-syncs] Starting cron run (triggered by: Vercel Cron GET)');
    return processPendingSyncs('Vercel Cron GET');
  }

  // Diagnostic: show pending syncs when called without auth (e.g. browser)
  const { data: pending, error } = await supabase
    .from('pending_calendar_syncs')
    .select('integration_id, sync_token, created_at')
    .order('created_at', { ascending: false });

  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/cron/process-pending-calendar-syncs',
    description: 'Processes pending calendar syncs (runs every 1 min via Vercel Cron). Use POST with Authorization: Bearer CRON_SECRET to run manually.',
    pendingCount: pending?.length ?? 0,
    pending: pending ?? [],
    error: error?.message,
  });
}

/**
 * POST - Manual trigger with Authorization: Bearer CRON_SECRET
 */
export async function POST(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[process-pending-calendar-syncs] Starting cron run (triggered by: manual POST)');
  return processPendingSyncs('manual POST');
}
