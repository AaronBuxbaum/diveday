import { describe, expect, it } from "vitest";
import { arrivalsWindow } from "./departure-clock";
import {
  arrivalsWindowIsInsideHorizon,
  OPERATIONAL_HORIZON_DAYS,
  OPERATIONAL_HORIZON_MS,
  type OperationalWindow,
  operationalWindow,
} from "./operational-window";

const withinWindow = (window: OperationalWindow, at: Date): boolean =>
  at.getTime() >= window.from.getTime() && at.getTime() <= window.to.getTime();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-08-03T09:00:00.000Z");

describe("the operational horizon", () => {
  it("runs from now to the horizon, with no lookback", () => {
    const window = operationalWindow(NOW);
    expect(window.from.getTime()).toBe(NOW.getTime());
    expect(window.to.getTime()).toBe(NOW.getTime() + OPERATIONAL_HORIZON_DAYS * DAY);
    expect(OPERATIONAL_HORIZON_MS).toBe(OPERATIONAL_HORIZON_DAYS * DAY);
  });

  it("includes both bounds so a departure exactly on the horizon is still work", () => {
    const window = operationalWindow(NOW);
    expect(withinWindow(window, NOW)).toBe(true);
    expect(withinWindow(window, window.to)).toBe(true);
    expect(withinWindow(window, new Date(window.to.getTime() + 1))).toBe(false);
    expect(withinWindow(window, new Date(NOW.getTime() - 1))).toBe(false);
  });
});

describe("the arrivals window", () => {
  it("reaches back over the boats that already sailed and forward over tomorrow's", () => {
    const window = arrivalsWindow(NOW);
    expect(window.from.getTime()).toBe(NOW.getTime() - 6 * HOUR);
    expect(window.to.getTime()).toBe(NOW.getTime() + 36 * HOUR);
  });

  it("never outruns the operational horizon, so Check-in can't show what Not ready dropped", () => {
    for (const at of ["2026-01-01T00:00:00.000Z", "2026-08-03T09:00:00.000Z", NOW.toISOString()]) {
      const now = new Date(at);
      expect(arrivalsWindowIsInsideHorizon(now)).toBe(true);
      expect(arrivalsWindow(now).to.getTime()).toBeLessThanOrEqual(
        operationalWindow(now).to.getTime(),
      );
    }
  });

  it("reaches further back than the horizon does — the one deliberate asymmetry", () => {
    expect(arrivalsWindow(NOW).from.getTime()).toBeLessThan(operationalWindow(NOW).from.getTime());
  });

  it("puts every arrival that is still ahead of now inside the horizon too", () => {
    const arrivals = arrivalsWindow(NOW);
    const horizon = operationalWindow(NOW);
    const departures = [NOW, new Date(NOW.getTime() + 12 * HOUR), arrivals.to];
    for (const departure of departures) {
      expect(withinWindow(arrivals, departure)).toBe(true);
      expect(withinWindow(horizon, departure)).toBe(true);
    }
  });
});
