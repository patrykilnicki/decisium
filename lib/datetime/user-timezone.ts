/**
 * Date boundaries in a given IANA timezone.
 * Uses Intl (no extra deps). Reference time defaults to "now" for cron use.
 */

/**
 * Get YYYY-MM-DD for a given instant in the specified timezone.
 */
export function getDateInTimezone(reference: Date, timezone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(reference);
}

/**
 * Yesterday (calendar day) in the given timezone at reference time.
 */
export function getYesterdayInTimezone(
  timezone: string,
  reference: Date = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const localDate = new Date(year, month - 1, day);
  localDate.setDate(localDate.getDate() - 1);
  const y = localDate.getFullYear();
  const m = String(localDate.getMonth() + 1).padStart(2, "0");
  const d = String(localDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Today (calendar day) in the given timezone at reference time.
 */
export function getTodayInTimezone(
  timezone: string,
  reference: Date = new Date(),
): string {
  return getDateInTimezone(reference, timezone);
}

/**
 * Start of last week (Monday) in the given timezone at reference time.
 * E.g. if "today" in TZ is Tue 10 Mar, returns Mon 3 Mar.
 */
export function getLastWeekStartInTimezone(
  timezone: string,
  reference: Date = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const localDate = new Date(year, month - 1, day);
  const dow = localDate.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  localDate.setDate(localDate.getDate() + mondayOffset - 7);
  const y = localDate.getFullYear();
  const m = String(localDate.getMonth() + 1).padStart(2, "0");
  const d = String(localDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * First day of last month in the given timezone at reference time.
 * E.g. if "today" in TZ is 10 Mar, returns 1 Feb (YYYY-MM-01).
 */
export function getLastMonthStartInTimezone(
  timezone: string,
  reference: Date = new Date(),
): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const localDate = new Date(year, month - 1, day);
  localDate.setMonth(localDate.getMonth() - 1);
  localDate.setDate(1);
  const y = localDate.getFullYear();
  const m = String(localDate.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

/**
 * Current hour (0–23) in the given timezone at reference time.
 */
export function getHourInTimezone(
  timezone: string,
  reference: Date = new Date(),
): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(reference);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

/**
 * Day of week (0 = Sunday, 1 = Monday, ...) in the given timezone.
 */
export function getDayOfWeekInTimezone(
  timezone: string,
  reference: Date = new Date(),
): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(reference);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const month = Number(parts.find((p) => p.type === "month")?.value ?? 1);
  const day = Number(parts.find((p) => p.type === "day")?.value ?? 1);
  const localDate = new Date(year, month - 1, day);
  return localDate.getDay();
}

/**
 * Calendar day of month (1–31) in the given timezone.
 */
export function getDayOfMonthInTimezone(
  timezone: string,
  reference: Date = new Date(),
): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    day: "numeric",
  });
  const parts = formatter.formatToParts(reference);
  return Number(parts.find((p) => p.type === "day")?.value ?? 1);
}
