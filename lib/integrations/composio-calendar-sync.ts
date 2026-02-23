/**
 * Sync Google Calendar events from Composio to Supabase activity_atoms.
 *
 * Used when integrations are backed by Composio (metadata.composio_connected_account_id)
 * instead of custom OAuth tokens.
 *
 * @see https://docs.composio.dev/toolkits/googlecalendar
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/supabase";
import type { ActivityAtomInsert } from "@/types/database";
import {
  executeGoogleCalendarListEvents,
} from "@agents/lib/composio";

// Google Calendar API event shape (from Composio GOOGLECALENDAR_EVENTS_LIST)
interface GCalEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ email?: string; displayName?: string }>;
  location?: string;
  htmlLink?: string;
  recurrence?: string[];
  originalStartTime?: { dateTime?: string };
  recurringEventId?: string;
  organizer?: { email?: string; displayName?: string };
  conferenceData?: { entryPoints?: Array<{ uri?: string }> };
  eventType?: string;
  visibility?: string;
}

function truncateContent(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

function buildSemanticContent(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function eventToAtom(event: GCalEvent): Omit<ActivityAtomInsert, "user_id" | "integration_id" | "provider" | "synced_at"> | null {
  if (!event.id || (!event.start?.dateTime && !event.start?.date)) {
    return null;
  }

  const startTime = event.start?.dateTime ?? event.start?.date;
  const endTime = event.end?.dateTime ?? event.end?.date;

  let durationMinutes: number | undefined;
  if (startTime && endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    durationMinutes = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60),
    );
    if (durationMinutes > 24 * 60) {
      durationMinutes = undefined;
    }
  }

  const participants = (event.attendees ?? [])
    .map((a) => a.displayName ?? a.email ?? "")
    .filter(Boolean);

  const contentParts = [
    event.summary ?? "Untitled Event",
    event.description
      ? `Description: ${truncateContent(event.description, 500)}`
      : "",
    participants.length > 0 ? `Participants: ${participants.join(", ")}` : "",
    event.location ? `Location: ${event.location}` : "",
    event.conferenceData?.entryPoints?.[0]?.uri
      ? `Meeting link: ${event.conferenceData.entryPoints[0].uri}`
      : "",
  ];

  return {
    external_id: event.id,
    atom_type: "event",
    title: event.summary ?? "Untitled Event",
    content: buildSemanticContent(contentParts),
    occurred_at: new Date(startTime!).toISOString(),
    duration_minutes: durationMinutes,
    participants: participants.length > 0 ? participants : undefined,
    source_url: event.htmlLink ?? undefined,
    metadata: {
      status: event.status,
      recurrence: event.recurrence,
      location: event.location,
      conferenceUri: event.conferenceData?.entryPoints?.[0]?.uri,
      organizer: event.organizer?.email,
      organizerName: event.organizer?.displayName,
      isAllDay: !event.start?.dateTime,
      isMeeting: participants.length > 0 || !!event.conferenceData?.entryPoints?.length,
      eventType: event.eventType,
      visibility: event.visibility,
      calendarId: "primary",
      originalStartTime: event.originalStartTime?.dateTime,
      recurringEventId: event.recurringEventId,
    } as Json,
  };
}

export interface ComposioCalendarSyncOptions {
  /** Full sync (ignore sync cursor) */
  fullSync?: boolean;
  /** Sync from this date (ISO string) */
  since?: Date;
  /** Sync until this date (ISO string) */
  until?: Date;
  /** Max items per page */
  batchSize?: number;
}

export interface ComposioCalendarSyncResult {
  atomsProcessed: number;
  atomsStored: number;
  hasMore: boolean;
  error?: string;
}

/**
 * Sync calendar events from Composio to Supabase for a Composio-backed integration.
 *
 * @param supabase - Supabase client (service role for cron, or user context)
 * @param integrationId - Integration row ID
 * @param options - Sync options
 */
export async function syncComposioCalendarToSupabase(
  supabase: SupabaseClient<Database>,
  integrationId: string,
  options: ComposioCalendarSyncOptions = {},
): Promise<ComposioCalendarSyncResult> {
  const result: ComposioCalendarSyncResult = {
    atomsProcessed: 0,
    atomsStored: 0,
    hasMore: false,
  };

  const { data: integration, error: fetchError } = await supabase
    .from("integrations")
    .select("id, user_id, provider, metadata")
    .eq("id", integrationId)
    .single();

  if (fetchError || !integration) {
    result.error = fetchError?.message ?? "Integration not found";
    return result;
  }

  const metadata = integration.metadata as Record<string, unknown> | null;
  const connectedAccountId = metadata?.composio_connected_account_id as
    | string
    | undefined;

  if (!connectedAccountId) {
    result.error = "Integration is not Composio-backed";
    return result;
  }

  const userId = integration.user_id as string;
  const provider = integration.provider as string;

  const now = new Date();
  const since = options.since ?? new Date(now);
  since.setDate(since.getDate() - 90);
  const until = options.until ?? new Date(now);
  until.setDate(until.getDate() + 30);

  const timeMin = since.toISOString();
  const timeMax = until.toISOString();
  const maxResults = options.batchSize ?? 250;

  let pageToken: string | undefined;
  const allAtoms: Omit<ActivityAtomInsert, "user_id" | "integration_id" | "provider" | "synced_at">[] = [];

  do {
    const response = await executeGoogleCalendarListEvents(
      userId,
      connectedAccountId,
      {
        timeMin,
        timeMax,
        pageToken,
        calendarId: "primary",
        maxResults,
        singleEvents: true,
      },
    );

    if (!response.successful || response.error) {
      result.error = response.error ?? "Composio request failed";
      return result;
    }

    const items = (response.data?.items ?? []) as GCalEvent[];

    for (const event of items) {
      if (event.status === "cancelled" && event.id) {
        await supabase
          .from("activity_atoms")
          .delete()
          .eq("integration_id", integrationId)
          .eq("external_id", event.id);
        continue;
      }

      const atom = eventToAtom(event);
      if (atom) {
        allAtoms.push(atom);
      }
    }

    result.atomsProcessed += items.length;
    pageToken = response.data?.nextPageToken;
    result.hasMore = !!pageToken;
  } while (pageToken);

  if (allAtoms.length === 0) {
    await supabase
      .from("integrations")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integrationId);
    return result;
  }

  const syncedAt = new Date().toISOString();
  let stored = 0;

  for (const atom of allAtoms) {
    const { error: upsertError } = await supabase
      .from("activity_atoms")
      .upsert(
        {
          user_id: userId,
          integration_id: integrationId,
          provider,
          ...atom,
          synced_at: syncedAt,
        },
        {
          onConflict: "user_id,provider,external_id",
        },
      );

    if (!upsertError) {
      stored++;
    }
  }

  result.atomsStored = stored;

  await supabase
    .from("integrations")
    .update({
      last_sync_at: syncedAt,
      last_sync_status: "success",
      last_sync_error: null,
      updated_at: syncedAt,
    })
    .eq("id", integrationId);

  return result;
}
