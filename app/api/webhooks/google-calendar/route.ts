import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createOAuthManager, createSyncPipeline, createCalendarWatchService } from '@/lib/integrations';

const WEBHOOK_FETCH_TIMEOUT_MS = 30_000;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeout)
  );
}

// Service role for webhook (no user session); longer timeout so sync can complete
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { global: { fetch: fetchWithTimeout } }
);

/** Allow up to 30s so sync can complete (Vercel default is 10s). */
export const maxDuration = 30;

/**
 * POST /api/webhooks/google-calendar
 * Google Calendar push notification webhook.
 * Google sends POST with X-Goog-* headers when events change.
 * We await sync so the function stays alive until events are written to DB.
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

  // Await sync so the function stays alive until sync completes (avoids serverless cutoff).
  // We use a longer-timeout Supabase client so GET integrations doesn't time out.
  try {
    await runIncrementalSync(watch.integrationId, watch.syncToken ?? undefined);
  } catch (err) {
    console.error(`[webhook] Incremental sync failed for ${watch.integrationId}:`, err);
  }

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
