import type { LegTravelTimes, SiteBottomTimes } from "./diver-planning";
import { type DiveMode, type DockDayRhythm, dockDayOffsets } from "./diver-planning";

/**
 * **The tide window** — ADR 20260907-noaa-tide-predictions.
 *
 * Pure arithmetic over a day's high/low predictions and one arrival instant.
 * Nothing here fetches, formats, or gates: `tide-predictions.ts` brings the
 * predictions in, the page turns the codes below into a sentence in the
 * reader's language, and no readiness or admission rule ever reads a phase.
 * It *informs* — a captain reads it beside the forecast, a diver reads it only
 * when the shop switches it on.
 */

/** One turn of the tide as NOAA predicts it: the instant, which way, how high. */
export type TidePrediction = {
  at: Date;
  kind: "high" | "low";
  /** Height above MLLW, metres — carried for the record, not compared. */
  heightMeters: number;
};

/**
 * Which way the water is moving at the arrival instant, as a code. `slack` is
 * the turn itself — the band either side of a predicted high or low where the
 * current eases before it reverses.
 */
export const TIDE_PHASES = ["slack", "flood", "ebb"] as const;
export type TidePhase = (typeof TIDE_PHASES)[number];

/**
 * When a shop says a site dives best. `any` is the ordinary case and the
 * column default: a shallow reef with no current to speak of. The other three
 * are the shop's own reading of its water, never DiveDay's.
 */
export const TIDE_PREFERENCES = ["any", "slack", "flood", "ebb"] as const;
export type TidePreference = (typeof TIDE_PREFERENCES)[number];

export function isTidePreference(value: unknown): value is TidePreference {
  return typeof value === "string" && (TIDE_PREFERENCES as readonly string[]).includes(value);
}

/**
 * NOAA CO-OPS station ids are seven digits (8723583 is Carysfort Reef). A
 * subordinate station's id looks identical to a harmonic one's, and both
 * answer the predictions endpoint, so the shape is the whole check — whether a
 * given id exists is NOAA's answer, and an id that returns nothing renders
 * nothing rather than a wrong sentence.
 */
export function isTideStationId(value: string): boolean {
  return /^\d{7}$/.test(value);
}

/**
 * How far either side of a predicted high or low the water reads as slack.
 *
 * Thirty minutes is the conventional planning figure, not a measurement: real
 * slack on a reef lags the tide table by an amount that depends on the site,
 * and a shop that knows its water better says so in `current_note`. The band
 * is deliberately symmetric and deliberately generous — a departure that lands
 * twenty minutes after the turn is dived as slack by every crew we have asked.
 */
export const SLACK_WINDOW_MINUTES = 30;

export type TideWindow = {
  phase: TidePhase;
  /** The predicted turn nearest the arrival, before or after it. */
  nearestTurn: TidePrediction;
  /** Signed minutes from the arrival to that turn — negative when it has passed. */
  minutesToTurn: number;
};

function sortedByTime(predictions: readonly TidePrediction[]): TidePrediction[] {
  return [...predictions]
    .filter((prediction) => Number.isFinite(prediction.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The phase of the tide at `arrival`, or `null` when the predictions cannot say.
 *
 * Between a low and the next high the water is flooding; between a high and
 * the next low it is ebbing; within `SLACK_WINDOW_MINUTES` of either turn it is
 * slack. The nearest turn is always reported, so the sentence can name the
 * slack a crew is aiming for even on a departure that arrives on the flood.
 *
 * Only one side known — the arrival falls before the first prediction or after
 * the last — still answers when the one turn says which way the water is
 * going (after a high it ebbs, before a high it floods). Two turns of the same
 * kind in a row (a gap in the feed, or a diurnal station's missing minor turn)
 * refuse rather than guess, and no predictions at all is `null`: the page
 * renders no sentence, which is the contract with `tide-predictions.ts`'s own
 * "fail quiet".
 */
export function tideWindowAt(
  predictions: readonly TidePrediction[],
  arrival: Date,
  slackWindowMinutes = SLACK_WINDOW_MINUTES,
): TideWindow | null {
  const turns = sortedByTime(predictions);
  if (turns.length === 0 || !Number.isFinite(arrival.getTime())) return null;
  const at = arrival.getTime();
  const before = turns.filter((turn) => turn.at.getTime() <= at).at(-1) ?? null;
  const after = turns.find((turn) => turn.at.getTime() > at) ?? null;
  const candidates = [before, after].filter((turn): turn is TidePrediction => turn !== null);
  const nearestTurn = candidates.reduce((nearest, turn) =>
    Math.abs(turn.at.getTime() - at) < Math.abs(nearest.at.getTime() - at) ? turn : nearest,
  );
  const minutesToTurn = Math.round((nearestTurn.at.getTime() - at) / 60_000);
  if (Math.abs(minutesToTurn) <= slackWindowMinutes) {
    return { phase: "slack", nearestTurn, minutesToTurn };
  }
  if (before && after && before.kind === after.kind) return null;
  // Water rises toward a high and falls toward a low, so whichever side is
  // known says the direction: a high behind means ebb, a high ahead means flood.
  const risingToward = after ? after.kind === "high" : before?.kind === "low";
  return { phase: risingToward ? "flood" : "ebb", nearestTurn, minutesToTurn };
}

/**
 * Whether the arrival lands on the phase the shop said the site dives best,
 * as a tri-state the sentence can select on: `null` when the shop expressed
 * no preference, so the copy says nothing about fit at all.
 */
export function tidePreferenceMet(
  window: TideWindow,
  preference: TidePreference | null | undefined,
): boolean | null {
  if (!preference || preference === "any") return null;
  return window.phase === preference;
}

/**
 * When the boat reaches dive `diveNumber`'s site — the departure plus the
 * dock-day rhythm's own arithmetic (`dockDayOffsets`), so the tide is read at
 * the instant the diver's own "Dive 2 · 10:40 AM" beat names rather than at
 * the departure time. `null` when the plan has no such dive.
 *
 * Not truncated by the published return the way `dockDayTimeline` is: a
 * departure whose second dive overruns its window still *arrives* somewhere,
 * and the question here is what the water is doing when it does.
 */
export function diveArrivalAt(
  startsAt: Date,
  rhythm: DockDayRhythm,
  diveNumber: number,
  options: {
    plannedDives?: number;
    siteBottomTimes?: SiteBottomTimes;
    legTravelTimes?: LegTravelTimes;
    diveMode?: DiveMode;
  } = {},
): Date | null {
  const beat = dockDayOffsets(
    rhythm,
    Math.max(options.plannedDives ?? diveNumber, diveNumber),
    options.siteBottomTimes,
    options.legTravelTimes,
    options.diveMode ?? "boat",
  ).find((offset) => offset.step === "dive" && offset.number === diveNumber);
  if (!beat) return null;
  return new Date(startsAt.getTime() + beat.minutesFromDeparture * 60_000);
}
