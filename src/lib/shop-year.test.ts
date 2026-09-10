import { describe, expect, it } from "vitest";
import { type ShopYearInput, summarizeShopYear } from "./shop-year";

/**
 * The year's arithmetic without a database under it (ADR 20260908-one-hand,
 * decision 6, lever T). `src/db/reporting.test.ts` proves the read; these are
 * the three rules that decide what the page is allowed to *say* — the strip's
 * shape, the month it may call quietest, and the month a shop's year starts in.
 */

const EMPTY: ShopYearInput = {
  year: 2026,
  firstDay: "2026-01-01",
  lastDay: "2026-08-27",
  openedThisYear: false,
  today: "2026-08-27",
  days: [],
  boats: [],
  sites: [],
  entries: [],
};

function year(input: Partial<ShopYearInput>) {
  return summarizeShopYear({ ...EMPTY, ...input });
}

describe("summarizeShopYear", () => {
  it("draws one square per day and stops at today", () => {
    const summary = year({});
    // 2026-01-01 is a Thursday, so the year opens with four padding squares.
    expect(summary.strip.slice(0, 4).map((cell) => cell.day)).toEqual([null, null, null, null]);
    expect(summary.strip[4]?.day).toBe("2026-01-01");
    expect(summary.strip.at(-1)?.day).toBe("2026-08-27");
    expect(summary.strip.at(-1)?.isToday).toBe(true);
    // Every square before today's is a real day, and the grid is whole weeks
    // plus however much of this one has happened.
    expect(summary.strip).toHaveLength(4 + 239);
  });

  it("deepens the water with how full the boats were", () => {
    const summary = year({
      days: [
        { day: "2026-02-02", boats: 1, divers: 0, seats: 10 },
        { day: "2026-02-03", boats: 1, divers: 4, seats: 10 },
        { day: "2026-02-04", boats: 1, divers: 8, seats: 10 },
        { day: "2026-02-05", boats: 1, divers: 10, seats: 10 },
      ],
    });
    const fills = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"].map(
      (day) => summary.strip.find((cell) => cell.day === day)?.fill,
    );
    expect(fills).toEqual([1, 1, 2, 3]);
    // A day nothing sailed is the ground, not a level of water.
    expect(summary.strip.find((cell) => cell.day === "2026-02-06")?.fill).toBe(0);
  });

  it("never calls the month still running the quietest one", () => {
    const summary = year({
      days: [
        { day: "2026-03-02", boats: 1, divers: 9, seats: 10 },
        // August is thinner than March, and August has not finished.
        { day: "2026-08-03", boats: 1, divers: 1, seats: 10 },
      ],
    });
    expect(summary.quietestMonth).toEqual({ month: 3, divers: 9, boats: 1 });
  });

  it("has no quietest month before a month has finished", () => {
    const summary = year({
      firstDay: "2026-08-01",
      openedThisYear: true,
      days: [{ day: "2026-08-03", boats: 1, divers: 4, seats: 10 }],
    });
    expect(summary.quietestMonth).toBeNull();
  });

  it("breaks a tie on the earlier month and the earlier day", () => {
    const summary = year({
      days: [
        { day: "2026-03-02", boats: 1, divers: 5, seats: 10 },
        { day: "2026-04-02", boats: 1, divers: 5, seats: 10 },
        { day: "2026-05-02", boats: 1, divers: 9, seats: 10 },
        { day: "2026-06-02", boats: 1, divers: 9, seats: 10 },
      ],
    });
    expect(summary.quietestMonth?.month).toBe(3);
    expect(summary.busiestDay?.day).toBe("2026-05-02");
  });

  it("says since the month a shop opened in, and nothing for one that opened in January", () => {
    expect(year({ firstDay: "2026-05-20", openedThisYear: true }).sinceMonth).toBe(5);
    expect(year({ firstDay: "2026-01-04", openedThisYear: true }).sinceMonth).toBeNull();
    expect(year({ firstDay: "2026-01-01", openedThisYear: false }).sinceMonth).toBeNull();
  });

  it("measures every site's bar against the most-dived one", () => {
    const summary = year({
      sites: [
        { siteId: "a", name: "Molasses Reef", times: 8, live: true },
        { siteId: "b", name: "Benwood", times: 2, live: true },
      ],
    });
    expect(summary.sites.map((site) => site.share)).toEqual([1, 0.25]);
    expect(summary.siteCount).toBe(2);
  });

  it("a year with no departures has nothing to say", () => {
    const summary = year({});
    expect(summary.hasActivity).toBe(false);
    expect(summary.divers).toBe(0);
    expect(summary.boatsOut).toBe(0);
    expect(summary.daysAtSea).toBe(0);
    expect(summary.busiestDay).toBeNull();
    expect(summary.quietestMonth).toBeNull();
  });
});
