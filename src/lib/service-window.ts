import { type CalendarDate, calendarDateInTimezone, isValidCalendarDate } from "./calendar-date";

/**
 * **A boat in the yard, a site closed this month** (loop 5, row 5; glossary
 * "Out of service" and "Site closure"). Each is one window of shop-local
 * calendar days, both ends inclusive, with the shop's own one-line reason.
 * Calendar days, never instants: a closure is "the 10th to the 20th" in the
 * shop's zone, so a caller asks with the shop-local date of the day it means
 * (`calendarDateInTimezone(…, shop.timezone)`).
 *
 * The rules that read a window live with their surfaces: every write that puts
 * a departure on a hull refuses it (`firstYardDayOn`), the board warns, the public site page hides a
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

/**
 * **The window a hull this shop does not own reads as** (issue #3994, attacker
 * review): every day. `trips.boat_id` can name any shop's boat, so a row that
 * carried another shop's hull would read no window and every yard guard would
 * pass it. Read as always in the yard, each guard refuses it instead.
 */
export const HULL_NOT_IN_SHOP: ServiceWindow = {
  from: "0001-01-01",
  until: "9999-12-31",
  reason: null,
};

/** A run of shop-local days one meeting day holds its hull, both ends inclusive. */
export type HullHeldSpan = { from: CalendarDate; until: CalendarDate };

/**
 * **The shop-local days a departure holds its hull** (issue #3994, Aaron's
 * decision of 2026-11-06; glossary "Holds the hull"): held is nights aboard,
 * so each meeting day holds every calendar day from the one it leaves the dock
 * through the one it ties up, both inclusive, in the shop's zone. A liveaboard
 * that leaves on Friday and is back on Sunday holds Saturday; a night dive
 * back at 02:00 holds the morning it returns; one back at exactly 00:00 tied
 * up before that day began and does not hold it. Days between meeting days
 * are not held. A departure with no meeting-day rows is one, its own span.
 * Returned as spans, not listed day by day, so a corrupt row a century long
 * costs what a morning boat does.
 */
export function hullHeldSpans(
  legs: readonly { startsAt: Date; endsAt: Date }[],
  timeZone: string,
): HullHeldSpan[] {
  return legs.map((leg) => {
    const from = calendarDateInTimezone(leg.startsAt, timeZone);
    const lastInstant =
      leg.endsAt > leg.startsAt ? new Date(leg.endsAt.getTime() - 1) : leg.startsAt;
    const until = calendarDateInTimezone(lastInstant, timeZone);
    return { from, until: until < from ? from : until };
  });
}

/**
 * The earliest day the window holds that these spans hold the hull, or null
 * when they miss it: the one question every yard guard asks (issue #3994).
 */
export function firstHeldDayInWindow(
  window: ServiceWindow | null,
  spans: readonly HullHeldSpan[],
): CalendarDate | null {
  if (!window) return null;
  let first: CalendarDate | null = null;
  for (const span of spans) {
    if (span.from > window.until || span.until < window.from) continue;
    const day = span.from > window.from ? span.from : window.from;
    if (first === null || day < first) first = day;
  }
  return first;
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
