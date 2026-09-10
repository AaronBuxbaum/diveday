import { HOUR_MS, MINUTE_MS } from "./clock";
import { type DiveMode, type DockDayRhythm, dockDayTimeline } from "./diver-planning";
import type { TripStage } from "./trip-stages";

/**
 * **The boat's own line, as somebody who is not aboard reads it** — ADR
 * 20260908-one-hand, decision 6, lever U.
 *
 * Round 3's L drew one departure's day once, for the desk and for the diver.
 * There is a third reader: the person waiting on the dock with a coffee, who
 * today rings the shop. This module is what that person's page is made of, and
 * every rule it holds exists because that reader is a stranger:
 *
 * - **The line is the plan, and it moves on the crew's word.** Four kinds of
 *   step — check-in opens, the boat leaves, each site in the plan, back — and
 *   the mark on them comes from the stage a crew member tapped, never from the
 *   wall clock. A clock would walk the line forward for a boat that never left
 *   the slip.
 * - **The tap's own time is what places the mark**, not `now`. A crew that
 *   said "on the surface" at 8:52 has told us where the boat was at 8:52; that
 *   is the instant the line is drawn at, and it stops moving until they speak
 *   again. This is the one thing that keeps "never on a clock" true while a
 *   five-word vocabulary marks a six-step line.
 * - **A stale word says so and stays.** After fifteen minutes the page names
 *   the time it was said, in muted ink. Never "late": a boat that is late is
 *   exactly when this page is worth the most, and DiveDay does not get to
 *   editorialise about a shop's day in front of that shop's customers.
 */

/**
 * How old the crew's last word may be before the page names the time it was
 * said. Fifteen minutes is the canvas's figure, and it is a reading rule
 * rather than a shelf life — `STAGE_STALE_AFTER_MS` (src/lib/trip-stages.ts)
 * is what decides when a word stops speaking at all.
 */
export const BOAT_LINE_AS_OF_AFTER_MS = 15 * MINUTE_MS;

/**
 * How long a departure with no stated return is followed for. Only reached by
 * a trip whose `endsAt` is null, which is never a boat day; the window then
 * closes twelve hours after the lines came off rather than never.
 */
const OPEN_ENDED_DAY_MS = 12 * HOUR_MS;

/** The four things the line names. */
export type BoatLineStepKind = "checkIn" | "leaves" | "site" | "back";

export type BoatLineStep = {
  kind: BoatLineStepKind;
  at: Date;
  /** Dive number for a `site` step, so a caller can key it stably. */
  number?: number;
  /** The site's own name where the plan states one; null is a real answer. */
  siteName: string | null;
};

/** Where the boat is against one step: behind it, on it, or ahead of it. */
export type BoatLineMark = "done" | "now" | "todo";

/**
 * The steps of one departure's day, in order.
 *
 * Built from `dockDayTimeline` rather than from a second arithmetic, so a
 * stranger's page and the diver's own thread cannot disagree about when the
 * boat leaves. The timeline's in-between beats — the ride out, the surface
 * interval — are dropped here on purpose: they are beats a diver on board
 * lives through, and to somebody on the dock they are noise between the two
 * facts that matter, which is where the boat is going and when it is back.
 */
export function boatLineSteps({
  startsAt,
  endsAt,
  rhythm,
  siteNames,
  siteBottomTimes,
  legTravelTimes,
  diveMode = "boat",
}: {
  startsAt: Date;
  endsAt: Date | null;
  rhythm: DockDayRhythm;
  /** The plan's sites, dive 1 first. Its length is the departure's dive count. */
  siteNames: readonly (string | null)[];
  siteBottomTimes?: readonly (number | null | undefined)[];
  legTravelTimes?: readonly (number | null | undefined)[];
  diveMode?: DiveMode;
}): BoatLineStep[] {
  const beats = dockDayTimeline(
    startsAt,
    rhythm,
    endsAt ?? undefined,
    Math.max(1, siteNames.length),
    siteBottomTimes,
    legTravelTimes,
    diveMode,
  );
  const steps: BoatLineStep[] = [];
  for (const beat of beats) {
    if (beat.step === "arrive") steps.push({ kind: "checkIn", at: beat.at, siteName: null });
    else if (beat.step === "departure") steps.push({ kind: "leaves", at: beat.at, siteName: null });
    else if (beat.step === "dive") {
      steps.push({
        kind: "site",
        at: beat.at,
        number: beat.number,
        siteName: siteNames[(beat.number ?? 1) - 1] ?? null,
      });
    } else if (beat.step === "return") {
      steps.push({ kind: "back", at: beat.at, siteName: null });
    }
  }
  return steps;
}

/**
 * The mark on each step, given the crew's last word.
 *
 * With nothing tapped every step is `todo` — the honest reading of a boat
 * still at the dock, and the reason this page never has to guess. With a word,
 * the line is drawn at the instant that word was said: the last step the day
 * had reached by then is where the boat is, everything before it is behind,
 * everything after is ahead.
 *
 * `home` is the exception, and the only one: "back at the dock" is a whole day
 * finished, so every step is behind. A word said before the first step — a
 * crew boarding ahead of the check-in they published — marks the first step
 * rather than none, because a line with no mark says a boat that is being
 * boarded has not started.
 */
export function boatLineMarks(
  steps: readonly BoatLineStep[],
  reading: { stage: TripStage; recordedAt: Date } | null | undefined,
): BoatLineMark[] {
  if (!reading) return steps.map(() => "todo");
  if (reading.stage === "home") return steps.map(() => "done");
  const said = reading.recordedAt.getTime();
  let current = 0;
  steps.forEach((step, index) => {
    if (step.at.getTime() <= said) current = index;
  });
  return steps.map((_step, index) =>
    index < current ? "done" : index === current ? "now" : "todo",
  );
}

/**
 * Whether the page names the time the crew spoke rather than letting the word
 * stand on its own. Muted when true, and never a judgement — see the header.
 */
export function boatWordIsStale(recordedAt: Date, now: Date): boolean {
  return now.getTime() - recordedAt.getTime() > BOAT_LINE_AS_OF_AFTER_MS;
}

/**
 * When a departure's page stops answering at all.
 *
 * A link shared into a group chat outlives the day it was shared about, and a
 * public page that answers forever is a permanent record of a shop's
 * operations that nobody chose to publish. The window closes where the crew's
 * last word would have gone quiet anyway — one stale-stage window past the
 * published return (src/lib/trip-stages.ts) — so the page and the sentence on
 * it expire together.
 */
export function boatLineClosesAt(
  startsAt: Date,
  endsAt: Date | null,
  stageStaleAfterMs: number,
): Date {
  const base = endsAt ?? new Date(startsAt.getTime() + OPEN_ENDED_DAY_MS);
  return new Date(base.getTime() + stageStaleAfterMs);
}

/**
 * The diver bundle's word for each stage on this page, as keys rather than
 * sentences (the domain rules' "codes, not sentences"). `STAGE_SENTENCE_KEYS`
 * in trip-stages.ts is the same registry for the sentences that name the boat.
 *
 * These are the boat-less spellings: on the follow page the hull's name is
 * already the title, so a second "Mantis II is ..." beneath it would be the
 * boat's name twice on one screen.
 */
export const BOAT_LINE_STAGE_KEYS = {
  boarding: "boatLine.stage.boarding",
  underway: "boatLine.stage.underway",
  surface: "boatLine.stage.surface",
  heading_in: "boatLine.stage.headingIn",
  home: "boatLine.stage.home",
} as const satisfies Record<TripStage, string>;

/** The line's own three fixed steps; a site step is named by its site. */
export const BOAT_LINE_STEP_KEYS = {
  checkIn: "boatLine.checkIn",
  leaves: "boatLine.leaves",
  back: "boatLine.back",
} as const;
