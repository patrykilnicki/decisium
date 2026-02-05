import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { createCalendarWatchService } from "@/lib/integrations";
import { getAppUrl, getGoogleCalendarWebhookUrl } from "@/lib/utils/app-url";

// Use service role for cron jobs
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/**
 * POST /api/cron/renew-calendar-watches
 * Cron job to renew Google Calendar watches before they expire.
 * Google Calendar watches expire after 7 days max, so this should run daily.
 *
 * Schedule: daily (e.g., 0 0 * * *)
 */
export async function POST(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    integrationId: string;
    status: "renewed" | "skipped" | "error";
    expiresAt?: string;
    error?: string;
  }> = [];

  try {
    // Get all watches expiring within 2 days
    const twoDaysFromNow = Date.now() + 2 * 24 * 60 * 60 * 1000;

    const { data: expiringWatches, error: queryError } = await supabase
      .from("calendar_watches")
      .select("id, integration_id, expiration_ms")
      .lt("expiration_ms", twoDaysFromNow);

    if (queryError) {
      throw new Error(`Failed to fetch watches: ${queryError.message}`);
    }

    if (!expiringWatches || expiringWatches.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No watches need renewal",
        results: [],
      });
    }

    const watchService = createCalendarWatchService(supabase);
    const baseUrl = getAppUrl(request);
    const webhookUrl = getGoogleCalendarWebhookUrl(baseUrl);

    // Only renew if HTTPS (Google requirement)
    if (!webhookUrl.startsWith("https://")) {
      return NextResponse.json({
        success: true,
        message: "Skipping renewal - HTTPS required for webhooks",
        results: [],
      });
    }

    for (const watch of expiringWatches) {
      try {
        // Check if integration is still active
        const { data: integration } = await supabase
          .from("integrations")
          .select("status")
          .eq("id", watch.integration_id)
          .single();

        if (!integration || integration.status !== "active") {
          results.push({
            integrationId: watch.integration_id,
            status: "skipped",
            error: "Integration not active",
          });
          continue;
        }

        // Renew the watch (setupWatch will upsert)
        const newWatch = await watchService.setupWatch(
          watch.integration_id,
          webhookUrl,
        );

        results.push({
          integrationId: watch.integration_id,
          status: "renewed",
          expiresAt: new Date(newWatch.expirationMs).toISOString(),
        });
      } catch (error) {
        results.push({
          integrationId: watch.integration_id,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    const renewedCount = results.filter((r) => r.status === "renewed").length;
    const errorCount = results.filter((r) => r.status === "error").length;

    return NextResponse.json({
      success: true,
      message: `Renewed ${renewedCount} watches, ${errorCount} errors`,
      results,
    });
  } catch (error) {
    console.error("Error in watch renewal cron:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Renewal failed" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/cron/renew-calendar-watches
 * Health check for the cron endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/renew-calendar-watches",
    description:
      "Cron job for renewing Google Calendar watches before expiration",
  });
}
