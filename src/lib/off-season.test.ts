import { describe, expect, it } from "vitest";
import { OFF_SEASON_QUIET_DAYS, offSeason } from "./off-season";

const now = new Date("2026-01-15T12:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
const today = "2026-01-15";

const season = (id: string, startsOn: string, endsOn: string) => ({ id, startsOn, endsOn });

describe("offSeason", () => {
  it("is not quiet while a departure sits inside the window", () => {
    expect(offSeason({ now, firstDeparture: inDays(29), today })).toEqual({
      quiet: false,
      opensAt: null,
      nextSeason: null,
    });
  });

  it("holds the boundary: a departure exactly at the horizon still counts as in season", () => {
    const edge = inDays(OFF_SEASON_QUIET_DAYS);
    expect(offSeason({ now, firstDeparture: edge, today }).quiet).toBe(false);
    // One millisecond later is the first quiet board — the comparison is
    // strictly greater-than, so the horizon day itself is never orphaned.
    expect(offSeason({ now, firstDeparture: new Date(edge.getTime() + 1), today }).quiet).toBe(
      true,
    );
  });

  it("names the departure the shop is back on when one sits beyond the window", () => {
    const back = inDays(60);
    expect(offSeason({ now, firstDeparture: back, today })).toEqual({
      quiet: true,
      opensAt: back,
      nextSeason: null,
    });
  });

  it("falls back to the soonest season the shop has written when the board is empty", () => {
    const result = offSeason({
      now,
      firstDeparture: null,
      today,
      seasons: [
        season("derby", "2026-08-01", "2026-08-02"),
        season("mini", "2026-07-29", "2026-07-30"),
      ],
    });
    expect(result.quiet).toBe(true);
    expect(result.opensAt).toBeNull();
    expect(result.nextSeason?.id).toBe("mini");
  });

  it("ignores a season that is live or already over — neither answers 'when are you back'", () => {
    const result = offSeason({
      now,
      firstDeparture: null,
      today,
      seasons: [
        season("over", "2025-12-01", "2025-12-31"),
        season("live", "2026-01-10", "2026-01-20"),
      ],
    });
    expect(result.nextSeason).toBeNull();
  });

  it("prefers a scheduled departure over a written season — one answer, not two", () => {
    const back = inDays(45);
    const result = offSeason({
      now,
      firstDeparture: back,
      today,
      seasons: [season("mini", "2026-07-29", "2026-07-30")],
    });
    expect(result.opensAt).toBe(back);
    expect(result.nextSeason).toBeNull();
  });

  it("says quiet with nothing to point at for a shop that has written nothing", () => {
    expect(offSeason({ now, firstDeparture: null, today })).toEqual({
      quiet: true,
      opensAt: null,
      nextSeason: null,
    });
  });
});
