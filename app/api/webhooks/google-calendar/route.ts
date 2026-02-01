import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createOAuthManager, createSyncPipeline, createCalendarWatchService } from '@/lib/integrations';

// Service role for webhook (no user session)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/webhooks/google-calendar
 * Google Calendar push notification webhook.
 * Google sends POST with X-Goog-* headers when events change.
 * Must respond with 200/201/202/204 quickly; process sync async.
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
    // Unknown channel - return 200 to stop Google retrying
    return new NextResponse(null, { status: 200 });
  }

  // sync = channel created; exists = events changed
  if (resourceState === 'sync') {
    return new NextResponse(null, { status: 200 });
  }

  if (resourceState !== 'exists') {
    return new NextResponse(null, { status: 200 });
  }

  // Fire-and-forget incremental sync (don't await)
  runIncrementalSync(watch.integrationId, watch.syncToken ?? undefined).catch((err) => {
    console.error(`[webhook] Incremental sync failed for ${watch.integrationId}:`, err);
  });

  return new NextResponse(null, { status: 200 });
}

async function runIncrementalSync(integrationId: string, syncToken?: string): Promise<void> {
  const oauthManager = createOAuthManager(supabase);
  const syncPipeline = createSyncPipeline(supabase, oauthManager);

  await syncPipeline.sync(integrationId, {
    syncToken,
    fullSync: !syncToken,
    generateEmbeddings: true,
    calendarId: 'primary',
  });
}
