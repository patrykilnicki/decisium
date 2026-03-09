import { getTodayInTimezone } from "@/lib/datetime/user-timezone";

/**
 * Get current date in YYYY-MM-DD format.
 * When timezone is provided, returns the calendar date in that timezone; otherwise UTC.
 */
export function getCurrentDate(timezone?: string | null): string {
  if (timezone) {
    return getTodayInTimezone(timezone, new Date());
  }
  return new Date().toISOString().split("T")[0];
}

/**
 * Format a date to YYYY-MM-DD format
 */
export function formatDate(date: Date | string): string {
  if (typeof date === "string") {
    return date;
  }
  return date.toISOString().split("T")[0];
}

/**
 * Check if a date is today
 */
export function isToday(
  date: Date | string,
  options?: { timezone?: string | null; currentDate?: string },
): boolean {
  const today = options?.currentDate ?? getCurrentDate(options?.timezone);
  const dateStr = formatDate(date);
  return today === dateStr;
}

/**
 * Build date context string for prompts
 */
export function getDateContext(
  date?: string,
  options?: { timezone?: string | null; currentDate?: string },
): string {
  const today =
    options?.currentDate ?? date ?? getCurrentDate(options?.timezone);
  const targetDate = date || today;

  if (targetDate === today) {
    return `Today's date is ${today}.`;
  }

  return `Today's date is ${today}. The date in question is ${targetDate}.`;
}

/**
 * Get date difference in days
 */
export function getDaysDifference(date1: string, date2: string): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date is in the past
 */
export function isPastDate(
  date: string,
  options?: { timezone?: string | null; currentDate?: string },
): boolean {
  const today = options?.currentDate ?? getCurrentDate(options?.timezone);
  return date < today;
}

/**
 * Check if a date is in the future
 */
export function isFutureDate(
  date: string,
  options?: { timezone?: string | null; currentDate?: string },
): boolean {
  const today = options?.currentDate ?? getCurrentDate(options?.timezone);
  return date > today;
}

/**
 * Get formatted date with day of week.
 * Returns format: "Monday, January 26, 2026".
 * When timezone is provided, formats in that timezone; otherwise UTC.
 */
export function getFormattedDateWithDay(
  date?: string,
  timezone?: string | null,
): string {
  const dateStr = date || getCurrentDate(timezone);
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(timezone ? { timeZone: timezone } : { timeZone: "UTC" }),
  };

  return dateObj.toLocaleDateString("en-US", options);
}

/**
 * Get current date with day of week formatted.
 * Returns format: "Monday, January 26, 2026"
 */
export function getCurrentDateWithDay(timezone?: string | null): string {
  return getFormattedDateWithDay(undefined, timezone);
}
