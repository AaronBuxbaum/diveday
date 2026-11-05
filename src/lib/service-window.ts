import { type CalendarDate, calendarDateInTimezone, isValidCalendarDate } from "./calendar-date";

/**
 * **A boat in the yard, a site closed this month** (loop 5, row 5; glossary
 * "Out of service" and "Site closure"). Each is one window of shop-local
 * calendar days, both ends inclusive, with the shop's own one-line reason.
 * Calendar days, never instants: a closure is "the 10th to the 20th" in the
 * shop's zone, so a caller asks with the shop-local date of the day it means
 * (`calendarDateInTimezone(…, shop.timezone)`).
 *
 * The rules that read a window live with their surfaces: the builder refuses
 * a hull (`tripDetailsPatch`), the board warns, the public site page hides a
 * closed site. None of them is readiness, admission or the manifest.
 */
export type ServiceWindow = { from: CalendarDate; until: CalendarDate; reason: string | null };

/** The reason column's own bound (`boats_out_of_service_reason`, `dive_sites_closure_reason`). */
export const SERVICE_WINDOW_REASON_MAX = 120;

export type ServiceWindowRefusal = "one_end" | "out_of_order" | "invalid_date" | "reason_too_long";

/**
 * A window as a form posts it. Both dates blank is no window, and a reason
 * typed beside no dates goes with them. One end alone, an end before its start
 * or a day that does not exist is refused rather than stored as "nothing said".
 */
export function parseServiceWindow(input: {
  from: string;
  until: string;
  reason: string;
}): { ok: true; window: ServiceWindow | null } | { ok: false; reason: ServiceWindowRefusal } {
  const from = input.from.trim();
  const until = input.until.trim();
  if (!from && !until) return { ok: true, window: null };
  if (!from || !until) return { ok: false, reason: "one_end" };
  if (!isValidCalendarDate(from) || !isValidCalendarDate(until)) {
    return { ok: false, reason: "invalid_date" };
  }
  if (until < from) return { ok: false, reason: "out_of_order" };
  const reason = input.reason.trim();
  if (reason.length > SERVICE_WINDOW_REASON_MAX) return { ok: false, reason: "reason_too_long" };
  return { ok: true, window: { from, until, reason: reason || null } };
}

/** A row's three columns as a window, or null when it has none. */
export function serviceWindowFrom(
  from: CalendarDate | null,
  until: CalendarDate | null,
  reason: string | null,
): ServiceWindow | null {
  if (!from || !until) return null;
  return { from, until, reason };
}

/** A boat row's out-of-service columns as a window; null for no boat or no window. */
export function boatServiceWindow(
  boat:
    | {
        outOfServiceFrom: CalendarDate | null;
        outOfServiceUntil: CalendarDate | null;
        outOfServiceReason: string | null;
      }
    | null
    | undefined,
): ServiceWindow | null {
  if (!boat) return null;
  return serviceWindowFrom(boat.outOfServiceFrom, boat.outOfServiceUntil, boat.outOfServiceReason);
}

/** Whether the window holds one shop-local day. ISO dates compare as strings. */
export function serviceWindowCovers(window: ServiceWindow | null, day: CalendarDate): boolean {
  return window !== null && window.from <= day && day <= window.until;
}

/** Whether any of a departure's shop-local days falls inside the window. */
export function serviceWindowTouches(
  window: ServiceWindow | null,
  days: readonly CalendarDate[],
): boolean {
  return days.some((day) => serviceWindowCovers(window, day));
}

/**
 * Whether the window holds the shop's own day at an instant: "is this site
 * closed now" for the public site page, asked with the clock and the shop's
 * zone, never the server's.
 */
export function serviceWindowCoversInstant(
  window: ServiceWindow | null,
  at: Date,
  timeZone: string,
): boolean {
  return serviceWindowCovers(window, calendarDateInTimezone(at, timeZone));
}
