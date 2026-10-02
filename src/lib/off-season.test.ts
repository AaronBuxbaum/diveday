import { describe, expect, it } from "vitest";
import { OFF_SEASON_QUIET_DAYS, offSeason } from "./off-season";

const now = new Date("2026-01-15T12:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

describe("offSeason", () => {
  it("is not quiet while a departure sits inside the window", () => {
    expect(offSeason({ now, firstDeparture: inDays(29) })).toEqual({
      quiet: false,
      opensAt: null,
    });
  });

  it("holds the boundary: a departure exactly at the horizon still counts as in season", () => {
    const edge = inDays(OFF_SEASON_QUIET_DAYS);
    expect(offSeason({ now, firstDeparture: edge }).quiet).toBe(false);
    // One millisecond later is the first quiet board — the comparison is
    // strictly greater-than, so the horizon day itself is never orphaned.
    expect(offSeason({ now, firstDeparture: new Date(edge.getTime() + 1) }).quiet).toBe(true);
  });

  it("names the departure the shop is back on when one sits beyond the window", () => {
    const back = inDays(60);
    expect(offSeason({ now, firstDeparture: back })).toEqual({
      quiet: true,
      opensAt: back,
    });
  });

  it("says quiet with nothing to point at while the board is empty", () => {
    expect(offSeason({ now, firstDeparture: null })).toEqual({
      quiet: true,
      opensAt: null,
    });
  });
});
