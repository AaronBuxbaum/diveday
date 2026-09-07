import { describe, expect, it, vi } from "vitest";
import { tideWindowsForDeparture } from "./departure-tides";
import { DEFAULT_DOCK_DAY_RHYTHM } from "./diver-planning";

const NOAA_PAYLOAD = {
  predictions: [
    { t: "2026-07-21 00:52", v: "0.133", type: "L" },
    { t: "2026-07-21 06:45", v: "0.697", type: "H" },
    { t: "2026-07-21 13:19", v: "0.018", type: "L" },
    { t: "2026-07-21 19:31", v: "0.686", type: "H" },
  ],
};

const site = (name: string, tideStationId: string | null, preference: "any" | "slack" = "any") => ({
  name,
  tideStationId,
  tidePreference: preference,
  expectedBottomTimeMinutes: null,
});

/** An hour before the seeded departure, so the sailed guard does not fire. */
const BEFORE_DEPARTURE = new Date("2026-07-21T11:00:00Z");

describe("tideWindowsForDeparture", () => {
  it("reads each stationed dive at its own arrival and skips the rest", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    // 8:00 AM Key Largo in July is 12:00Z; dive one arrives 12:20Z (ebb toward
    // the 13:19 low), dive two at 14:05Z (flood, inside no slack window).
    const windows = await tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:00:00Z"),
      now: BEFORE_DEPARTURE,
      plannedDives: 3,
      diveMode: "boat",
      dives: [
        { diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") },
        { diveNumber: 2, travelMinutes: null, site: site("French Reef", null) },
        { diveNumber: 3, travelMinutes: null, site: site("Spiegel Grove", "8723583", "slack") },
      ],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      timeZone: "America/New_York",
      fetcher,
    });
    expect(windows.map((entry) => [entry.diveNumber, entry.siteName, entry.window.phase])).toEqual([
      [1, "Molasses Reef", "ebb"],
      [3, "Spiegel Grove", "flood"],
    ]);
    expect(windows[0]?.arrival.toISOString()).toBe("2026-07-21T12:20:00.000Z");
    expect(windows[1]?.preference).toBe("slack");
    // One station, one local day: the seam is asked once.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetcher.mock.calls[0]?.[0] as string).searchParams.get("begin_date")).toBe(
      "20260720",
    );
  });

  it("is empty when no site has a station, without touching the network", async () => {
    const fetcher = vi.fn();
    await expect(
      tideWindowsForDeparture({
        startsAt: new Date("2026-07-21T12:00:00Z"),
        now: BEFORE_DEPARTURE,
        plannedDives: 2,
        diveMode: "boat",
        dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", null) }],
        rhythm: DEFAULT_DOCK_DAY_RHYTHM,
        timeZone: "America/New_York",
        fetcher,
      }),
    ).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says nothing for a dive whose station answers nothing", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    await expect(
      tideWindowsForDeparture({
        startsAt: new Date("2026-07-21T12:00:00Z"),
        now: BEFORE_DEPARTURE,
        plannedDives: 1,
        diveMode: "boat",
        dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
        rhythm: DEFAULT_DOCK_DAY_RHYTHM,
        timeZone: "America/New_York",
        fetcher,
      }),
    ).resolves.toEqual([]);
  });

  /**
   * Every one of these sentences is present tense -- "this departure reaches
   * the site on the flood" -- so on a boat that has already gone it is a live
   * claim about where that boat is. The marine outlook beside it has been
   * gated to future departures all along.
   */
  it("says nothing about a departure that has already sailed", async () => {
    const fetcher = vi.fn();
    const windows = await tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:00:00Z"),
      now: new Date("2026-07-21T18:00:00Z"),
      plannedDives: 2,
      diveMode: "boat",
      dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      timeZone: "America/New_York",
      fetcher,
    });
    expect(windows).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  /**
   * **A proposed departure is exempt from that guard**, because nothing has
   * sailed: the add panel's composer is asking what the water would do for a
   * departure a staffer is still typing.
   *
   * The instants here are the ones that actually broke it. The panel opens
   * with an 8:30 AM local default, which on 2026-07-21 in Key Largo is
   * 12:30Z, and the e2e fleet's frozen clock is 13:30Z — exactly one
   * late-arrival buffer later, so `hasSailed` is true on the boundary and the
   * composer answered nothing. That timed out the staff tide capture on both
   * visual shards of every run. In production the same silence starts every
   * morning at about half past nine.
   */
  it("still answers for a proposed departure whose start time has passed", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    const windows = await tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:30:00Z"),
      now: new Date("2026-07-21T13:30:00Z"),
      proposed: true,
      plannedDives: 1,
      diveMode: "boat",
      dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      timeZone: "America/New_York",
      fetcher,
    });
    expect(windows).toHaveLength(1);
    expect(fetcher).toHaveBeenCalled();
  });

  /**
   * The rhythm is laid over `startsAt` and `plannedDives` is the total across
   * every day, so a day-two dive would be handed a day-one arrival instant and
   * the wrong water. Each day owns its own `trip_schedule_days.startsAt`;
   * until the dives are split across them, saying nothing is the only honest
   * answer beside a Book button.
   */
  it("refuses a multi-day departure rather than placing its dives on day one", async () => {
    const fetcher = vi.fn();
    const windows = await tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:00:00Z"),
      now: BEFORE_DEPARTURE,
      plannedDives: 4,
      diveMode: "boat",
      scheduleDayCount: 2,
      dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      timeZone: "America/New_York",
      fetcher,
    });
    expect(windows).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
