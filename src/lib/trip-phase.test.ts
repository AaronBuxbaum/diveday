import { describe, expect, it } from "vitest";
import { boatStageOf, departureStage, TRIP_PHASES, tripPhaseOf } from "./trip-phase";
import type { TripStage } from "./trip-stages";

const ZONE = "America/New_York";
// 07:00 local on Tue Jul 21 2026, back at 12:00.
const startsAt = new Date("2026-07-21T11:00:00.000Z");
const endsAt = new Date("2026-07-21T16:00:00.000Z");

function phaseAt(
  now: string,
  stage: TripStage | null = null,
  cancelled = false,
  // By default the crew tapped at 10:30 local on the departure's own day.
  recordedAt = "2026-07-21T14:30:00.000Z",
) {
  return tripPhaseOf({
    startsAt,
    endsAt,
    now: new Date(now),
    timeZone: ZONE,
    stage: stage ? { stage, recordedAt: new Date(recordedAt) } : null,
    cancelled,
  });
}

describe("tripPhaseOf", () => {
  it("names the four phases in the order a departure moves through them", () => {
    expect(TRIP_PHASES).toEqual(["prep", "checkin", "aboard", "back"]);
  });

  it("is Prep on any day before the departure's own", () => {
    expect(phaseAt("2026-07-20T22:00:00.000Z")).toBe("prep");
    // 23:59 local the night before is still the day before.
    expect(phaseAt("2026-07-21T03:59:00.000Z")).toBe("prep");
  });

  it("is Check-in from local midnight on the day until the boat leaves", () => {
    expect(phaseAt("2026-07-21T04:00:00.000Z")).toBe("checkin");
    expect(phaseAt("2026-07-21T10:59:00.000Z")).toBe("checkin");
  });

  it("is Aboard from the scheduled departure until an hour past the scheduled return", () => {
    expect(phaseAt("2026-07-21T11:00:00.000Z")).toBe("aboard");
    expect(phaseAt("2026-07-21T16:59:00.000Z")).toBe("aboard");
  });

  it("is Back once the departure is an hour past its scheduled return", () => {
    expect(phaseAt("2026-07-21T17:00:00.000Z")).toBe("back");
    expect(phaseAt("2026-07-25T12:00:00.000Z")).toBe("back");
  });

  it("takes the crew's word over the clock while a boat runs late", () => {
    // Two hours past the buffer, but the crew has said nothing about tying up.
    expect(phaseAt("2026-07-21T19:00:00.000Z", "heading_in")).toBe("aboard");
    expect(phaseAt("2026-07-21T19:00:00.000Z", "underway")).toBe("aboard");
  });

  it("keeps a late boat Aboard past the window a stage is published for", () => {
    // Five hours past the scheduled return: `liveStageOf` would have dropped
    // this tap, and the page must not turn Back because of it.
    expect(phaseAt("2026-07-21T21:00:00.000Z", "heading_in")).toBe("aboard");
  });

  it("stops holding Aboard once the return day is over", () => {
    // 00:30 local the next day, and nobody ever said home.
    expect(phaseAt("2026-07-22T04:30:00.000Z", "underway")).toBe("back");
  });

  it("is Aboard the moment the crew starts boarding, even before the hour", () => {
    expect(phaseAt("2026-07-21T10:30:00.000Z", "boarding", false, "2026-07-21T10:20:00.000Z")).toBe(
      "aboard",
    );
  });

  it("ignores a tap from before the departure's own day", () => {
    // Yesterday's `home`, left on the record by the last sailing.
    expect(phaseAt("2026-07-21T09:00:00.000Z", "home", false, "2026-07-20T20:00:00.000Z")).toBe(
      "checkin",
    );
  });

  it("is Back the moment the crew says home, even before the scheduled return", () => {
    expect(phaseAt("2026-07-21T14:00:00.000Z", "home")).toBe("back");
  });

  it("names no phase for a canceled departure", () => {
    expect(phaseAt("2026-07-21T10:00:00.000Z", null, true)).toBeNull();
    expect(phaseAt("2026-07-21T12:00:00.000Z", "underway", true)).toBeNull();
  });
});

/**
 * **One stage vocabulary** (UX review 2026-10-10, item 1). Today's card, the
 * departure header and the manifest strip all print this, so a captain never
 * reads "Aboard" on Today and opens a boat nobody has boarded.
 */
describe("boatStageOf", () => {
  function chipAt(
    now: string,
    stage: TripStage | null = null,
    cancelled = false,
    recordedAt = "2026-07-21T14:30:00.000Z",
  ) {
    return (
      boatStageOf({
        startsAt,
        endsAt,
        now: new Date(now),
        timeZone: ZONE,
        stage: stage ? { stage, recordedAt: new Date(recordedAt) } : null,
        cancelled,
      })?.stage ?? null
    );
  }

  it("says nothing the crew did not say, whatever the clock implies", () => {
    // Before, during and after the scheduled hours: no tap, no word. The
    // phase here would read Check-in, Aboard and Back.
    expect(chipAt("2026-07-21T10:00:00.000Z")).toBeNull();
    expect(chipAt("2026-07-21T12:00:00.000Z")).toBeNull();
    expect(chipAt("2026-07-21T18:00:00.000Z")).toBeNull();
  });

  it("is the crew's own word, the one the manifest strip has selected", () => {
    expect(chipAt("2026-07-21T10:30:00.000Z", "boarding", false, "2026-07-21T10:20:00.000Z")).toBe(
      "boarding",
    );
    expect(chipAt("2026-07-21T15:00:00.000Z", "surface")).toBe("surface");
  });

  it("keeps speaking while a boat runs late, until its return day is over", () => {
    expect(chipAt("2026-07-21T21:00:00.000Z", "heading_in")).toBe("heading_in");
    expect(chipAt("2026-07-22T04:30:00.000Z", "underway")).toBeNull();
  });

  it("keeps Home once it is said", () => {
    expect(chipAt("2026-07-25T12:00:00.000Z", "home")).toBe("home");
  });

  it("ignores a tap from before the departure's own day, and a canceled departure", () => {
    expect(
      chipAt("2026-07-21T09:00:00.000Z", "home", false, "2026-07-20T20:00:00.000Z"),
    ).toBeNull();
    expect(chipAt("2026-07-21T12:00:00.000Z", "underway", true)).toBeNull();
  });

  it("agrees with the phase it orients: a word that speaks is Aboard, Home is Back", () => {
    for (const [now, stage] of [
      ["2026-07-21T15:00:00.000Z", "underway"],
      ["2026-07-21T21:00:00.000Z", "heading_in"],
      ["2026-07-21T15:00:00.000Z", "home"],
      ["2026-07-22T04:30:00.000Z", "underway"],
    ] as const) {
      const chip = chipAt(now, stage);
      const phase = phaseAt(now, stage);
      expect(phase).toBe(chip === null || chip === "home" ? "back" : "aboard");
    }
  });
});

describe("departureStage", () => {
  const at = (now: string, stage: TripStage | null) =>
    departureStage({
      startsAt,
      endsAt,
      now: new Date(now),
      timeZone: ZONE,
      stage: stage ? { stage, recordedAt: new Date("2026-07-21T14:30:00.000Z") } : null,
      cancelled: false,
    });

  it("is finished once the boat is home, and not while it is out", () => {
    expect(at("2026-07-21T15:00:00.000Z", "underway")).toMatchObject({ finished: false });
    expect(at("2026-07-21T15:00:00.000Z", "home")).toMatchObject({ finished: true });
  });

  it("is finished by the clock when the crew never tapped, but shows no word", () => {
    expect(at("2026-07-21T22:00:00.000Z", null)).toEqual({ shown: null, finished: true });
    expect(at("2026-07-21T10:00:00.000Z", null)).toEqual({ shown: null, finished: false });
  });
});

/**
 * A crew's tap must never finish a departure sooner than silence would (dive
 * domain review of UX batch 1). A night boat back at 23:30 is still inside its
 * hour's buffer at 00:05: the untapped twin reads Aboard by the clock, so the
 * one the crew tapped Underway must too, and its chip must still speak.
 */
describe("a night boat across midnight", () => {
  // 20:00 to 23:30 local on Tue Jul 21 2026.
  const nightStarts = new Date("2026-07-22T00:00:00.000Z");
  const nightEnds = new Date("2026-07-22T03:30:00.000Z");
  // Tapped Underway at 21:00 local.
  const underway = {
    stage: "underway" as TripStage,
    recordedAt: new Date("2026-07-22T01:00:00.000Z"),
  };
  const at = (now: string, stage: typeof underway | null) => ({
    startsAt: nightStarts,
    endsAt: nightEnds,
    now: new Date(now),
    timeZone: ZONE,
    stage,
    cancelled: false,
  });

  it("stays Aboard at 00:05 with the chip still saying Underway", () => {
    expect(tripPhaseOf(at("2026-07-22T04:05:00.000Z", underway))).toBe("aboard");
    expect(boatStageOf(at("2026-07-22T04:05:00.000Z", underway))?.stage).toBe("underway");
    expect(departureStage(at("2026-07-22T04:05:00.000Z", underway)).finished).toBe(false);
  });

  it("is never finished sooner than its untapped twin", () => {
    for (const now of [
      "2026-07-22T03:59:00.000Z",
      "2026-07-22T04:00:00.000Z",
      "2026-07-22T04:05:00.000Z",
      "2026-07-22T04:29:00.000Z",
      "2026-07-22T04:30:00.000Z",
      "2026-07-22T06:00:00.000Z",
    ]) {
      const silent = tripPhaseOf(at(now, null));
      const tapped = tripPhaseOf(at(now, underway));
      if (tapped === "back") expect(silent).toBe("back");
    }
  });

  it("lets go once the hour's buffer and the return day are both over", () => {
    expect(tripPhaseOf(at("2026-07-22T04:30:00.000Z", underway))).toBe("back");
    expect(boatStageOf(at("2026-07-22T04:30:00.000Z", underway))).toBeNull();
  });
});

/**
 * A boat out 22:00 to 02:00 whose crew never taps Home (#2409). Its scheduled
 * return falls on the next shop day, but it is still one sailing: the word
 * holds through the hour's buffer and then lets go, not at the end of the
 * shop day the return falls on.
 */
describe("a night boat back after midnight, Home never tapped", () => {
  // 22:00 Tue Jul 21 to 02:00 Wed Jul 22, local.
  const nightStarts = new Date("2026-07-22T02:00:00.000Z");
  const nightEnds = new Date("2026-07-22T06:00:00.000Z");
  // Tapped Underway at 22:10 local.
  const underway = {
    stage: "underway" as TripStage,
    recordedAt: new Date("2026-07-22T02:10:00.000Z"),
  };
  const at = (now: string) => ({
    startsAt: nightStarts,
    endsAt: nightEnds,
    now: new Date(now),
    timeZone: ZONE,
    stage: underway,
    cancelled: false,
  });

  it("still speaks at 02:30, inside the hour's buffer", () => {
    expect(tripPhaseOf(at("2026-07-22T06:30:00.000Z"))).toBe("aboard");
    expect(boatStageOf(at("2026-07-22T06:30:00.000Z"))?.stage).toBe("underway");
  });

  it("is quiet at 03:00, not held to the end of Wednesday", () => {
    expect(tripPhaseOf(at("2026-07-22T07:00:00.000Z"))).toBe("back");
    expect(boatStageOf(at("2026-07-22T07:00:00.000Z"))).toBeNull();
    expect(departureStage(at("2026-07-22T07:00:00.000Z")).finished).toBe(true);
  });

  it("is never finished sooner than its untapped twin", () => {
    for (const now of [
      "2026-07-22T05:59:00.000Z",
      "2026-07-22T06:30:00.000Z",
      "2026-07-22T06:59:00.000Z",
      "2026-07-22T07:00:00.000Z",
    ]) {
      const tapped = tripPhaseOf(at(now));
      const silent = tripPhaseOf({ ...at(now), stage: null });
      if (tapped === "back") expect(silent).toBe("back");
    }
  });
});

/**
 * `trips.starts_at`/`ends_at` bound the whole run of a multi-day course. A
 * `home` tap after day one is the crew tying up for the night, not the course
 * finishing, and yesterday's word is not today's.
 */
describe("a two-day course", () => {
  // 08:00 Tue Jul 21 to 16:00 Wed Jul 22, local.
  const courseStarts = new Date("2026-07-21T12:00:00.000Z");
  const courseEnds = new Date("2026-07-22T20:00:00.000Z");
  const at = (now: string, stage: TripStage | null, recordedAt: string) => ({
    startsAt: courseStarts,
    endsAt: courseEnds,
    now: new Date(now),
    timeZone: ZONE,
    stage: stage ? { stage, recordedAt: new Date(recordedAt) } : null,
    cancelled: false,
  });
  // Home at 17:00 local on day one.
  const dayOneHome = "2026-07-21T21:00:00.000Z";

  it("is not finished by a home tap on day one", () => {
    expect(tripPhaseOf(at("2026-07-21T22:00:00.000Z", "home", dayOneHome))).toBe("aboard");
    expect(departureStage(at("2026-07-21T22:00:00.000Z", "home", dayOneHome)).finished).toBe(false);
    // Day two, mid-morning.
    expect(tripPhaseOf(at("2026-07-22T14:30:00.000Z", "home", dayOneHome))).toBe("aboard");
  });

  it("says nothing on day two about a tap from day one", () => {
    // Underway at 10:30 local on day one, read at 09:00 on day two.
    const now = "2026-07-22T13:00:00.000Z";
    expect(boatStageOf(at(now, "underway", "2026-07-21T14:30:00.000Z"))).toBeNull();
    expect(boatStageOf(at(now, "home", dayOneHome))).toBeNull();
    expect(tripPhaseOf(at(now, "underway", "2026-07-21T14:30:00.000Z"))).toBe("aboard");
  });

  it("is finished by a home tap on its last day", () => {
    const home = "2026-07-22T20:30:00.000Z";
    expect(tripPhaseOf(at("2026-07-22T20:45:00.000Z", "home", home))).toBe("back");
    expect(boatStageOf(at("2026-07-22T20:45:00.000Z", "home", home))?.stage).toBe("home");
  });
});
