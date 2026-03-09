/**
 * Format dates and times for display, optionally in a given IANA timezone.
 * When timezone is omitted, browser/server default is used.
 */

export function formatDate(
  date: Date,
  timezone?: string | null,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
): string {
  return date.toLocaleDateString("en-GB", {
    ...options,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

export function formatTime(
  date: Date,
  timezone?: string | null,
  options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  },
): string {
  return date.toLocaleTimeString("en-GB", {
    ...options,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

export function formatDateTime(date: Date, timezone?: string | null): string {
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

/**
 * Format a date string (YYYY-MM-DD) for display with optional timezone.
 * Parses at noon UTC to avoid DST edge issues when displaying.
 */
export function formatDateString(
  dateStr: string,
  timezone?: string | null,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "2-digit",
    month: "short",
  },
): string {
  const date = new Date(dateStr + "T12:00:00Z");
  return date.toLocaleDateString("en-GB", {
    ...options,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}
