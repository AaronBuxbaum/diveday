/**
 * Shared formatting helpers. Booking times, manifests, and waivers all
 * display dates to divers, so keep every user-facing date/time format here.
 */

/** Minor units (cents) to a localized currency string, e.g. 13000 → "$130.00". */
export function formatMoneyCents(cents: number, currency = "usd", locale = "en-US"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

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

/** Operational timestamp with an explicit timezone — use for signed evidence and safety events. */
export function formatDateTimeTz(date: Date, locale = "en-US", timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
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

/**
 * "7:30 AM – 11:00 AM EDT" — for operational surfaces (manage pages,
 * confirmations) where an unlabeled time is a trust failure. The public
 * schedule stays bare: local time is the honest default there.
 */
export function formatTimeRangeTz(
  start: Date,
  end: Date,
  locale = "en-US",
  timeZone?: string,
): string {
  const endWithZone = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(end);
  return `${formatTime(start, locale, timeZone)} – ${endWithZone}`;
}
