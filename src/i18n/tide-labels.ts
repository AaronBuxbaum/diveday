import { type TidePreference, type TideWindow, tidePreferenceMet } from "@/lib/tides";
import type { DiverTranslator } from "./messages";
import type { StaffTranslator } from "./staff-messages";

/**
 * **One sentence about the tide, worded once per bundle** — ADR
 * 20260907-noaa-tide-predictions.
 *
 * `src/lib/tides.ts` hands back codes (a phase, the nearest turn, whether the
 * shop's preference is met); these two helpers are where the codes become the
 * sentence a captain reads on three staff surfaces and a diver reads on one.
 * Each bundle owns its own template — the staff line says "this departure",
 * the diver line says "the boat" — and the phase and preference words live
 * inside the ICU `select`s rather than in a second map, so a translator sees
 * the whole sentence at once.
 *
 * The caller formats `time` in the shop's zone before calling; a helper that
 * took a `Date` would need the zone and locale too, and the two surfaces
 * already have `formatTime` in hand.
 */

type TideWindowParams = {
  time: string;
  phase: TideWindow["phase"];
  fit: "met" | "missed" | "none";
  preference: TidePreference;
};

function params(
  window: TideWindow,
  preference: TidePreference | null | undefined,
  time: string,
): TideWindowParams {
  const met = tidePreferenceMet(window, preference);
  return {
    time,
    phase: window.phase,
    fit: met === null ? "none" : met ? "met" : "missed",
    preference: preference ?? "any",
  };
}

export function staffTideWindowText(
  t: StaffTranslator,
  window: TideWindow,
  preference: TidePreference | null | undefined,
  time: string,
): string {
  return t("shared.tide.window", params(window, preference, time));
}

export function diverTideWindowText(
  t: DiverTranslator,
  window: TideWindow,
  preference: TidePreference | null | undefined,
  time: string,
): string {
  return t("trip.tideWindow", params(window, preference, time));
}
