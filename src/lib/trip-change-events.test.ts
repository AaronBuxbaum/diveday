import { describe, expect, it } from "vitest";
import {
  tripArrivalSnapshot,
  tripChangeSnapshotsEqual,
  tripConditionsSnapshot,
  tripSiteNames,
  tripSitesSnapshot,
} from "./trip-change-events";

describe("public trip change snapshots", () => {
  it("trims optional arrival facts and turns blank values into null", () => {
    expect(
      tripArrivalSnapshot({
        meetingPointLabel: "  North Jetty  ",
        meetingPointAddress: "   ",
        arrivalLandmark: "  Blue sign  ",
        arrivalParkingNote: undefined,
        arrivalTransitNote: "  Bus 4  ",
        arrivalLookFor: null,
        arrivalFirstInteraction: "  Ask Dana  ",
        arrivalPhotoUrl: "  /arrival/photo.jpg  ",
      }),
    ).toEqual({
      meetingPointLabel: "North Jetty",
      meetingPointAddress: null,
      arrivalLandmark: "Blue sign",
      arrivalParkingNote: null,
      arrivalTransitNote: "Bus 4",
      arrivalLookFor: null,
      arrivalFirstInteraction: "Ask Dana",
      arrivalPhotoUrl: "/arrival/photo.jpg",
    });
  });

  it("compares material fields without depending on object key order", () => {
    expect(
      tripChangeSnapshotsEqual(
        { meetingPointLabel: "Dock", meetingPointAddress: null },
        { meetingPointAddress: null, meetingPointLabel: "Dock" },
      ),
    ).toBe(true);
    expect(
      tripChangeSnapshotsEqual(
        { meetingPointLabel: "Dock", meetingPointAddress: null },
        { meetingPointLabel: "Shore", meetingPointAddress: null },
      ),
    ).toBe(false);
  });

  it("normalizes conditions while preserving a real zero measurement", () => {
    expect(
      tripConditionsSnapshot({
        conditionsHold: false,
        conditionsSummary: "  Calm  ",
        waterTemperatureC: 0,
        visibilityMeters: 0,
        surfaceConditions: "  Flat  ",
      }),
    ).toEqual({
      conditionsHold: false,
      conditionsSummary: "Calm",
      waterTemperatureC: 0,
      visibilityMeters: 0,
      surfaceConditions: "Flat",
    });
  });
});

describe("tripSitesSnapshot (issue #3060)", () => {
  it("keeps the run in order, each name once, blanks dropped and space folded", () => {
    const snapshot = tripSitesSnapshot(["Molasses Reef", null, " French  Reef ", "Molasses Reef"]);
    expect(snapshot).toEqual({ siteNames: "Molasses Reef\nFrench Reef" });
    expect(tripSiteNames(snapshot)).toEqual(["Molasses Reef", "French Reef"]);
  });

  it("is null with no site, and compares by the run, not the object", () => {
    expect(tripSitesSnapshot([null, undefined, " "])).toEqual({ siteNames: null });
    expect(tripSiteNames({ siteNames: null })).toEqual([]);
    expect(tripSiteNames(null)).toEqual([]);
    expect(
      tripChangeSnapshotsEqual(tripSitesSnapshot(["A", "B"]), tripSitesSnapshot(["A", "B", "A"])),
    ).toBe(true);
    expect(
      tripChangeSnapshotsEqual(tripSitesSnapshot(["A", "B"]), tripSitesSnapshot(["B", "A"])),
    ).toBe(false);
  });
});
