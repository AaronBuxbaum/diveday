/**
 * The shop's day as the harness walks it, written once (issue #2752).
 *
 * The one-day simulation (`scripts/simulate-day`) walks these states in order
 * on its frozen clock, and `pnpm check:route-coverage` reads the same list to
 * name any state that has neither a `today-*` capture nor a written reason
 * for going without one. Adding a state of the day is one entry here; the
 * guard then says which capture is missing.
 *
 * Plain data and erasable syntax only, so the Playwright spec, vitest and the
 * plain-Node guard load it as it is.
 */

export type DayState = {
  /** The transcript's vocabulary and the simulator's screenshot names. */
  readonly id: string;
  /** The visual capture that photographs this reading of the day. */
  readonly capture?: string;
  /** Why no capture photographs it. Exactly one of `capture` and `exempt` is set. */
  readonly exempt?: string;
};

const AN_ACT =
  "An act the simulator walks, not a reading of the day: the pages it passes through are captured by route.";
const ON_THE_WATER =
  "The boat's mid-day states are walked by the simulator, which photographs each; no fixture shop can sit on the water (the clock is the only lever).";

/**
 * Every state the day must reach, in the order it is reached. The simulator
 * walks this list and refuses to skip a state, so a day that cannot reach one
 * fails at it by name.
 */
export const DAY_STATES: readonly DayState[] = Object.freeze([
  { id: "shop-open", capture: "today-empty" },
  { id: "seat-booked", exempt: AN_ACT },
  { id: "waiver-signed", exempt: AN_ACT },
  {
    id: "card-added",
    exempt: AN_ACT,
  },
  { id: "card-verified", exempt: AN_ACT },
  { id: "checked-in", exempt: AN_ACT },
  { id: "boarding", exempt: ON_THE_WATER },
  { id: "roll-call-departure", exempt: ON_THE_WATER },
  { id: "underway", exempt: ON_THE_WATER },
  { id: "roll-call-after-dives", exempt: ON_THE_WATER },
  { id: "heading-in", exempt: ON_THE_WATER },
  { id: "home", capture: "today-evening" },
  { id: "evening", capture: "today-all-home" },
  { id: "recap-sent", exempt: AN_ACT },
  { id: "recap-read", exempt: AN_ACT },
]);
