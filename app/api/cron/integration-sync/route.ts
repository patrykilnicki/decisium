import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import {
  createOAuthManager,
  createSyncPipeline,
  createInsightGenerator,
} from '@/lib/integrations';

// Use service role for cron jobs
const supabase = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * POST /api/cron/integration-sync
 * Cron job to sync all active integrations and generate insights
 * 
 * This should be called periodically (e.g., every 15 minutes) by your cron service
 * Protect this endpoint with a secret header in production
 */
export async function POST(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const results: Array<{
    userId: string;
    provider: string;
    status: string;
    atomsProcessed?: number;
    error?: string;
  }> = [];

  try {
    // Get all active integrations
    const { data: integrations, error: queryError } = await supabase
      .from('integrations')
      .select('id, user_id, provider')
      .eq('status', 'active');

    if (queryError) {
      throw new Error(`Failed to fetch integrations: ${queryError.message}`);
    }

    if (!integrations || integrations.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active integrations to sync',
        results: [],
      });
    }

    const oauthManager = createOAuthManager(supabase);
    const syncPipeline = createSyncPipeline(supabase, oauthManager);

    // Sync each integration
    for (const integration of integrations) {
      try {
        const progress = await syncPipeline.sync(integration.id, {
          generateEmbeddings: true,
        });

        results.push({
          userId: integration.user_id,
          provider: integration.provider,
          status: progress.status,
          atomsProcessed: progress.atomsProcessed,
          error: progress.error,
        });
      } catch (error) {
        results.push({
          userId: integration.user_id,
          provider: integration.provider,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Generate daily insights for users who had syncs
    const userIds = [...new Set(results.map((r) => r.userId))];
    const insightGenerator = createInsightGenerator(supabase);

    for (const userId of userIds) {
      try {
        await insightGenerator.generateDailyDigest(userId, new Date());
      } catch (error) {
        console.error(`Failed to generate insights for user ${userId}:`, error);
      }
    }

    const successCount = results.filter((r) => r.status === 'completed').length;
    const errorCount = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      message: `Synced ${successCount} integrations, ${errorCount} errors`,
      results,
    });
  } catch (error) {
    console.error('Error in integration sync cron:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/integration-sync
 * Health check for the cron endpoint
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/cron/integration-sync',
    description: 'Cron job for syncing integrations and generating insights',
  });
}
