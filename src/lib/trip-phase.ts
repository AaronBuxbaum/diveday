import type { TripStage } from "./trip-stages";
import { hasReturned } from "./trips";
import { shopDayBounds } from "./zoned";

/**
 * **Where a departure is in its own day**: Prep, Check-in, Aboard, Back. ADR
 * 20261001-logbook.
 *
 * This is the staff page's orientation, never a word on screen: it decides
 * how a surface lays itself out (a departure that is Back shows its Divers tab
 * as a record), and which boats Today still counts as out. That is why it may
 * lean on the clock where `trip-stages.ts` may not. The word a chip prints is
 * {@link boatStageOf}'s, the crew's own tap, so Today, the header and the
 * manifest cannot disagree (UX review 2026-10-10, item 1).
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
  if (tap !== null) {
    // The chip's own reading decides: `home` is Back, a word that still
    // speaks is Aboard, and a word the return day has outlived is Back.
    const shown = boatStageOf({ startsAt, endsAt, now, timeZone, stage, cancelled });
    return shown === null || shown.stage === "home" ? "back" : "aboard";
  }
  if (hasReturned(endsAt, now)) return "back";
  if (now.getTime() >= startsAt.getTime()) return "aboard";
  if (now.getTime() >= departureDay.from.getTime()) return "checkin";
  return "prep";
}

/**
 * **The one word a chip says about where a departure is** (UX review
 * 2026-10-10, item 1): the crew's own tap, in the five boat words the manifest
 * strip offers (Boarding, Underway, Surface, Heading in, Home), or nothing.
 *
 * Today's departure card, the departure header and the manifest's stage strip
 * all read this, so the three can never say different words about one boat.
 * The clock-derived phase above stays an orientation the page uses for its
 * own layout (a finished departure's Divers tab is a record); it is never
 * printed, because "Aboard" from a clock is a claim about where people are
 * that nobody made.
 *
 * - A tap from before the departure's own shop day belongs to another sailing
 *   and says nothing.
 * - `home` stays said: it is the last word a departure has.
 * - Any other word stops speaking once the shop day the departure ends on is
 *   over, so a crew that forgot to tap Home does not leave "Underway" on the
 *   header for a week. Until then it speaks however late the boat is, which is
 *   exactly when it matters.
 * - A cancelled departure has no stage.
 */
export function boatStageOf<R extends { stage: TripStage; recordedAt: Date }>({
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
  timeZone: string;
  /** The crew's latest tap on the manifest, whatever its age (`latestTripStage`). */
  stage: R | null;
  cancelled: boolean;
}): R | null {
  if (cancelled || !stage) return null;
  const departureDay = shopDayBounds(startsAt, timeZone);
  if (stage.recordedAt.getTime() < departureDay.from.getTime()) return null;
  if (stage.stage === "home") return stage;
  const returnDayEnds = shopDayBounds(endsAt, timeZone).to;
  return now.getTime() >= returnDayEnds.getTime() ? null : stage;
}

/**
 * A departure page's two readings of where the boat is, from one input: the
 * crew's word the header chip prints (`boatStageOf`), and whether the
 * departure is finished, which turns its Divers tab into a record and stops
 * its header counting seats (UX review 2026-10-10, items 1 and 10).
 */
export function departureStage<R extends { stage: TripStage; recordedAt: Date }>(
  input: Parameters<typeof boatStageOf<R>>[0],
): { shown: R | null; finished: boolean } {
  return { shown: boatStageOf(input), finished: tripPhaseOf(input) === "back" };
}
