/**
 * Shared formatting helpers. Booking times, manifests, and waivers all
 * display dates to divers, so keep every user-facing date/time format here.
 */

export function formatShortDate(date: Date, locale = "en-US", timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date);
}

export function formatTime(date: Date, locale = "en-US", timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** "7:30 AM – 11:00 AM" — en dash, no repeated day. */
export function formatTimeRange(
  start: Date,
  end: Date,
  locale = "en-US",
  timeZone?: string,
): string {
  return `${formatTime(start, locale, timeZone)} – ${formatTime(end, locale, timeZone)}`;
}
