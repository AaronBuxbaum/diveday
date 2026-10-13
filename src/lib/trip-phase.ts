import { DAY_MS } from "./clock";
import type { TripStage } from "./trip-stages";
import { DEPARTURE_BUFFER_MS, hasReturned } from "./trips";
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
 * decides the phase while it still speaks ({@link boatStageOf}): a boat that
 * is two hours late and still `heading_in` reads Aboard, and one that tied up
 * early reads Back. This reads the raw tap, never `liveStageOf`: that rule
 * stops DiveDay *publishing* a stale word, and dropping a late boat's tap here
 * would turn it Back exactly when it is overdue.
 *
 * **A tap never finishes a departure sooner than silence would.** Only `home`
 * from the departure's last day makes it Back. Any other word that has stopped
 * speaking hands the question back to the clock below, so a night boat tapped
 * Underway is not finished at midnight while its untapped twin is still
 * Aboard, and a crew that forgot to say `home` does not leave the page Aboard
 * for a week.
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
  const reading = stage ? readTap({ startsAt, endsAt, now, timeZone, tap: stage }) : null;
  if (reading === "final_home") return "back";
  // A word that still speaks is Aboard. A `home` from an earlier day of a
  // course is the crew tying up for the night: the clock answers.
  if (reading === "speaks" && stage?.stage !== "home") return "aboard";
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
 * - `home` from the departure's last day stays said: it is the last word a
 *   departure has.
 * - Any other word from the last day speaks until the shop day the departure
 *   ends on is over *and* the hour past its scheduled return (`hasReturned`)
 *   has gone, whichever is later: however late the boat is, which is exactly
 *   when it matters, but a crew that forgot to tap Home does not leave
 *   "Underway" on the header for a week, and a night boat back at 23:30 still
 *   says Underway at 00:15.
 * - On a multi-day course (`starts_at`/`ends_at` bound the whole run) a word
 *   from an earlier day, `home` included, speaks only on the day it was said:
 *   day two never reads "Underway since 10:30" with yesterday's time.
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
  return readTap({ startsAt, endsAt, now, timeZone, tap: stage }) === null ? null : stage;
}

/**
 * Whether one tap still speaks, the single rule {@link tripPhaseOf} and
 * {@link boatStageOf} share: `final_home` is a `home` from the departure's
 * last day, `speaks` any word still current, `null` a word that says nothing.
 *
 * A departure shorter than a day is one sailing even when it crosses
 * midnight, so every tap from its own day is "from its last day". A longer one
 * is a multi-day run (`trip-days.ts`: the same window on consecutive days), and
 * its last day is the shop day `endsAt` falls on.
 *
 * A word from the last day speaks until that day is over or an hour past the
 * scheduled return, whichever is later; for one sailing "that day" is the day
 * it left on, so a forgotten Home tap does not hold a midnight boat for a
 * second day.
 */
function readTap({
  startsAt,
  endsAt,
  now,
  timeZone,
  tap,
}: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  timeZone: string;
  tap: { stage: TripStage; recordedAt: Date };
}): "final_home" | "speaks" | null {
  const at = tap.recordedAt.getTime();
  if (at < shopDayBounds(startsAt, timeZone).from.getTime()) return null;
  const returnDay = shopDayBounds(endsAt, timeZone);
  const oneSailing = endsAt.getTime() - startsAt.getTime() < DAY_MS;
  const fromLastDay = oneSailing || at >= returnDay.from.getTime();
  if (fromLastDay && tap.stage === "home") return "final_home";
  // One sailing holds its word to the end of the day it left on, or the hour
  // past its return when that is later: a boat back at 02:00 lets go at
  // 03:00, not at the end of the day 02:00 falls on (#2409).
  const lastDayEnd = oneSailing ? shopDayBounds(startsAt, timeZone).to : returnDay.to;
  const until = fromLastDay
    ? Math.max(lastDayEnd.getTime(), endsAt.getTime() + DEPARTURE_BUFFER_MS)
    : shopDayBounds(tap.recordedAt, timeZone).to.getTime();
  return now.getTime() < until ? "speaks" : null;
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
