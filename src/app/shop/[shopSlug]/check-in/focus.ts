import { HOUR_MS } from "@/lib/clock";
import { shopPath } from "@/lib/staff-notices";

/**
 * **Which boat the counter is looking at, and how a refusal finds its way
 * back to it.**
 *
 * The counter is one instrument pointed at one departure
 * (ADR 20260827-clearwater-surface-language, decision 9), so "which one" is a
 * fact the URL has to carry: a `?trip=` a staffer can bookmark, a back button
 * can return to, and — the reason this module exists rather than a template
 * literal at four call sites — a `?notice=` redirect can preserve. A refusal
 * that lands on the bare queue silently re-points the instrument at the
 * morning boat while the staffer is working the afternoon one.
 *
 * Framework-free and clock-free: the selection rule is the interesting part
 * and it is unit-tested rather than eyeballed against a rendered page.
 */

/**
 * The standing late-arrival buffer (AGENTS.md): a departure is not treated as
 * sailed until an hour past its scheduled time, because trips run late and a
 * diver still walks up to the desk for one.
 */
export const COUNTER_DEPARTED_BUFFER_MS = HOUR_MS;

/**
 * The least a departure has to be for the counter to focus it.
 *
 * `today` is the caller's answer, not this module's: "the same calendar day"
 * is a question about the *shop's* timezone (`calendarDateInTimezone`), and a
 * module that took a zone would be a second place the rule could drift. The
 * counter's queue deliberately reaches past midnight in both directions — six
 * hours back, thirty-six forward (`arrivalsWindow`) — so the flag is what
 * separates "the boats of this working day" from "tomorrow's first boat,
 * already on the board".
 */
export type FocusableDeparture = { tripId: string; startsAt: Date; today: boolean };

/** Whether a departure counts as sailed, with the standing one-hour buffer. */
export function hasDeparted(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() + COUNTER_DEPARTED_BUFFER_MS <= now.getTime();
}

/**
 * The queue's own URL, carrying the focused departure.
 *
 * `shopPath` rather than a template literal, for the reason it exists:
 * `shopSlug` reaches a server action as an ordinary, caller-supplied argument
 * (`src/lib/staff-notices.ts`). A null focus — a search, or a day with no
 * departures — is the bare path, exactly as before.
 */
export function counterQueuePath(shopSlug: string, focusTripId: string | null): string {
  const base = shopPath(shopSlug, "check-in");
  return focusTripId ? `${base}?trip=${encodeURIComponent(focusTripId)}` : base;
}

/**
 * The one departure in focus, given the queue's departures in clock order.
 *
 * Four rules, in order:
 *
 * 1. **What the URL asks for**, when it names a departure the queue actually
 *    holds. A stale or hand-typed id falls through rather than emptying the
 *    instrument.
 * 2. **Today's next un-departed boat** — the default, and the answer for all
 *    but the last hours of a shop day.
 * 3. **Today's most recent departed boat**, once every one of the day's boats
 *    has sailed. This is the rule that matters, and the one a
 *    `dive-domain-expert` pass was asked for: the arrivals window deliberately
 *    reaches *backwards* (`ARRIVALS_LOOKBACK_HOURS`) because a diver still
 *    walks up to a counter for a boat that has left, inside the standing
 *    one-hour buffer. Skipping ahead to tomorrow's first boat would take the
 *    counter away from the one person most likely to need it — the late
 *    walk-in — and leave the crew nothing to undo a mis-tap on.
 * 4. **The next un-departed boat at all**, for a day with no departures of its
 *    own: the queue reaches thirty-six hours ahead, so tomorrow's first boat
 *    is already on the board and is the honest thing to point at.
 *
 * `null` only when there is nothing to focus at all.
 */
export function selectFocusedDeparture<Departure extends FocusableDeparture>(
  departures: readonly Departure[],
  requestedTripId: string | undefined,
  now: Date,
): Departure | null {
  if (departures.length === 0) return null;
  const requested = requestedTripId
    ? departures.find((departure) => departure.tripId === requestedTripId)
    : undefined;
  if (requested) return requested;

  const todays = departures.filter((departure) => departure.today);
  const stillToSail = todays.find((departure) => !hasDeparted(departure.startsAt, now));
  if (stillToSail) return stillToSail;
  const lastToday = todays[todays.length - 1];
  if (lastToday) return lastToday;
  return (
    departures.find((departure) => !hasDeparted(departure.startsAt, now)) ??
    departures[departures.length - 1] ??
    null
  );
}
