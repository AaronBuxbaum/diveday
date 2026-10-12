import type { TripStage } from "./trip-stages";

/**
 * The tone a stage chip wears, wherever one is drawn (Today's departure card,
 * the departure header). `home` is the one stage that takes the roll call's
 * success tone (ADR 20260904-reef-all-the-way-down, Budget rule 4); every other
 * stage is lagoon, because a boat at sea is a fact and not a warning.
 */
export const STAGE_TONE = {
  boarding: "primary",
  underway: "primary",
  surface: "primary",
  heading_in: "primary",
  home: "success",
} as const satisfies Record<TripStage, "primary" | "success">;
