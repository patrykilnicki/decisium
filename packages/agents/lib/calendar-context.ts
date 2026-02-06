import { createAdminClient } from "@/lib/supabase/admin";

interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  label: string; // human-readable description
}

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function getMonday(d: Date): Date {
  const r = new Date(d);
  const dow = r.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  r.setUTCDate(r.getUTCDate() + diff);
  return r;
}

// ═══════════════════════════════════════════════════════════════
// KEYWORD-BASED DATE RANGE EXTRACTION
// ═══════════════════════════════════════════════════════════════

const CALENDAR_KEYWORDS = [
  // Polish
  "spotkani",
  "kalendarz",
  "harmonogram",
  "plan",
  "wydarzeni",
  "agenda",
  "dzisiaj",
  "dziś",
  "jutro",
  "wczoraj",
  "tydzień",
  "tydzien",
  "tygodni",
  "miesiąc",
  "miesiac",
  "podsumowanie",
  "co mam",
  "co jest",
  "co było",
  "co będzie",
  "co bedzie",
  // English
  "meeting",
  "calendar",
  "schedule",
  "event",
  "today",
  "tomorrow",
  "yesterday",
  "week",
  "month",
  "agenda",
  "plans",
];

/**
 * Extract a date range from a user query using keyword matching.
 * Returns null when the query does not appear to be calendar-related.
 *
 * This is a fast, zero-LLM-call approach used by the linear root agent.
 */
export function extractDateRangeFromQuery(
  query: string,
  currentDate: string,
): DateRange | null {
  const q = query.toLowerCase();

  const isCalendarRelated = CALENDAR_KEYWORDS.some((kw) => q.includes(kw));
  if (!isCalendarRelated) return null;

  const [year, month, day] = currentDate.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));

  // --- Specific day patterns ---

  if (/\b(dzisiaj|dziś|dzis|today|tonight)\b/.test(q) || /\bco mam\b/.test(q))
    return { startDate: fmt(today), endDate: fmt(today), label: "today" };

  if (/\b(jutro|tomorrow)\b/.test(q)) {
    const d = addDays(today, 1);
    return { startDate: fmt(d), endDate: fmt(d), label: "tomorrow" };
  }

  if (/\b(wczoraj|yesterday)\b/.test(q)) {
    const d = addDays(today, -1);
    return { startDate: fmt(d), endDate: fmt(d), label: "yesterday" };
  }

  if (/\b(pojutrze|day\s*after\s*tomorrow)\b/.test(q)) {
    const d = addDays(today, 2);
    return { startDate: fmt(d), endDate: fmt(d), label: "day after tomorrow" };
  }

  // --- Week patterns ---

  if (
    /\b(next\s*week|za\s*tydzie[nń]|przysz[łl][ya]\s*tydzie[nń]|nast[eę]pn[ya]\s*tydzie[nń]|w\s*przysz[łl]ym\s*tygodniu)\b/.test(
      q,
    )
  ) {
    const mon = addDays(getMonday(today), 7);
    const sun = addDays(mon, 6);
    return { startDate: fmt(mon), endDate: fmt(sun), label: "next week" };
  }

  if (
    /\b(last\s*week|zesz[łl][ya]\s*tydzie[nń]|poprzedni[a]?\s*tydzie[nń]|w\s*zesz[łl]ym\s*tygodniu)\b/.test(
      q,
    )
  ) {
    const mon = addDays(getMonday(today), -7);
    const sun = addDays(mon, 6);
    return { startDate: fmt(mon), endDate: fmt(sun), label: "last week" };
  }

  if (/\b(this\s*week|ten\s*tydzie[nń]|w\s*tym\s*tygodniu|tygodni)\b/.test(q)) {
    const mon = getMonday(today);
    const sun = addDays(mon, 6);
    return { startDate: fmt(mon), endDate: fmt(sun), label: "this week" };
  }

  // --- Month patterns ---

  if (
    /\b(next\s*month|przysz[łl][ya]\s*miesi[aą]c|w\s*przysz[łl]ym\s*miesi[aą]cu)\b/.test(
      q,
    )
  ) {
    const start = new Date(Date.UTC(year, month, 1));
    const end = new Date(Date.UTC(year, month + 1, 0));
    return { startDate: fmt(start), endDate: fmt(end), label: "next month" };
  }

  if (
    /\b(last\s*month|zesz[łl][ya]\s*miesi[aą]c|poprzedni[a]?\s*miesi[aą]c|w\s*zesz[łl]ym\s*miesi[aą]cu)\b/.test(
      q,
    )
  ) {
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return { startDate: fmt(start), endDate: fmt(end), label: "last month" };
  }

  if (/\b(this\s*month|ten\s*miesi[aą]c|w\s*tym\s*miesi[aą]cu)\b/.test(q)) {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0));
    return { startDate: fmt(start), endDate: fmt(end), label: "this month" };
  }

  // --- Default: if calendar-related but no specific range detected ---
  // Show yesterday + today + next 7 days (covers most common intents)
  return {
    startDate: fmt(addDays(today, -1)),
    endDate: fmt(addDays(today, 7)),
    label: "upcoming (yesterday through +7 days)",
  };
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR CONTEXT FETCHER (for linear agent mode)
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch calendar events for a date range determined from the user's query.
 * Returns a formatted string suitable for injection into the agent context.
 *
 * Used by the **linear** root agent so the response LLM has access to real
 * calendar data without needing tool calls.
 */
export async function fetchCalendarContext(
  userId: string,
  currentDate: string,
  userMessage: string,
): Promise<string> {
  const range = extractDateRangeFromQuery(userMessage, currentDate);
  if (!range) return "";

  try {
    const client = createAdminClient();

    const { data, error } = await client
      .from("activity_atoms")
      .select(
        "id, title, occurred_at, duration_minutes, participants, source_url",
      )
      .eq("user_id", userId)
      .eq("atom_type", "event")
      .eq("provider", "google_calendar")
      .gte("occurred_at", `${range.startDate}T00:00:00.000Z`)
      .lte("occurred_at", `${range.endDate}T23:59:59.999Z`)
      .order("occurred_at", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[fetchCalendarContext] Query error:", error);
      return "";
    }

    const events = data ?? [];

    if (events.length === 0)
      return `Calendar (${range.label}): No events found.`;

    // Group by date for readability
    const byDate = new Map<string, Array<(typeof events)[number]>>();
    for (const e of events) {
      const date = e.occurred_at.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(e);
    }

    const lines: string[] = [];
    for (const [date, dayEvents] of byDate) {
      lines.push(
        `  ${date} (${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}):`,
      );
      for (const e of dayEvents) {
        const time = e.occurred_at.slice(11, 16);
        const title = (e.title as string) ?? "(No title)";
        const duration =
          e.duration_minutes != null ? ` (${e.duration_minutes} min)` : "";
        const participants = (e.participants as string[] | null)?.length
          ? ` [${(e.participants as string[]).join(", ")}]`
          : "";
        lines.push(`    - ${time} ${title}${duration}${participants}`);
      }
    }

    return `Calendar events (${range.label}, ${events.length} total):\n${lines.join("\n")}`;
  } catch (err) {
    console.error("[fetchCalendarContext] Error:", err);
    return "";
  }
}
