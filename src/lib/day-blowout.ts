import { addCalendarDays, utcToWallTime, wallTimeToUtc } from "./zoned";

/**
 * **One weather call for a whole morning or day** (ADR
 * 20261009-day-weather-call).
 *
 * A front that closes the harbour closes it for every boat that morning, and
 * the blow-out used to be called one departure at a time — five taps, five
 * confirmations, and in between them the divers on the first boat were being
 * offered the second as an alternative. The day call is the same blow-out,
 * once per departure, chosen together: this module decides which departures
 * of a day can be called and which a preset picks; `callDayBlowout` in
 * `src/db/blowouts.ts` calls them.
 *
 * Framework-free and clock-free: the caller passes `now` and the shop's zone.
 */

/** A departure leaving before this local hour is a "before noon" one. */
export const MORNING_ENDS_HOUR = 12;

/**
 * The presets the day page offers; a staffer can still select any departures.
 * The page opens with **none** selected (dive-domain review, 2026-10-09): a
 * call that cancels boats is chosen, never accepted by default.
 */
export const DAY_BLOWOUT_PICKS = ["all", "morning"] as const;
export type DayBlowoutPick = (typeof DAY_BLOWOUT_PICKS)[number];

export function isDayBlowoutPick(value: unknown): value is DayBlowoutPick {
  return typeof value === "string" && (DAY_BLOWOUT_PICKS as readonly string[]).includes(value);
}

/** One departure of the day, as the call sees it. */
export type DayBlowoutDeparture = {
  id: string;
  startsAt: Date;
  status: "scheduled" | "cancelled";
  /** A blow-out was already called on it; its record is the place to work it. */
  calledOff: boolean;
  /** Anybody — diver or crew — has a roll-call or boarding event on it. */
  rollCallStarted: boolean;
};

/**
 * **A boat that may be on the water is never called off** (dive-domain review,
 * 2026-10-09). Underway from its start time — not the late-arrival hour the
 * booking side allows (`hasSailed`) — or from the first boarding or roll-call
 * event, whichever comes first. Cancelling a departure with people aboard
 * would hand roll call a cancelled trip; the blow-out refuses it server-side
 * too (`setUpTripBlowout`).
 */
export function departureUnderway(
  departure: { startsAt: Date; rollCallStarted: boolean },
  now: Date,
): boolean {
  return departure.rollCallStarted || now.getTime() >= departure.startsAt.getTime();
}

/** Why a departure of the day cannot be selected, or null when it can. */
export type DayBlowoutBlock = "called" | "cancelled" | "underway";

export function dayBlowoutBlock(departure: DayBlowoutDeparture, now: Date): DayBlowoutBlock | null {
  if (departure.calledOff) return "called";
  if (departure.status !== "scheduled") return "cancelled";
  if (departureUnderway(departure, now)) return "underway";
  return null;
}

export function isMorningDeparture(startsAt: Date, timeZone: string): boolean {
  return utcToWallTime(startsAt, timeZone).hour < MORNING_ENDS_HOUR;
}

/** The departures a preset selects: none, every callable one, or the callable ones before noon. */
export function dayBlowoutPicked(
  departures: readonly DayBlowoutDeparture[],
  pick: DayBlowoutPick | null,
  input: { now: Date; timeZone: string },
): string[] {
  if (pick === null) return [];
  return departures
    .filter((departure) => dayBlowoutBlock(departure, input.now) === null)
    .filter((departure) => pick === "all" || isMorningDeparture(departure.startsAt, input.timeZone))
    .map((departure) => departure.id);
}

/**
 * The instants a shop's calendar day covers, `[from, to)`, in its own zone —
 * the one window both the day page lists and the action re-filters submitted
 * departures to, so a crafted id from another day is never called.
 */
export function dayBlowoutBounds(date: string, timeZone: string): { from: Date; to: Date } {
  const [year, month, day] = date.split("-").map(Number);
  const midnight = { year, month, day, hour: 0, minute: 0 };
  return {
    from: wallTimeToUtc(midnight, timeZone),
    to: wallTimeToUtc(addCalendarDays(midnight, 1), timeZone),
  };
}

/**
 * Which submitted departures a day call may call: those of this day that can
 * still be called, in the day's order. Everything else submitted — another
 * day's, underway, already called, unknown — is counted as skipped, never
 * silently dropped.
 */
export function dayBlowoutCallable(
  departures: readonly (DayBlowoutDeparture & { id: string })[],
  submitted: readonly string[],
  now: Date,
): { callable: string[]; skipped: number } {
  const asked = new Set(submitted);
  const callable = departures
    .filter((departure) => asked.has(departure.id) && dayBlowoutBlock(departure, now) === null)
    .map((departure) => departure.id);
  return { callable, skipped: asked.size - callable.length };
}
