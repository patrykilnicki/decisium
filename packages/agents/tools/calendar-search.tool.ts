import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";

interface CalendarSearchRow {
  id: string;
  title: string | null;
  content: string;
  occurred_at: string;
  duration_minutes: number | null;
  participants: string[] | null;
  source_url: string | null;
  provider: string;
  atom_type: string;
  categories: string[] | null;
  importance: string | null;
}

/**
 * Calendar / activity search tool for querying `activity_atoms` with flexible
 * date ranges, provider / type filters, and optional text search.
 *
 * The orchestrator router decides which date range to use based on user intent
 * (e.g. "today", "this week", "next month", "meetings with Adrian", etc.).
 */
export const calendarSearchTool = new DynamicStructuredTool({
  name: "calendar_search",
  description:
    "Search calendar events and activities by date range. Use for ANY question about meetings, events, schedule, plans, or agenda. " +
    "You MUST determine startDate and endDate from user intent: " +
    "'today' → same day, 'tomorrow' → next day, 'this week' → current Mon-Sun, " +
    "'next week' → next Mon-Sun, 'this month' → first-last of current month, etc. " +
    "Use searchQuery to filter by participant name, project, or keyword.",
  schema: z.object({
    userId: z.string().describe("The user ID to search calendar for"),
    startDate: z
      .string()
      .describe(
        "Start date inclusive (YYYY-MM-DD). Determine from user query context.",
      ),
    endDate: z
      .string()
      .describe(
        "End date inclusive (YYYY-MM-DD). Determine from user query context.",
      ),
    provider: z
      .string()
      .optional()
      .describe(
        "Optional provider filter, e.g. 'google_calendar'. Omit to search all providers.",
      ),
    atomType: z
      .string()
      .optional()
      .describe(
        "Optional type filter: 'event', 'message', 'task', 'note', 'comment'. Omit for all types.",
      ),
    searchQuery: z
      .string()
      .optional()
      .describe(
        "Optional text search in title and content (case-insensitive). " +
          "Use for filtering by participant name, project name, or topic.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Max results to return. Default 50."),
  }),
  func: async ({
    userId,
    startDate,
    endDate,
    provider,
    atomType,
    searchQuery,
    limit,
  }) => {
    try {
      const client = createAdminClient();
      const maxResults = limit ?? 50;

      // Inclusive date window
      const windowStart = `${startDate}T00:00:00.000Z`;
      const windowEnd = `${endDate}T23:59:59.999Z`;

      let query = client
        .from("activity_atoms")
        .select(
          "id, title, content, occurred_at, duration_minutes, participants, source_url, provider, atom_type, categories, importance",
        )
        .eq("user_id", userId)
        .gte("occurred_at", windowStart)
        .lte("occurred_at", windowEnd)
        .order("occurred_at", { ascending: true })
        .limit(maxResults);

      if (provider) {
        query = query.eq("provider", provider);
      }
      if (atomType) {
        query = query.eq("atom_type", atomType);
      }
      if (searchQuery) {
        query = query.or(
          `title.ilike.%${searchQuery}%,content.ilike.%${searchQuery}%`,
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error("[calendar_search] Query error:", error);
        return JSON.stringify({
          results: [],
          total_found: 0,
          error: error.message,
          date_range: { startDate, endDate },
        });
      }

      const rows = (data ?? []) as CalendarSearchRow[];

      const formatted = rows.map((r) => {
        const date = r.occurred_at.slice(0, 10);
        const time = r.occurred_at.slice(11, 16);
        const title = r.title ?? "(No title)";
        const duration =
          r.duration_minutes != null ? ` (${r.duration_minutes} min)` : "";
        const participantsList = r.participants?.length
          ? `\nParticipants: ${r.participants.join(", ")}`
          : "";
        const link = r.source_url ? `\nLink: ${r.source_url}` : "";

        return {
          date,
          time,
          title,
          duration_minutes: r.duration_minutes,
          participants: r.participants,
          source_url: r.source_url,
          provider: r.provider,
          atom_type: r.atom_type,
          categories: r.categories,
          importance: r.importance,
          summary: `${date} ${time} - ${title}${duration}${participantsList}${link}`,
        };
      });

      console.log(
        `[calendar_search] Found ${rows.length} results for user ${userId} ` +
          `(${startDate} to ${endDate}${searchQuery ? `, query="${searchQuery}"` : ""})`,
      );

      return JSON.stringify({
        results: formatted,
        total_found: rows.length,
        date_range: { startDate, endDate },
        filters: {
          provider: provider ?? "all",
          atomType: atomType ?? "all",
          searchQuery: searchQuery ?? null,
        },
      });
    } catch (error) {
      console.error("[calendar_search] Error:", error);
      return JSON.stringify({
        results: [],
        total_found: 0,
        error: error instanceof Error ? error.message : "Unknown error",
        date_range: { startDate, endDate },
      });
    }
  },
});
