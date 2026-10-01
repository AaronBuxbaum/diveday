import type { TripStage } from "./trip-stages";
import { hasReturned } from "./trips";
import { shopDayBounds } from "./zoned";

/**
 * **Where a departure is in its own day**: the four steps the trip page's
 * stepper draws (Prep, Check-in, Aboard, Back). ADR 20261001-logbook.
 *
 * This is the staff page's orientation, not a status published to anybody: it
 * says which kind of work the departure is in, so the right tab is the obvious
 * one. That is why it may lean on the clock where `trip-stages.ts` may not. A
 * stage published to a diver's family must be something the crew said; a
 * stepper telling the crew "you are in check-in" only has to be useful.
 *
 * **The crew's word beats the clock.** A tap on the manifest (`TripStage`)
 * decides the phase whenever there is one from the departure's own day: a
 * boat that is two hours late and still `heading_in` reads Aboard, and one
 * that tied up early reads Back. This reads the raw tap, never `liveStageOf`:
 * that rule stops DiveDay *publishing* a stale word, and dropping a late
 * boat's tap here would turn it Back exactly when it is overdue. A tap still
 * stops holding Aboard once the shop day the departure ends on is over, so a
 * crew that forgot to say `home` does not leave the page Aboard for a week.
 *
 * With no tap, the clock speaks:
 *
 * - **Prep** before the departure's own shop-local day.
 * - **Check-in** from that day's midnight until the scheduled departure.
 * - **Aboard** from then until `hasReturned` (an hour past the scheduled
 *   return, the same buffer every "is everyone home" question uses).
 * - **Back** after that.
 *
 * A cancelled departure has no phase: none of the four is its next step.
 */
export const TRIP_PHASES = ["prep", "checkin", "aboard", "back"] as const;

export type TripPhase = (typeof TRIP_PHASES)[number];

export function tripPhaseOf({
  startsAt,
  endsAt,
  now,
  timeZone,
  stage,
  cancelled,
}: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  /** The shop's zone: "the departure's day" is the shop's calendar day. */
  timeZone: string;
  /** The crew's latest tap on the manifest, whatever its age (`latestTripStage`). */
  stage: { stage: TripStage; recordedAt: Date } | null;
  cancelled: boolean;
}): TripPhase | null {
  if (cancelled) return null;
  const departureDay = shopDayBounds(startsAt, timeZone);
  // A tap from before this departure's day belongs to another sailing.
  const tap =
    stage && stage.recordedAt.getTime() >= departureDay.from.getTime() ? stage.stage : null;
  if (tap === "home") return "back";
  if (tap !== null) {
    const returnDayEnds = shopDayBounds(endsAt, timeZone).to;
    return now.getTime() >= returnDayEnds.getTime() ? "back" : "aboard";
  }
  if (hasReturned(endsAt, now)) return "back";
  if (now.getTime() >= startsAt.getTime()) return "aboard";
  if (now.getTime() >= departureDay.from.getTime()) return "checkin";
  return "prep";
}
