import { describe, expect, it } from "vitest";
import {
  ARRIVALS_AHEAD_HOURS,
  ARRIVALS_LOOKBACK_HOURS,
  arrivalsWindow,
  arrivalsWindowIsInsideHorizon,
  BLOCKERS_TRIPS_PER_PAGE,
  OPERATIONAL_HORIZON_DAYS,
  OPERATIONAL_HORIZON_MS,
  OPERATIONAL_MAX_TRIPS,
  operationalWindow,
  pageOf,
  SHOP_DAY_SCAN_HOURS,
  shopDayWindow,
  withinWindow,
} from "./operational-window";

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
    expect(window.from.getTime()).toBe(NOW.getTime() - ARRIVALS_LOOKBACK_HOURS * HOUR);
    expect(window.to.getTime()).toBe(NOW.getTime() + ARRIVALS_AHEAD_HOURS * HOUR);
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

describe("the shop-day scan", () => {
  it("reaches the same distance either side of now", () => {
    const window = shopDayWindow(NOW);
    expect(window.from.getTime()).toBe(NOW.getTime() - SHOP_DAY_SCAN_HOURS * HOUR);
    expect(window.to.getTime()).toBe(NOW.getTime() + SHOP_DAY_SCAN_HOURS * HOUR);
  });

  it("holds the whole of the shop's own calendar day, wherever now sits inside it", () => {
    // This is the property the scan exists for, and the one the old inline
    // −18h/+30h failed: a local day reaches nearly 24 hours *back* from a
    // 23:59 moment inside it, so an 18-hour lookback lost the shop's own
    // morning boat late in the evening. Both edges are checked at every hour
    // the shop's local clock could currently read, and at every real UTC
    // offset (UTC−12 through UTC+14, half-hour zones included).
    for (const offsetHours of [-12, -8, 0, 5.5, 9, 14]) {
      // Local midnight of the shop's current day at this offset, in UTC.
      const dayStart = Math.floor((NOW.getTime() + offsetHours * HOUR) / DAY) * DAY;
      const firstInstant = new Date(dayStart - offsetHours * HOUR);
      const lastInstant = new Date(dayStart + DAY - offsetHours * HOUR - 1);
      for (let hourOfDay = 0; hourOfDay < 24; hourOfDay++) {
        // A "now" that reads `hourOfDay`:59 on that same local day.
        const scan = shopDayWindow(
          new Date(dayStart + hourOfDay * HOUR + 59 * 60_000 - offsetHours * HOUR),
        );
        expect(withinWindow(scan, firstInstant)).toBe(true);
        expect(withinWindow(scan, lastInstant)).toBe(true);
      }
    }
  });

  it("stays a query bound, never a readiness lens", () => {
    // It looks *back*, which the operational horizon deliberately does not, and
    // forward by barely more than a day — so it can never be mistaken for, or
    // quietly widen, the window Today and Check-in share.
    const shopDay = shopDayWindow(NOW);
    const horizon = operationalWindow(NOW);
    expect(shopDay.from.getTime()).toBeLessThan(horizon.from.getTime());
    expect(shopDay.to.getTime()).toBeLessThan(horizon.to.getTime());
  });
});

describe("work bounds", () => {
  it("keeps the inspection cap comfortably above a paged screenful", () => {
    expect(OPERATIONAL_MAX_TRIPS).toBeGreaterThan(BLOCKERS_TRIPS_PER_PAGE);
  });
});

describe("pageOf", () => {
  const items = Array.from({ length: 23 }, (_, index) => index);

  it("slices the requested page", () => {
    expect(pageOf(items, 1, 10)).toMatchObject({ page: 1, pageCount: 3 });
    expect(pageOf(items, 2, 10).items).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(pageOf(items, 3, 10).items).toEqual([20, 21, 22]);
  });

  it("clamps a hand-typed page rather than showing an empty queue", () => {
    expect(pageOf(items, 0, 10).page).toBe(1);
    expect(pageOf(items, -3, 10).page).toBe(1);
    expect(pageOf(items, Number.NaN, 10).page).toBe(1);
    expect(pageOf(items, 99, 10)).toMatchObject({ page: 3, pageCount: 3 });
  });

  it("reports one page for an empty queue instead of zero", () => {
    expect(pageOf([], 1, 10)).toEqual({ page: 1, pageCount: 1, items: [] });
  });

  it("never drops an item across the pages it reports", () => {
    const seen: number[] = [];
    const { pageCount } = pageOf(items, 1, 10);
    for (let page = 1; page <= pageCount; page += 1) seen.push(...pageOf(items, page, 10).items);
    expect(seen).toEqual(items);
  });
});
