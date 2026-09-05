import { HOUR_MS } from "./clock";

/**
 * **The boat says where it is** — ADR 20260904-reef-all-the-way-down, decision
 * 2, Budget rule 4.
 *
 * Five words the crew taps on the manifest, which DiveDay then repeats — with
 * the time the crew said it — everywhere the boat is drawn: a chip on the shop
 * home's station, a panel on the storefront, a line on every diver's link.
 *
 * The rules this module exists to keep in one place, because four surfaces
 * read it and four surfaces cannot be trusted to agree:
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
};

/**
 * How long after a departure's scheduled end its last stage still speaks for
 * it. Two late-arrival buffers: one for the boat being late, one for the crew
 * being busy when it ties up.
 */
export const STAGE_STALE_AFTER_MS = 2 * HOUR_MS;

/**
 * The stage a surface may show for this departure, or null.
 *
 * Null on three counts, all of them "say nothing": nothing was ever recorded,
 * the departure has no end to measure from, or the last word is older than the
 * boat's own day.
 */
export function liveStageOf(
  reading: TripStageReading | null | undefined,
  endsAt: Date | null | undefined,
  now: Date,
): TripStageReading | null {
  if (!reading) return null;
  if (!endsAt) return reading;
  // diveday:allow-departure-offset: this is a word's shelf life, not a
  // departure check. `hasReturned` answers "is the boat back?", which a stage
  // must not depend on — the whole point of the line is a boat that is late.
  // What expires here is DiveDay's licence to keep repeating a sentence the
  // crew has stopped maintaining, and two late-arrival buffers is the window
  // the ADR's own risk note argues for.
  if (now.getTime() > endsAt.getTime() + STAGE_STALE_AFTER_MS) return null;
  return reading;
}

/**
 * May a stage be published to somebody who is not staff — the storefront's
 * anonymous visitor, a diver holding a link?
 *
 * `home` may not, and that is the narrowing rather than an oversight: "back at
 * the dock" is the shop's own reading of a day that is over, and a public
 * panel announcing it hours later is noise on a page about tomorrow. The
 * diver's own link still says it, because that diver was on the boat.
 */
export function stageIsPublishable(stage: TripStage): boolean {
  return stage !== "home";
}

/** `home` alone carries the roll call's success tone; the rest are lagoon. */
export function stageTone(stage: TripStage): "success" | "primary" {
  return stage === "home" ? "success" : "primary";
}

/** The staff bundle's word for each stage, as keys rather than sentences. */
export const STAGE_WORD_KEYS = {
  boarding: "shopHome.spine.stage.boarding",
  underway: "shopHome.spine.stage.underway",
  surface: "shopHome.spine.stage.surface",
  heading_in: "shopHome.spine.stage.headingIn",
  home: "shopHome.spine.stage.home",
} as const;

/** The manifest's five buttons. */
export const STAGE_TAP_KEYS = {
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
