import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The departure page is a Server Component over a dozen reads, so these read
 * its source rather than render it. They pin the page's composition, not the
 * behaviour of what it composes; that lives beside each component.
 */
const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");
const BODY = SOURCE.slice(SOURCE.indexOf("export default async function"));

describe("the trip page as The Clock", () => {
  /**
   * ADR 20261117-trip-page-clock: the header, the five-phase strip, one
   * sentence, then one phase's panel.
   */
  it("draws the phase strip right under the header, on every trip but Edit trip", () => {
    const header = BODY.indexOf("<TripHeader");
    const strip = BODY.indexOf("<TripPhaseStrip");
    expect(header).toBeGreaterThan(-1);
    expect(strip).toBeGreaterThan(header);
    // Never behind `cancelled`: a cancelled trip opens on Wrapped up, and every
    // phase stays a tap away.
    // Edit trip is not a phase (design review of the final screens, finding 12).
    const guard = BODY.slice(BODY.lastIndexOf("*/}", strip) + 3, strip);
    expect(guard.replace(/\s/g, "")).toBe("{showDetails?null:(");
  });

  it("renders one panel per phase, each from its own file, and Edit trip", () => {
    for (const panel of [
      "FillingPhase",
      "ReadyPhase",
      "CheckInPhase",
      "WaterPhase",
      "WrappedPhase",
      "EditTrip",
    ]) {
      expect(SOURCE).toContain(`from "./_components/phases/${panel}"`);
      expect(BODY).toContain(`<${panel}`);
    }
  });

  /**
   * A blow-out cancels the trip and leaves every booking active, so the crew
   * may still need the roll call to put people back ashore (dive-domain review
   * 20260920): a cancelled trip has no current phase, and keeps its door.
   */
  it("keeps the Roll call door on a cancelled trip", () => {
    const frame = readFileSync(join(__dirname, "_components", "trip-frame.ts"), "utf8");
    expect(frame).toMatch(/rollCallDoor:\s*current === null \|\|/);
    expect(BODY).toMatch(/rollCallPlace\(\{\s*\.\.\.\{ door: frame\.rollCallDoor/);
    expect(BODY).toMatch(/rollCall=\{rollCall\}/);
  });
});
