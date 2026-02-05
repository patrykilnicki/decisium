import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createCalendarWatchService } from "@/lib/integrations";

// Service role for webhook (no user session)
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);

/**
 * POST /api/webhooks/google-calendar
 * Google Calendar push notification webhook.
 *
 * Industry standard approach:
 * - Respond immediately with 200 (within ~1s)
 * - Enqueue sync for async processing
 * - Cron runs every 1 min to process pending syncs
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId) {
    return NextResponse.json(
      { error: "Missing X-Goog-Channel-ID" },
      { status: 400 },
    );
  }

  // Quick lookup of watch by channel ID
  const watchService = createCalendarWatchService(supabase);
  const watch = await watchService.getWatchByChannelId(channelId);

  if (!watch) {
    // Unknown channel - return 200 to prevent Google from retrying
    return new NextResponse(null, { status: 200 });
  }

  // Ignore sync notifications (sent when watch is created)
  if (resourceState === "sync") {
    return new NextResponse(null, { status: 200 });
  }

  // Only process 'exists' (changes occurred)
  if (resourceState !== "exists") {
    console.log(`[webhook] Ignoring resourceState: ${resourceState}`);
    return new NextResponse(null, { status: 200 });
  }

  console.log(
    `[webhook] Calendar change for integration ${watch.integrationId}`,
  );

  // Enqueue for async processing by cron (runs every 1 min)
  const { error: enqueueError } = await supabase
    .from("pending_calendar_syncs")
    .upsert(
      {
        integration_id: watch.integrationId,
        sync_token: watch.syncToken,
        created_at: new Date().toISOString(),
      },
      { onConflict: "integration_id" },
    );

  if (enqueueError) {
    console.error("[webhook] Failed to enqueue sync:", enqueueError);
  } else {
    console.log(
      `[webhook] Enqueued sync for integration ${watch.integrationId}`,
    );
  }

  // Return 200 immediately - cron will process the sync
  return new NextResponse(null, { status: 200 });
}
