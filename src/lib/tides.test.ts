import { describe, expect, it } from "vitest";
import { DEFAULT_DOCK_DAY_RHYTHM } from "./diver-planning";
import {
  diveArrivalAt,
  isTidePreference,
  isTideStationId,
  SLACK_WINDOW_MINUTES,
  type TidePrediction,
  tidePreferenceMet,
  tideWindowAt,
} from "./tides";

const turn = (iso: string, kind: "high" | "low"): TidePrediction => ({
  at: new Date(iso),
  kind,
  heightMeters: kind === "high" ? 0.7 : 0.1,
});

// The real Carysfort Reef table for 2026-07-21 (GMT), as NOAA published it.
const DAY = [
  turn("2026-07-21T00:52:00Z", "low"),
  turn("2026-07-21T06:45:00Z", "high"),
  turn("2026-07-21T13:19:00Z", "low"),
  turn("2026-07-21T19:31:00Z", "high"),
  turn("2026-07-22T01:47:00Z", "low"),
];

describe("tideWindowAt", () => {
  it("reads the flood between a low and the next high", () => {
    const window = tideWindowAt(DAY, new Date("2026-07-21T03:30:00Z"));
    expect(window?.phase).toBe("flood");
    // The 00:52 low (158 minutes behind) is nearer than the 06:45 high (195
    // ahead), so the turn named is the one that has passed.
    expect(window?.nearestTurn.at.toISOString()).toBe("2026-07-21T00:52:00.000Z");
    expect(window?.minutesToTurn).toBe(-158);
  });

  it("reads the ebb between a high and the next low", () => {
    const window = tideWindowAt(DAY, new Date("2026-07-21T10:00:00Z"));
    expect(window?.phase).toBe("ebb");
    // 13:19 is 199 minutes ahead; 06:45 is 195 minutes behind, so the nearer
    // turn is the high that has passed, and the sign says so.
    expect(window?.nearestTurn.kind).toBe("high");
    expect(window?.minutesToTurn).toBe(-195);
  });

  it("reads slack inside the window either side of a turn, inclusive at the edge", () => {
    expect(tideWindowAt(DAY, new Date("2026-07-21T06:45:00Z"))?.phase).toBe("slack");
    expect(tideWindowAt(DAY, new Date("2026-07-21T06:20:00Z"))?.phase).toBe("slack");
    expect(tideWindowAt(DAY, new Date("2026-07-21T07:15:00Z"))?.phase).toBe("slack");
    const edge = new Date(
      new Date("2026-07-21T06:45:00Z").getTime() + SLACK_WINDOW_MINUTES * 60_000,
    );
    expect(tideWindowAt(DAY, edge)?.phase).toBe("slack");
    const past = new Date(edge.getTime() + 60_000);
    expect(tideWindowAt(DAY, past)?.phase).toBe("ebb");
  });

  it("honours a narrower slack window when asked", () => {
    expect(tideWindowAt(DAY, new Date("2026-07-21T07:10:00Z"), 10)?.phase).toBe("ebb");
  });

  it("answers from one side when the arrival falls before the first or after the last turn", () => {
    const beforeFirst = tideWindowAt(DAY, new Date("2026-07-20T22:00:00Z"));
    expect(beforeFirst?.phase).toBe("ebb"); // falling toward the 00:52 low
    expect(beforeFirst?.nearestTurn.kind).toBe("low");
    const afterLast = tideWindowAt(DAY, new Date("2026-07-22T04:00:00Z"));
    expect(afterLast?.phase).toBe("flood"); // rising away from the 01:47 low
    expect(afterLast?.nearestTurn.at.toISOString()).toBe("2026-07-22T01:47:00.000Z");
  });

  it("does not care what order the predictions arrive in", () => {
    const shuffled = [DAY[3], DAY[0], DAY[4], DAY[1], DAY[2]] as TidePrediction[];
    expect(tideWindowAt(shuffled, new Date("2026-07-21T03:30:00Z"))?.phase).toBe("flood");
  });

  it("returns null for no predictions, an invalid arrival, or two turns of one kind in a row", () => {
    expect(tideWindowAt([], new Date("2026-07-21T03:30:00Z"))).toBeNull();
    expect(tideWindowAt(DAY, new Date(Number.NaN))).toBeNull();
    const gap = [turn("2026-07-21T06:45:00Z", "high"), turn("2026-07-21T19:31:00Z", "high")];
    expect(tideWindowAt(gap, new Date("2026-07-21T12:00:00Z"))).toBeNull();
    // ...but still reads slack beside one of them, since that needs no direction.
    expect(tideWindowAt(gap, new Date("2026-07-21T06:50:00Z"))?.phase).toBe("slack");
  });

  it("drops a prediction whose instant is invalid rather than failing the day", () => {
    const withJunk = [...DAY, { at: new Date(Number.NaN), kind: "high", heightMeters: 0 } as const];
    expect(tideWindowAt(withJunk, new Date("2026-07-21T03:30:00Z"))?.phase).toBe("flood");
  });
});

describe("tidePreferenceMet", () => {
  const window = tideWindowAt(DAY, new Date("2026-07-21T03:30:00Z"));
  if (!window) throw new Error("fixture window");

  it("says nothing when the shop expressed no preference", () => {
    expect(tidePreferenceMet(window, null)).toBeNull();
    expect(tidePreferenceMet(window, undefined)).toBeNull();
    expect(tidePreferenceMet(window, "any")).toBeNull();
  });

  it("compares the arrival's phase to the shop's own", () => {
    expect(tidePreferenceMet(window, "flood")).toBe(true);
    expect(tidePreferenceMet(window, "slack")).toBe(false);
    expect(tidePreferenceMet(window, "ebb")).toBe(false);
  });
});

describe("diveArrivalAt", () => {
  const startsAt = new Date("2026-07-21T12:00:00Z");

  it("lands dive one after the ride out and dive two after the interval", () => {
    // Default rhythm: 20 min ride, 45 min bottom, 60 min interval.
    expect(diveArrivalAt(startsAt, DEFAULT_DOCK_DAY_RHYTHM, 1)?.toISOString()).toBe(
      "2026-07-21T12:20:00.000Z",
    );
    expect(diveArrivalAt(startsAt, DEFAULT_DOCK_DAY_RHYTHM, 2)?.toISOString()).toBe(
      "2026-07-21T14:05:00.000Z",
    );
  });

  it("uses the stated legs and site bottom times when there are any", () => {
    const at = diveArrivalAt(startsAt, DEFAULT_DOCK_DAY_RHYTHM, 2, {
      legTravelTimes: [40, 75],
      siteBottomTimes: [30],
    });
    // 40 out, 30 down, then the 75-minute run beats the 60-minute interval.
    expect(at?.toISOString()).toBe("2026-07-21T14:25:00.000Z");
  });

  it("walks straight to the water on a shore day", () => {
    expect(
      diveArrivalAt(startsAt, DEFAULT_DOCK_DAY_RHYTHM, 1, { diveMode: "shore" })?.toISOString(),
    ).toBe("2026-07-21T12:00:00.000Z");
  });

  it("is null for a dive the plan does not have", () => {
    expect(diveArrivalAt(startsAt, DEFAULT_DOCK_DAY_RHYTHM, 0)).toBeNull();
  });
});

describe("the two shape checks", () => {
  it("accepts a seven-digit NOAA id and nothing else", () => {
    expect(isTideStationId("8723583")).toBe(true);
    expect(isTideStationId("872358")).toBe(false);
    expect(isTideStationId("8723583a")).toBe(false);
    expect(isTideStationId("")).toBe(false);
  });

  it("knows the four preferences", () => {
    expect(isTidePreference("slack")).toBe(true);
    expect(isTidePreference("any")).toBe(true);
    expect(isTidePreference("spring")).toBe(false);
    expect(isTidePreference(null)).toBe(false);
  });
});
