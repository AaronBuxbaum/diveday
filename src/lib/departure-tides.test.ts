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

/** NOAA's `mdapi` record for 8723583, trimmed to the fields the parser reads. */
const STATION_PAYLOAD = {
  stations: [{ name: "Carysfort Reef", state: "FL", lat: 25.2217, lng: -80.2117 }],
};

/**
 * NOAA's two endpoints behind one mock.
 *
 * Since issue #1732 a departure asks for both — the predictions table and the
 * station's own record — so a fetcher answering one body to everything would
 * have the station parser reading a predictions payload. That answers `null`,
 * which is a real outcome and has its own test below, but it is not the
 * ordinary one and it should not be what every other test here exercises.
 */
function noaaFetcher(stationPayload: unknown = STATION_PAYLOAD) {
  return vi
    .fn()
    .mockImplementation(async (url: string) =>
      String(url).includes("/mdapi/")
        ? new Response(JSON.stringify(stationPayload))
        : new Response(JSON.stringify(NOAA_PAYLOAD)),
    );
}

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
    const fetcher = noaaFetcher();
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
    // Whose water, on both entries — the two sites read the same station, and
    // saying so is the point of issue #1732: the editor that names it is the
    // page nobody reopens, and this is the one a divemaster reads on the day.
    expect(windows.map((entry) => entry.stationLabel)).toEqual([
      "Carysfort Reef, FL",
      "Carysfort Reef, FL",
    ]);
    // One station, one local day: each seam is asked once — two requests for
    // NOAA's two endpoints, not two stations' worth of either.
    const asked = fetcher.mock.calls.map((call) => String(call[0]));
    expect(asked).toHaveLength(2);
    const predictions = asked.find((url) => !url.includes("/mdapi/"));
    expect(new URL(predictions ?? "").searchParams.get("begin_date")).toBe("20260720");
    expect(asked.some((url) => url.endsWith("/stations/8723583.json"))).toBe(true);
  });

  /**
   * **The provenance is the footnote; the sentence is the product.** Nothing
   * in this feature has ever let a failed lookup remove a line, and a station
   * endpoint that is down while the predictions endpoint is up must not be the
   * first thing that does (issue #1732).
   */
  it("leaves the tide sentence standing when the station lookup answers nothing", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async (url: string) =>
        String(url).includes("/mdapi/")
          ? new Response("down", { status: 503 })
          : new Response(JSON.stringify(NOAA_PAYLOAD)),
      );
    const windows = await tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:00:00Z"),
      now: BEFORE_DEPARTURE,
      plannedDives: 1,
      diveMode: "boat",
      dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      timeZone: "America/New_York",
      fetcher,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0]?.window.phase).toBe("ebb");
    expect(windows[0]?.stationLabel).toBeNull();
  });

  /**
   * The diver's departure page is unauthenticated and each of these seams is
   * bounded at four seconds, so asking the second one *after* the first would
   * double that page's worst case on a day NOAA is unreachable rather than
   * leaving it where it was. Both are four-second bounds started together.
   *
   * Asserted without awaiting anything, which is what makes it an assertion
   * about ordering rather than about speed: the whole function is synchronous
   * up to its one `Promise.all`, so both requests are out before this line
   * runs. A serial version has issued exactly one.
   */
  it("asks NOAA's two endpoints in the same breath, never one after the other", async () => {
    const asked: string[] = [];
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      asked.push(String(url));
      await gate;
      return new Response(
        JSON.stringify(String(url).includes("/mdapi/") ? STATION_PAYLOAD : NOAA_PAYLOAD),
      );
    });
    const pending = tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:00:00Z"),
      now: BEFORE_DEPARTURE,
      plannedDives: 1,
      diveMode: "boat",
      dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
      rhythm: DEFAULT_DOCK_DAY_RHYTHM,
      timeZone: "America/New_York",
      fetcher,
    });

    expect(asked).toHaveLength(2);
    release();
    await expect(pending).resolves.toMatchObject([{ stationLabel: "Carysfort Reef, FL" }]);
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
    const fetcher = noaaFetcher();
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
