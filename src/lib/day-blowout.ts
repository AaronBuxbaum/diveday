import { hasSailed } from "./trips";
import { utcToWallTime } from "./zoned";

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

/** A departure leaving before this local hour is a "morning" one. */
export const MORNING_ENDS_HOUR = 12;

/** The presets the day page offers; a staffer can still tick any selection. */
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
};

/** Why a departure of the day cannot be ticked, or null when it can. */
export type DayBlowoutBlock = "called" | "cancelled" | "departed";

export function dayBlowoutBlock(departure: DayBlowoutDeparture, now: Date): DayBlowoutBlock | null {
  if (departure.calledOff) return "called";
  if (departure.status !== "scheduled") return "cancelled";
  // The same test the single-trip call refuses on (`callTripBlowout`).
  if (hasSailed(departure.startsAt, now)) return "departed";
  return null;
}

export function isMorningDeparture(startsAt: Date, timeZone: string): boolean {
  return utcToWallTime(startsAt, timeZone).hour < MORNING_ENDS_HOUR;
}

/** The departures a preset ticks: every callable one, or the callable mornings. */
export function dayBlowoutPicked(
  departures: readonly DayBlowoutDeparture[],
  pick: DayBlowoutPick,
  input: { now: Date; timeZone: string },
): string[] {
  return departures
    .filter((departure) => dayBlowoutBlock(departure, input.now) === null)
    .filter((departure) => pick === "all" || isMorningDeparture(departure.startsAt, input.timeZone))
    .map((departure) => departure.id);
}
