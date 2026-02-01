import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createOAuthManager, createSyncPipeline } from '@/lib/integrations';
import { Provider } from '@agents/integrations';

/**
 * POST /api/integrations/[provider]/sync
 * Trigger a manual sync for an integration
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Validate provider
    const validProviders = ['google_calendar', 'gmail', 'notion', 'linear'];
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: `Invalid provider: ${provider}` },
        { status: 400 }
      );
    }

    // Parse optional sync options from request body
    let syncOptions = {};
    try {
      const body = await request.json();
      syncOptions = {
        fullSync: body.fullSync,
        generateEmbeddings: body.generateEmbeddings ?? true,
      };
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Get integration
    const oauthManager = createOAuthManager(supabase);
    const integration = await oauthManager.getIntegrationByProvider(
      user.id,
      provider as Provider
    );

    if (!integration) {
      return NextResponse.json(
        { error: 'Integration not found' },
        { status: 404 }
      );
    }

    if (integration.status !== 'active') {
      return NextResponse.json(
        { error: `Integration is not active: ${integration.status}` },
        { status: 400 }
      );
    }

    // Run sync pipeline
    const syncPipeline = createSyncPipeline(supabase, oauthManager);
    const progress = await syncPipeline.sync(integration.id, syncOptions);

    if (progress.status === 'error') {
      return NextResponse.json(
        { error: progress.error || 'Sync failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      atomsProcessed: progress.atomsProcessed,
      atomsStored: progress.atomsStored,
      embeddingsGenerated: progress.embeddingsGenerated,
      hasMore: progress.hasMore,
      syncedAt: progress.completedAt?.toISOString(),
    });
  } catch (error) {
    console.error(`Error syncing ${provider}:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 }
    );
  }
}
