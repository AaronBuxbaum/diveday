import { describe, expect, it } from "vitest";
import {
  boatStageOf,
  checkInOpen,
  departureSailed,
  departureStage,
  leftAboardOpen,
  TRIP_PHASES,
  tripPhaseOf,
} from "./trip-phase";
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
    expect(at("2026-07-21T22:00:00.000Z", null)).toMatchObject({ shown: null, finished: true });
    expect(at("2026-07-21T10:00:00.000Z", null)).toMatchObject({ shown: null, finished: false });
  });

  it("says check-in is open from the same reading", () => {
    expect(at("2026-07-21T10:30:00.000Z", null).checkInOpen).toBe(true);
    expect(at("2026-07-21T22:00:00.000Z", null).checkInOpen).toBe(false);
  });
});

describe("checkInOpen", () => {
  const open = (now: string, stage: TripStage | null = null, cancelled = false) =>
    checkInOpen({
      startsAt,
      endsAt,
      now: new Date(now),
      timeZone: ZONE,
      // A tap on the departure's own day, before it sails.
      stage: stage ? { stage, recordedAt: new Date("2026-07-21T10:40:00.000Z") } : null,
      cancelled,
    });

  it("is open on the departure's own day until it sails", () => {
    expect(open("2026-07-21T10:42:00.000Z")).toBe(true); // 6:42 AM, 18 minutes out
    expect(open("2026-07-21T04:30:00.000Z")).toBe(true); // 12:30 AM the same day
  });

  it("is not open the day before, once it has sailed, or on a cancelled departure", () => {
    expect(open("2026-07-21T03:00:00.000Z")).toBe(false); // 11:00 PM the night before
    expect(open("2026-07-21T11:05:00.000Z")).toBe(false);
    expect(open("2026-07-21T10:42:00.000Z", null, true)).toBe(false);
  });

  it("goes silent once the crew have said where the boat is", () => {
    expect(open("2026-07-21T10:42:00.000Z", "boarding")).toBe(false);
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

  // The crew's word beats the clock: a boat that says "Heading in" at 02:40,
  // after its scheduled return, is still at sea at 03:00 (domain review of
  // #2409). Its word holds to the end of the day it was said on.
  const lateHeadingIn = {
    stage: "heading_in" as TripStage,
    recordedAt: new Date("2026-07-22T06:40:00.000Z"),
  };
  const lateAt = (now: string) => ({ ...at(now), stage: lateHeadingIn });

  it("a word said after the scheduled return still speaks at 03:00", () => {
    expect(tripPhaseOf(lateAt("2026-07-22T07:00:00.000Z"))).toBe("aboard");
    expect(boatStageOf(lateAt("2026-07-22T07:00:00.000Z"))?.stage).toBe("heading_in");
    expect(departureStage(lateAt("2026-07-22T07:00:00.000Z")).finished).toBe(false);
  });

  it("a word said after the scheduled return holds to the end of the day it was said", () => {
    // 23:59 Wed local still speaks; 00:00 Thu does not.
    expect(tripPhaseOf(lateAt("2026-07-23T03:59:00.000Z"))).toBe("aboard");
    expect(tripPhaseOf(lateAt("2026-07-23T04:00:00.000Z"))).toBe("back");
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

/**
 * **A boat at sea reads as at sea** (fourth review, item 16). The seats chip
 * and the dock's prep prompts stop once the boat has left, and "Left aboard"
 * waits for "Heading in".
 */
describe("departureSailed and leftAboardOpen", () => {
  const reading = (
    now: string,
    stage: TripStage | null,
    recordedAt = "2026-07-21T14:30:00.000Z",
    bounds = { startsAt, endsAt },
  ) => ({
    ...bounds,
    now: new Date(now),
    timeZone: ZONE,
    stage: stage ? { stage, recordedAt: new Date(recordedAt) } : null,
    cancelled: false,
  });
  // 09:00 local, two hours into the 07:00 boat.
  const atSea = "2026-07-21T13:00:00.000Z";

  it("is at the dock before the hour, and while the crew says boarding inside the buffer", () => {
    expect(departureSailed(reading("2026-07-21T10:00:00.000Z", null))).toBe(false);
    // Twenty minutes past the hour with no word: a boat running late is still
    // at the dock until the departure buffer says otherwise.
    expect(departureSailed(reading("2026-07-21T11:20:00.000Z", null))).toBe(false);
    expect(
      departureSailed(reading("2026-07-21T11:40:00.000Z", "boarding", "2026-07-21T10:50:00.000Z")),
    ).toBe(false);
  });

  it("lets a Boarding nobody followed up yield to the clock, as silence does (review F3)", () => {
    // The tap a busy dock makes is Boarding; the one it forgets is Underway.
    // A tap never holds a boat at the dock longer than silence would.
    expect(departureSailed(reading(atSea, "boarding", "2026-07-21T10:50:00.000Z"))).toBe(true);
    expect(departureStage(reading(atSea, "boarding", "2026-07-21T10:50:00.000Z")).sailed).toBe(
      true,
    );
    // A course's Boarding never does: its later days still need their kit.
    const course = {
      startsAt: new Date("2026-07-21T12:00:00.000Z"),
      endsAt: new Date("2026-07-22T20:00:00.000Z"),
    };
    expect(
      departureSailed(
        reading("2026-07-21T15:00:00.000Z", "boarding", "2026-07-21T11:50:00.000Z", course),
      ),
    ).toBe(false);
  });

  it("has sailed once the crew says so, or the clock passes a single sailing's hour", () => {
    for (const stage of ["underway", "surface", "heading_in"] as const) {
      expect(departureSailed(reading(atSea, stage, "2026-07-21T12:50:00.000Z")), stage).toBe(true);
    }
    expect(departureSailed(reading(atSea, null))).toBe(true);
    expect(departureStage(reading(atSea, null)).sailed).toBe(true);
  });

  it("has sailed once it is back", () => {
    expect(departureSailed(reading("2026-07-21T22:00:00.000Z", null))).toBe(true);
    expect(departureSailed(reading("2026-07-21T15:00:00.000Z", "home"))).toBe(true);
  });

  it("never sails a cancelled departure", () => {
    expect(departureSailed({ ...reading(atSea, "underway"), cancelled: true })).toBe(false);
  });

  it("keeps a course's later days to pack for: no clock, and a night's home is tied up", () => {
    const course = {
      startsAt: new Date("2026-07-21T12:00:00.000Z"),
      endsAt: new Date("2026-07-22T20:00:00.000Z"),
    };
    // Day two, 08:00 local, nothing tapped yet today.
    expect(departureSailed(reading("2026-07-22T12:00:00.000Z", null, undefined, course))).toBe(
      false,
    );
    // Day one, 18:00 local, home said at 17:00.
    expect(
      departureSailed(
        reading("2026-07-21T22:00:00.000Z", "home", "2026-07-21T21:00:00.000Z", course),
      ),
    ).toBe(false);
  });

  it("opens Left aboard from heading in, and on a departure that is back", () => {
    expect(leftAboardOpen(reading(atSea, "underway", "2026-07-21T12:50:00.000Z"))).toBe(false);
    expect(leftAboardOpen(reading(atSea, "surface", "2026-07-21T12:50:00.000Z"))).toBe(false);
    expect(leftAboardOpen(reading(atSea, null))).toBe(false);
    expect(leftAboardOpen(reading(atSea, "heading_in", "2026-07-21T12:50:00.000Z"))).toBe(true);
    expect(leftAboardOpen(reading("2026-07-21T15:00:00.000Z", "home"))).toBe(true);
    expect(leftAboardOpen(reading("2026-07-21T22:00:00.000Z", null))).toBe(true);
  });
});
