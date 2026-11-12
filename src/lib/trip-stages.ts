import { stageIsStale } from "./departure-clock";
import type { MeetingWindow } from "./trip-phase";
import { shopDayBounds } from "./zoned";

/**
 * **The boat says where it is** — ADR 20260904-reef-all-the-way-down, decision
 * 2, Budget rule 4.
 *
 * Five words the crew taps on the manifest, which DiveDay then repeats — with
 * the time the crew said it — on the staff boat and the diver’s ready link
 * and wallet pass.
 *
 * The rules this module exists to keep in one place:
 *
 * - **Never inferred.** A stage is a thing a person said, not a thing a clock
 *   implied. A departure whose crew tapped nothing has no stage, renders
 *   nothing, and never renders "Unknown".
 * - **Never a position.** DiveDay repeats a word and a time. The ADR rejects
 *   tracking outright: a position is a promise this app cannot keep.
 * - **A stage goes stale rather than wrong.** A crew that taps *Underway* and
 *   then gets busy would otherwise leave a diver's family reading "out on the
 *   reef" at midnight. So a stage stops being shown once the departure is well
 *   past its own end — the same one-hour late-arrival buffer every "has it
 *   sailed" question in this app carries, doubled, because a boat that is
 *   genuinely late is exactly when the line matters most.
 * - **`home` is the one exception to "a wash is not a status"** (Budget rule
 *   4, restated on the canvas): it takes the roll call's success tone. Every
 *   other stage is lagoon.
 */
export const TRIP_STAGES = ["boarding", "underway", "surface", "heading_in", "home"] as const;

export type TripStage = (typeof TRIP_STAGES)[number];

export type TripStageReading = {
  stage: TripStage;
  /** The site the crew was on when they said it, snapshotted at write time. */
  siteName: string | null;
  recordedAt: Date;
  recordedByName: string | null;
  /**
   * On a Home tap: how many people the last after-dive count had not
   * accounted for when it was said (issue #3896), or null. Optional so a
   * reading assembled elsewhere says nothing.
   */
  notCounted?: number | null;
};

/**
 * The stage a surface may show for this departure, or null.
 *
 * A tap before the departure’s local day or from a past meeting is silent.
 * A final meeting’s word remains eligible through the public late buffer.
 */
export function liveStageOf(
  reading: TripStageReading | null | undefined,
  trip: {
    startsAt: Date;
    endsAt: Date | null;
    timeZone: string;
    meetingWindows?: readonly MeetingWindow[];
  },
  now: Date,
): TripStageReading | null {
  if (!reading) return null;
  const at = reading.recordedAt.getTime();
  if (at < shopDayBounds(trip.startsAt, trip.timeZone).from.getTime()) return null;
  if (!trip.endsAt) return reading;
  if (stageIsStale(trip.endsAt, now)) return null;
  // A previous day's word belongs to that meeting, not a later meeting. A
  // meeting crossing midnight keeps its own word until the window ends.
  const dayEnd = shopDayBounds(reading.recordedAt, trip.timeZone).to.getTime();
  const windows = trip.meetingWindows?.length
    ? trip.meetingWindows
    : trip.endsAt && trip.endsAt.getTime() - trip.startsAt.getTime() < 24 * 60 * 60 * 1000
      ? [{ startsAt: trip.startsAt, endsAt: trip.endsAt }]
      : [];
  const windowEnd = windows.reduce(
    (end, window) =>
      window.startsAt.getTime() <= at && at < window.endsAt.getTime()
        ? Math.max(end, window.endsAt.getTime())
        : end,
    dayEnd,
  );
  const finalDay = trip.endsAt && at >= shopDayBounds(trip.endsAt, trip.timeZone).from.getTime();
  const finalWindow =
    trip.endsAt &&
    windows.some(
      (window) =>
        window.endsAt.getTime() === trip.endsAt?.getTime() &&
        window.startsAt.getTime() <= at &&
        at < window.endsAt.getTime(),
    );
  const oneSailing =
    trip.endsAt &&
    windows.length <= 1 &&
    trip.endsAt.getTime() - trip.startsAt.getTime() < 24 * 60 * 60 * 1000;
  if (!finalDay && !finalWindow && !oneSailing && now.getTime() >= windowEnd) return null;
  return reading;
}

/**
 * **The staff word for each stage, once.** The manifest strip's five buttons
 * and every chip that names a boat's stage (Today's card, the departure
 * header) read these same keys, so a staffer reads the word the crew tapped
 * (UX review 2026-10-10, item 1). Keys rather than sentences.
 */
export const STAGE_WORD_KEYS = {
  boarding: "manifest.stage.tapBoarding",
  underway: "manifest.stage.tapUnderway",
  surface: "manifest.stage.tapSurface",
  heading_in: "manifest.stage.tapHeadingIn",
  home: "manifest.stage.tapHome",
} as const;

/** The diver's sentence, in the diver bundle. */
export const STAGE_SENTENCE_KEYS = {
  boarding: "tripStage.boarding",
  underway: "tripStage.underway",
  surface: "tripStage.surface",
  heading_in: "tripStage.headingIn",
  home: "tripStage.home",
} as const;
