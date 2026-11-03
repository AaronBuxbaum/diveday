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
  readonly label: string;
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
  { id: "shop-open", label: "The shop opens on a fresh day", capture: "today-empty" },
  { id: "seat-booked", label: "A diver books a seat on the public page", exempt: AN_ACT },
  { id: "waiver-signed", label: "The diver signs the waiver from the link", exempt: AN_ACT },
  {
    id: "card-added",
    label: "The diver adds their certification card from the link",
    exempt: AN_ACT,
  },
  { id: "card-verified", label: "The counter sights the card and verifies it", exempt: AN_ACT },
  { id: "checked-in", label: "The counter checks the diver in", exempt: AN_ACT },
  { id: "boarding", label: "The crew says the boat is boarding", exempt: ON_THE_WATER },
  { id: "roll-call-departure", label: "Roll call before departure", exempt: ON_THE_WATER },
  { id: "underway", label: "Underway", exempt: ON_THE_WATER },
  { id: "roll-call-after-dives", label: "Roll call after every dive", exempt: ON_THE_WATER },
  { id: "heading-in", label: "Heading in", exempt: ON_THE_WATER },
  { id: "home", label: "Home", capture: "today-evening" },
  { id: "evening", label: "Every boat is home", capture: "today-all-home" },
  { id: "recap-sent", label: "The recap pass sends the diver's recap", exempt: AN_ACT },
  { id: "recap-read", label: "The diver reads the recap", exempt: AN_ACT },
]);
