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

describe("tideWindowsForDeparture", () => {
  it("reads each stationed dive at its own arrival and skips the rest", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(NOAA_PAYLOAD)));
    // 8:00 AM Key Largo in July is 12:00Z; dive one arrives 12:20Z (ebb toward
    // the 13:19 low), dive two at 14:05Z (flood, inside no slack window).
    const windows = await tideWindowsForDeparture({
      startsAt: new Date("2026-07-21T12:00:00Z"),
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
        plannedDives: 1,
        diveMode: "boat",
        dives: [{ diveNumber: 1, travelMinutes: null, site: site("Molasses Reef", "8723583") }],
        rhythm: DEFAULT_DOCK_DAY_RHYTHM,
        timeZone: "America/New_York",
        fetcher,
      }),
    ).resolves.toEqual([]);
  });
});
