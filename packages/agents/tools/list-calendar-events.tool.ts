import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import * as db from "@/lib/supabase/db";
import { getTaskContext } from "../lib/task-context";

/**
 * List calendar events from Supabase (activity_atoms). Read path only.
 * Create/update/delete events must go through Composio (Google Calendar API).
 */
export const listCalendarEventsTool = new DynamicStructuredTool({
  name: "list_calendar_events",
  description:
    "List the user's calendar events in a date range. Reads from the synced calendar data (Supabase). Use this for 'what do I have', 'show my meetings', 'agenda for tomorrow', etc. For creating, updating or deleting events use Composio tools (GOOGLECALENDAR_CREATE_EVENT, GOOGLECALENDAR_UPDATE_EVENT, GOOGLECALENDAR_DELETE_EVENT).",
  schema: z.object({
    userId: z.string().uuid().optional().describe("Authenticated user id"),
    timeMin: z
      .string()
      .describe(
        "Start of range, ISO 8601 datetime (e.g. 2026-02-28T00:00:00.000Z)",
      ),
    timeMax: z
      .string()
      .describe(
        "End of range, ISO 8601 datetime (e.g. 2026-02-28T23:59:59.999Z)",
      ),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .optional()
      .describe("Maximum number of events to return"),
  }),
  func: async ({ userId: argsUserId, timeMin, timeMax, maxResults = 50 }) => {
    const contextUserId = getTaskContext()?.userId;
    const userId = argsUserId ?? contextUserId;
    if (!userId) {
      throw new Error("userId is required to list calendar events");
    }

    const supabase = createAdminClient();
    const { data, error } = await db.selectMany(
      supabase,
      "activity_atoms",
      {
        user_id: userId,
        atom_type: "event",
        provider: "google_calendar",
      },
      {
        columns:
          "id, title, occurred_at, duration_minutes, participants, source_url, content, metadata",
        rangeFilters: { occurred_at: { gte: timeMin, lte: timeMax } },
        order: { column: "occurred_at", ascending: true },
        limit: maxResults,
      },
    );

    if (error) {
      throw new Error(`Failed to list calendar events: ${error.message}`);
    }

    const events = (data ?? []).map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      let endAt: string | null = null;
      if (row.duration_minutes != null && row.duration_minutes > 0) {
        const end = new Date(
          new Date(row.occurred_at).getTime() +
            row.duration_minutes * 60 * 1000,
        );
        endAt = end.toISOString();
      }
      return {
        id: row.id,
        title: row.title ?? "Untitled",
        start: row.occurred_at,
        end: endAt,
        durationMinutes: row.duration_minutes,
        participants: row.participants ?? [],
        sourceUrl: row.source_url ?? undefined,
        location:
          typeof metadata.location === "string" ? metadata.location : undefined,
        description: row.content
          ? String(row.content).slice(0, 500)
          : undefined,
      };
    });

    return JSON.stringify({ events, count: events.length });
  },
});
