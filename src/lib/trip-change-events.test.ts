import { describe, expect, it } from "vitest";
import {
  tripArrivalSnapshot,
  tripChangeSnapshotsEqual,
  tripConditionsSnapshot,
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
