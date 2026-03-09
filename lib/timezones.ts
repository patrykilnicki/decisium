/**
 * Common IANA timezone identifiers, sorted by offset then name.
 * Used for the preferences timezone selector.
 */
export const COMMON_TIMEZONES = [
  "Pacific/Midway",
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Vancouver",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/Mexico_City",
  "America/New_York",
  "America/Toronto",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "America/St_Johns",
  "Atlantic/Azores",
  "Europe/London",
  "UTC",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Warsaw",
  "Europe/Amsterdam",
  "Europe/Brussels",
  "Europe/Rome",
  "Europe/Madrid",
  "Europe/Stockholm",
  "Europe/Athens",
  "Europe/Helsinki",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "Pacific/Fiji",
] as const;

export type TimezoneId = (typeof COMMON_TIMEZONES)[number] | string;

export function getTimeZoneLabel(timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    });
    const parts = formatter.formatToParts(new Date());
    const offsetPart = parts.find((p) => p.type === "timeZoneName");
    const offset = offsetPart?.value ?? "";
    const short = timeZone.replace(/^[^/]+\//, "").replace(/_/g, " ");
    return `${short} (${offset})`;
  } catch {
    return timeZone;
  }
}
