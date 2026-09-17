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
  /**
   * Which side of the arrival the named turn sits on. `nearestTurn` is nearest
   * by absolute distance, so on any arrival away from a turn it is usually the
   * one already behind the boat -- and a sentence naming a clock time without
   * saying which side it is on is worse than no sentence. `minutesToTurn`
   * carries the sign and nothing read it until now.
   */
  turn: "next" | "last";
  /**
   * High water or low water. The endpoint is `predictions` at `hilo` interval
   * over MLLW, which publishes **water level** and says nothing about the
   * current; NOAA publishes slack separately, in `currents_predictions`, and
   * the two differ by tens of minutes to hours at a real station. So the
   * sentence names the height turn it actually has.
   */
  kind: TideWindow["nearestTurn"]["kind"];
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
    turn: window.minutesToTurn < 0 ? "last" : "next",
    kind: window.nearestTurn.kind,
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

/**
 * **Whose water the sentence above is** (issue #1732).
 *
 * Three words and a place, because the turn it names is a height turn rather
 * than slack and a captain who knows the water applies their own lag to it —
 * which they cannot do without knowing the station. NOAA's own name for the
 * station, never the seven-digit id: translating away from those digits is the
 * whole point of the editor's echo, and putting them back on the line a crew
 * reads would undo it.
 *
 * Both surfaces call the same shape and each bundle owns its own words, the
 * way the sentence above does. A `null` station means no call: the sentence
 * stands and the footnote is simply absent.
 */
export function staffTideStationText(t: StaffTranslator, station: string): string {
  return t("shared.tide.station", { station });
}

export function diverTideStationText(t: DiverTranslator, station: string): string {
  return t("trip.tideStation", { station });
}
