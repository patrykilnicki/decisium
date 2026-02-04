import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createCalendarWatchService, createOAuthManager, createSyncPipeline } from '@/lib/integrations';

// Service role for webhook (no user session)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/webhooks/google-calendar
 * Google Calendar push notification webhook.
 * 
 * Industry standard approach (like Notion, Calendly):
 * - Respond immediately with 200 (within ~1s)
 * - Process sync asynchronously (fire-and-forget)
 * - Fallback to queue if processing fails/times out
 * - Cron runs every 2 min as backup for missed webhooks
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

  console.log(`[webhook] Processing sync for integration ${watch.integrationId} (syncToken: ${watch.syncToken ? 'present' : 'null'})`);

  // Enqueue immediately (ensures sync happens even if instant processing fails)
  const enqueueStart = Date.now();
  const { data: enqueueData, error: enqueueError } = await supabase
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

  const enqueueDuration = Date.now() - enqueueStart;
  console.log(`[webhook] Enqueued pending sync in ${enqueueDuration}ms`);

  if (enqueueError) {
    console.error('[webhook] Failed to enqueue pending sync:', enqueueError);
  } else {
    console.log(`[webhook] Successfully enqueued pending sync (integration_id: ${watch.integrationId})`);
  }

  // Process sync immediately (fire-and-forget) - don't await, return 200 right away
  // This provides instant sync while webhook responds quickly (industry standard)
  processSyncImmediately(watch.integrationId, watch.syncToken).catch((error) => {
    console.error('[webhook] Instant sync failed, will be processed by cron:', error);
    // Sync is already enqueued, so cron will pick it up
  });

  return new NextResponse(null, { status: 200 });
}

/**
 * Process sync immediately in background (fire-and-forget).
 * If this completes successfully, the pending sync will be removed.
 * If it fails or times out, the cron will process it.
 * 
 * Uses a shorter timeout (15s) to fail fast and let cron handle it.
 * Network issues between Vercel and Supabase can cause long delays.
 */
async function processSyncImmediately(integrationId: string, syncToken: string | null): Promise<void> {
  const TIMEOUT_MS = 15 * 1000; // 15 seconds max - fail fast, let cron handle it
  
  try {
    const syncPromise = (async () => {
      const oauthManager = createOAuthManager(supabase);
      const syncPipeline = createSyncPipeline(supabase, oauthManager);

      console.log(`[webhook] Starting instant sync for integration ${integrationId}`);

      // Verify integration exists before attempting sync (helps debug timeout issues)
      // Use shorter timeout for this check (5s)
      const fetchStart = Date.now();
      console.log(`[webhook] Fetching integration ${integrationId}...`);
      
      const integration = await Promise.race([
        oauthManager.getIntegration(integrationId),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            const duration = Date.now() - fetchStart;
            console.warn(`[webhook] Timeout fetching integration ${integrationId} after ${duration}ms (5s limit) - will be processed by cron`);
            resolve(null);
          }, 5000)
        ),
      ]);

      const fetchDuration = Date.now() - fetchStart;
      console.log(`[webhook] Integration fetch completed in ${fetchDuration}ms`);

      if (!integration) {
        throw new Error(`Integration ${integrationId} not found or timeout - will be processed by cron`);
      }

      console.log(`[webhook] Integration found: ${integration.provider}, status: ${integration.status}`);

      const progress = await syncPipeline.sync(integrationId, {
        syncToken: syncToken ?? undefined,
        fullSync: !syncToken,
        generateEmbeddings: true,
        calendarId: 'primary',
      });

      if (progress.status === 'error') {
        throw new Error(progress.error || 'Sync failed');
      }

      // Remove from pending queue since we processed it successfully
      await supabase
        .from('pending_calendar_syncs')
        .delete()
        .eq('integration_id', integrationId);

      console.log(`[webhook] Instant sync completed: ${progress.atomsStored} atoms stored for integration ${integrationId}`);
    })();

    // Race between sync and timeout
    await Promise.race([
      syncPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Instant sync timeout (15s) - will be processed by cron')), TIMEOUT_MS)
      ),
    ]);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isNetworkError = errorMessage.includes('ECONNRESET') || errorMessage.includes('fetch failed') || errorMessage.includes('timeout');
    
    if (isNetworkError) {
      console.warn(`[webhook] Network error during instant sync for ${integrationId} - will be processed by cron:`, errorMessage);
    } else {
      console.error(`[webhook] Instant sync failed for ${integrationId}:`, errorMessage);
    }
    // Don't throw - let cron handle it via the pending queue
  }
}
