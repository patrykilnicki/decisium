import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

export interface TodayMeetingRow {
  id: string;
  title: string | null;
  occurred_at: string;
  duration_minutes: number | null;
  participants: string[] | null;
  source_url: string | null;
}

/**
 * Fetch today's calendar events (meetings) from activity_atoms for a given user and date.
 * Uses the same 3-day window + date filter as the daily page so agent and UI see the same data.
 * Call with admin client from task worker; use getTodayMeetings() from app/actions/daily for request context (user session).
 */
export async function getTodayMeetingsForUser(
  userId: string,
  date: string,
  client: SupabaseClient<Database>,
): Promise<TodayMeetingRow[]> {
  const [y, m, d] = date.split("-").map(Number);
  const windowStart = new Date(Date.UTC(y, m - 1, d - 1, 0, 0, 0, 0));
  const windowEnd = new Date(Date.UTC(y, m - 1, d + 2, 0, 0, 0, 0));

  const { data, error } = await client
    .from("activity_atoms")
    .select(
      "id, title, occurred_at, duration_minutes, participants, source_url",
    )
    .eq("user_id", userId)
    .eq("atom_type", "event")
    .eq("provider", "google_calendar")
    .gte("occurred_at", windowStart.toISOString())
    .lt("occurred_at", windowEnd.toISOString())
    .order("occurred_at", { ascending: true });

  if (error) {
    console.error("[getTodayMeetingsForUser] Failed to fetch:", error);
    return [];
  }

  const rows = (data ?? []) as TodayMeetingRow[];
  return rows.filter((row) => row.occurred_at.slice(0, 10) === date);
}

/**
 * Format today's meetings for injection into the daily agent context.
 */
export function formatTodayMeetingsForContext(
  meetings: TodayMeetingRow[],
): string {
  if (meetings.length === 0) {
    return "Today's calendar: No events.";
  }

  const lines = meetings.map((m) => {
    const time = m.occurred_at.slice(11, 16);
    const title = m.title ?? "(No title)";
    const duration =
      m.duration_minutes != null ? ` (${m.duration_minutes} min)` : "";
    return `- ${time} ${title}${duration}`;
  });
  return `Today's calendar (${meetings.length} event${meetings.length === 1 ? "" : "s"}):\n${lines.join("\n")}`;
}
