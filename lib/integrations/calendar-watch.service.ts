import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  createAdapter,
  getAdapterConfig,
  type IntegrationAdapter,
} from "@agents/integrations";
import { createOAuthManager } from "./oauth-manager";
// ============================================
// Types
// ============================================

export interface CalendarWatch {
  id: string;
  integrationId: string;
  calendarId: string;
  channelId: string;
  resourceId: string;
  resourceUri: string | null;
  expirationMs: number;
  syncToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// Calendar Watch Service
// ============================================

export class CalendarWatchService {
  private supabase: SupabaseClient<Database>;

  constructor(supabase: SupabaseClient<Database>) {
    this.supabase = supabase;
  }

  /**
   * Set up push notifications for a Google Calendar integration.
   */
  async setupWatch(
    integrationId: string,
    webhookUrl: string,
    options?: { calendarId?: string; ttlSeconds?: number },
  ): Promise<CalendarWatch> {
    const { data: integration, error: intError } = await this.supabase
      .from("integrations")
      .select("id, provider")
      .eq("id", integrationId)
      .eq("provider", "google_calendar")
      .single();

    if (intError || !integration) {
      throw new Error("Google Calendar integration not found");
    }

    const oauthManager = createOAuthManager(this.supabase);
    const accessToken = await oauthManager.getValidAccessToken(integrationId);

    const adapter = createAdapter(
      "google_calendar",
      getAdapterConfig("google_calendar"),
    ) as IntegrationAdapter & {
      setupWatch: (
        accessToken: string,
        webhookUrl: string,
        opts?: object,
      ) => Promise<object>;
    };
    const result = await adapter.setupWatch(accessToken, webhookUrl, {
      calendarId: options?.calendarId ?? "primary",
      channelToken: `integration=${integrationId}`,
      ttlSeconds: options?.ttlSeconds ?? 604800, // 7 days
    });

    const watchData = result as {
      channelId: string;
      resourceId: string;
      resourceUri?: string;
      expiration: number;
    };

    const { data: watch, error } = await this.supabase
      .from("calendar_watches")
      .upsert(
        {
          integration_id: integrationId,
          calendar_id: options?.calendarId ?? "primary",
          channel_id: watchData.channelId,
          resource_id: watchData.resourceId,
          resource_uri: watchData.resourceUri ?? null,
          expiration_ms: watchData.expiration,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "integration_id,calendar_id",
        },
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to store watch: ${error.message}`);
    }

    return this.mapWatch(watch);
  }

  /**
   * Stop push notifications for an integration.
   */
  async stopWatch(integrationId: string): Promise<void> {
    const { data: watch, error: fetchError } = await this.supabase
      .from("calendar_watches")
      .select("channel_id, resource_id")
      .eq("integration_id", integrationId)
      .single();

    if (fetchError || !watch) {
      return; // No watch to stop
    }

    try {
      const oauthManager = createOAuthManager(this.supabase);
      const accessToken = await oauthManager.getValidAccessToken(integrationId);

      const adapter = createAdapter(
        "google_calendar",
        getAdapterConfig("google_calendar"),
      ) as IntegrationAdapter & {
        stopWatch: (
          accessToken: string,
          channelId: string,
          resourceId: string,
        ) => Promise<void>;
      };
      await adapter.stopWatch(accessToken, watch.channel_id, watch.resource_id);
    } catch (err) {
      console.warn(
        "Failed to stop calendar watch (channel may have expired):",
        err,
      );
    }

    await this.supabase
      .from("calendar_watches")
      .delete()
      .eq("integration_id", integrationId);
  }

  /**
   * Get watch by channel ID (for webhook lookup).
   * Uses maybeSingle() so 0 rows return null instead of 406 from PostgREST.
   */
  async getWatchByChannelId(channelId: string): Promise<CalendarWatch | null> {
    const { data, error } = await this.supabase
      .from("calendar_watches")
      .select("*")
      .eq("channel_id", channelId)
      .maybeSingle();

    if (error || !data) return null;
    return this.mapWatch(data);
  }

  /**
   * Get watch by integration ID.
   * Uses maybeSingle() so 0 rows return null instead of 406 from PostgREST.
   */
  async getWatchByIntegrationId(
    integrationId: string,
  ): Promise<CalendarWatch | null> {
    const { data, error } = await this.supabase
      .from("calendar_watches")
      .select("*")
      .eq("integration_id", integrationId)
      .maybeSingle();

    if (error || !data) return null;
    return this.mapWatch(data);
  }

  /**
   * Update sync token after incremental sync.
   */
  async updateSyncToken(
    integrationId: string,
    syncToken: string,
  ): Promise<void> {
    await this.supabase
      .from("calendar_watches")
      .update({
        sync_token: syncToken,
        updated_at: new Date().toISOString(),
      })
      .eq("integration_id", integrationId);
  }

  private mapWatch(data: Record<string, unknown>): CalendarWatch {
    return {
      id: data.id as string,
      integrationId: data.integration_id as string,
      calendarId: data.calendar_id as string,
      channelId: data.channel_id as string,
      resourceId: data.resource_id as string,
      resourceUri: data.resource_uri as string | null,
      expirationMs: Number(data.expiration_ms),
      syncToken: data.sync_token as string | null,
      createdAt: new Date(data.created_at as string),
      updatedAt: new Date(data.updated_at as string),
    };
  }
}

export function createCalendarWatchService(
  supabase: SupabaseClient<Database>,
): CalendarWatchService {
  return new CalendarWatchService(supabase);
}
