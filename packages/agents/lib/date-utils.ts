/**
 * Get current date in YYYY-MM-DD format
 */
export function getCurrentDate(): string {
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
export function isToday(date: Date | string): boolean {
  const today = getCurrentDate();
  const dateStr = formatDate(date);
  return today === dateStr;
}

/**
 * Build date context string for prompts
 */
export function getDateContext(date?: string): string {
  const targetDate = date || getCurrentDate();
  const today = getCurrentDate();

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
export function isPastDate(date: string): boolean {
  const today = getCurrentDate();
  return date < today;
}

/**
 * Check if a date is in the future
 */
export function isFutureDate(date: string): boolean {
  const today = getCurrentDate();
  return date > today;
}

/**
 * Get formatted date with day of week
 * Returns format: "Monday, January 26, 2026"
 */
export function getFormattedDateWithDay(date?: string): string {
  const dateStr = date || getCurrentDate();
  // Parse date components to avoid timezone issues
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateObj = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)); // Use UTC noon to avoid timezone issues
  
  const options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC", // Use UTC to ensure consistent day of week
  };
  
  return dateObj.toLocaleDateString("en-US", options);
}

/**
 * Get current date with day of week formatted
 * Returns format: "Monday, January 26, 2026"
 */
export function getCurrentDateWithDay(): string {
  return getFormattedDateWithDay();
}
