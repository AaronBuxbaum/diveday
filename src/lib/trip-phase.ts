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
/**
 * One real meeting window of a multi-day run (`trip_schedule_days`,
 * `trip-days.ts`). Optional on every reader here: a departure with none is
 * read from its shop days alone, exactly as before.
 */
export type MeetingWindow = { startsAt: Date; endsAt: Date };

export const TRIP_PHASES = ["prep", "checkin", "aboard", "back"] as const;

export type TripPhase = (typeof TRIP_PHASES)[number];

export function tripPhaseOf({
  startsAt,
  endsAt,
  now,
  timeZone,
  stage,
  cancelled,
  meetingWindows,
}: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  /** The shop's zone: "the departure's day" is the shop's calendar day. */
  timeZone: string;
  meetingWindows?: readonly MeetingWindow[];
  /** The crew's latest tap on the manifest, whatever its age (`latestTripStage`). */
  stage: { stage: TripStage; recordedAt: Date } | null;
  cancelled: boolean;
}): TripPhase | null {
  if (cancelled) return null;
  const departureDay = shopDayBounds(startsAt, timeZone);
  const reading = stage
    ? readTap({ startsAt, endsAt, now, timeZone, tap: stage, meetingWindows })
    : null;
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
  meetingWindows,
}: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  timeZone: string;
  /** The crew's latest tap on the manifest, whatever its age (`latestTripStage`). */
  stage: R | null;
  cancelled: boolean;
  meetingWindows?: readonly MeetingWindow[];
}): R | null {
  if (cancelled || !stage) return null;
  return readTap({ startsAt, endsAt, now, timeZone, tap: stage, meetingWindows }) === null
    ? null
    : stage;
}

/**
 * Whether one tap still speaks, the single rule {@link tripPhaseOf} and
 * {@link boatStageOf} share: `final_home` is a `home` from the departure's
 * last day, `speaks` any word still current, `null` a word that says nothing.
 *
 * A departure shorter than a day is one sailing even when it crosses
 * midnight, so every tap from its own day is "from its last day". A longer one
 * is a multi-day run (`trip-days.ts`: the same window on several days), and
 * its last day is the shop day `endsAt` falls on.
 *
 * A word from the last day speaks until that day is over or an hour past the
 * scheduled return, whichever is later; for one sailing "that day" is the day
 * it left on, so a forgotten Home tap does not hold a midnight boat for a
 * second day, unless the word itself was said on the later day, which holds
 * it to the end of that day.
 */
function readTap({
  startsAt,
  endsAt,
  now,
  timeZone,
  tap,
  meetingWindows = [],
}: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  timeZone: string;
  tap: { stage: TripStage; recordedAt: Date };
  meetingWindows?: readonly MeetingWindow[];
}): "final_home" | "speaks" | null {
  const at = tap.recordedAt.getTime();
  if (at < shopDayBounds(startsAt, timeZone).from.getTime()) return null;
  const returnDay = shopDayBounds(endsAt, timeZone);
  const oneSailing = endsAt.getTime() - startsAt.getTime() < DAY_MS;
  // On a multi-day run with real meeting windows, the last day begins where
  // the last window does when that is earlier than the shop day `endsAt` falls
  // on: a 22:00 to 02:00 night's Home tap at 23:30 is the run's last word,
  // though its window ends on the next shop day (issue #2406).
  const lastWindow = meetingWindows.reduce<MeetingWindow | null>(
    (latest, window) => (!latest || window.endsAt > latest.endsAt ? window : latest),
    null,
  );
  const lastDayFrom = oneSailing
    ? returnDay.from.getTime()
    : Math.min(
        returnDay.from.getTime(),
        lastWindow?.startsAt.getTime() ?? Number.POSITIVE_INFINITY,
      );
  const fromLastDay = oneSailing || at >= lastDayFrom;
  if (fromLastDay && tap.stage === "home") return "final_home";
  // One sailing holds its word to the end of the day it left on (or the day
  // the word was said, when that is later), or the hour past its return when
  // that is later: a boat back at 02:00 lets go at 03:00, not at the end of
  // the day 02:00 falls on (#2409), but a "Heading in" said at 02:40 is the
  // crew's word and outlasts the clock.
  const lastDayEnd = oneSailing
    ? shopDayBounds(new Date(Math.max(startsAt.getTime(), at)), timeZone).to
    : returnDay.to;
  const until = fromLastDay
    ? Math.max(lastDayEnd.getTime(), endsAt.getTime() + DEPARTURE_BUFFER_MS)
    : earlierDayEnd(tap.recordedAt, timeZone, meetingWindows);
  return now.getTime() < until ? "speaks" : null;
}

/**
 * Where an earlier day's tap on a multi-day run stops speaking: the end of the
 * shop day it was said on, or the end of the meeting window it was said inside
 * when that is later. A window that crosses midnight (22:00 to 02:00 each
 * night) is still one sailing at 01:00, and its Boarding tap from 23:30 has not
 * gone quiet at 00:00 (issue #2406). A tap said outside every window, and a run
 * with no windows on file, keep the shop-day rule.
 */
function earlierDayEnd(
  recordedAt: Date,
  timeZone: string,
  meetingWindows: readonly MeetingWindow[],
): number {
  const dayEnd = shopDayBounds(recordedAt, timeZone).to.getTime();
  const at = recordedAt.getTime();
  const inside = meetingWindows.find(
    (window) => window.startsAt.getTime() <= at && at < window.endsAt.getTime(),
  );
  return Math.max(dayEnd, inside?.endsAt.getTime() ?? dayEnd);
}

/**
 * **Whether the desk may say check-in is open** (UX review 2026-10-13, item
 * 20): the clock's Check-in phase, while the crew have said nothing.
 *
 * It is the one place the clock's phase reaches a word on screen, and it is
 * built not to compete with the stage. It never names a stage (it is not one
 * of the five boat words), it is said on the Divers tab only, where the desk
 * checks people in, and it goes silent the moment a crew tap speaks, so the
 * header's chip and this line can never both be talking. Before it the desk
 * had no word at all for its busiest half hour: the chip is silent until the
 * crew taps ("never a word from the clock").
 */
export function checkInOpen(input: Parameters<typeof tripPhaseOf>[0]): boolean {
  return tripPhaseOf(input) === "checkin" && boatStageOf(input) === null;
}

/**
 * A departure page's readings of where the boat is, from one input: the
 * crew's word the header chip prints (`boatStageOf`), whether the departure is
 * finished, which turns its Divers tab into a record and stops its header
 * counting seats (UX review 2026-10-10, items 1 and 10), and whether the
 * Divers tab says check-in is open (`checkInOpen`).
 *
 * **A departure is not finished while the roll call still lacks a diver**
 * (issue #2404). `unaccountedFor` is the page's answer to "is any seat recorded
 * not back aboard at an after-dive checkpoint and not counted since"
 * (`listUnaccountedForByTrip`, src/db/manifests.ts). The clock and a stale tap
 * would call a night boat out past its hour Back while someone may still be in
 * the water, and the desk would give way to a record that files them under
 * "Sailed". So the clock and a stale tap no longer finish it. **The crew's own
 * `home` from the departure's last day still does**: it is the last word a
 * departure has, and the record then names the seat as unaccounted for rather
 * than hiding it. Nothing else moves: the chip, the clock's phase and
 * check-in read as they did. The page reads the roll call only once the
 * departure would otherwise read as finished, so a boat still out costs it
 * nothing.
 */
export function departureStage<R extends { stage: TripStage; recordedAt: Date }>(
  input: Parameters<typeof boatStageOf<R>>[0] & { unaccountedFor?: boolean },
): { shown: R | null; finished: boolean; checkInOpen: boolean } {
  const { unaccountedFor = false, ...reading } = input;
  const homeSaid =
    !reading.cancelled &&
    reading.stage !== null &&
    readTap({ ...reading, tap: reading.stage }) === "final_home";
  return {
    shown: boatStageOf(reading),
    finished: tripPhaseOf(reading) === "back" && (homeSaid || !unaccountedFor),
    checkInOpen: checkInOpen(reading),
  };
}
