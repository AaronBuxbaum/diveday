import { describe, expect, it } from "vitest";
import type { TideWindow } from "@/lib/tides";
import { diverTranslator } from "./messages";
import { staffTranslator } from "./staff-messages";
import { diverTideWindowText, staffTideWindowText } from "./tide-labels";

/**
 * The endpoint behind this sentence is `predictions` at `hilo` interval over
 * MLLW: **water level**, which is what a tide chart prints. Slack water is a
 * property of the *current*, NOAA publishes it separately in
 * `currents_predictions`, and at a real station the two differ by tens of
 * minutes to hours. The sentence said "Slack at 6:45 AM" over a height turn
 * until 2026-09-07, on a wreck where a crew times the descent by that word.
 *
 * It also named `nearestTurn`, which is nearest by absolute distance and so on
 * most arrivals is the turn already behind the boat, with nothing in the words
 * to say which side it was on.
 */
const turnAt = (minutesFromArrival: number, kind: "high" | "low"): TideWindow => ({
  phase: minutesFromArrival < 0 ? "ebb" : "flood",
  nearestTurn: {
    at: new Date(Date.UTC(2026, 6, 21, 6, 45)),
    kind,
    heightMeters: 0.7,
  },
  minutesToTurn: minutesFromArrival,
});

describe("the tide sentence", () => {
  it("names the height turn NOAA published, never slack water", () => {
    const t = staffTranslator("en-US");
    const line = staffTideWindowText(t, turnAt(74, "high"), "flood", "1:19 PM");
    expect(line).toContain("Next high water at 1:19 PM");
    expect(line).not.toContain("Slack at");
  });

  it("says a turn already behind the boat is behind it", () => {
    const t = staffTranslator("en-US");
    expect(staffTideWindowText(t, turnAt(-195, "high"), null, "6:45 AM")).toContain(
      "Last high water at 6:45 AM",
    );
    expect(staffTideWindowText(t, turnAt(-12, "low"), null, "6:45 AM")).toContain(
      "Last low water at 6:45 AM",
    );
  });

  it("keeps the diver's line in step with the staff line, in both languages", () => {
    const window = turnAt(74, "low");
    expect(diverTideWindowText(diverTranslator("en-US"), window, null, "1:19 PM")).toContain(
      "Next low water at 1:19 PM",
    );
    for (const line of [
      staffTideWindowText(staffTranslator("es-ES"), window, null, "13:19"),
      diverTideWindowText(diverTranslator("es-ES"), window, null, "13:19"),
    ]) {
      expect(line).toContain("Próxima bajamar a las 13:19");
      // `Estoa` is Spanish for slack water, and carried the same overclaim the
      // English prefix did. It survives only where the *shop* said the site
      // dives best at slack, which is the shop's own words about its own reef.
      expect(line).not.toContain("Estoa a las");
    }
  });

  it("still says the shop's own preference in the shop's own terms", () => {
    const t = staffTranslator("en-US");
    const missed = staffTideWindowText(t, turnAt(200, "high"), "slack", "1:19 PM");
    expect(missed).toContain("It dives best at slack water");
  });
});
