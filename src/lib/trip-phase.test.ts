import { describe, expect, it } from "vitest";
import { boatStageOf, checkInOpen, departureStage, TRIP_PHASES, tripPhaseOf } from "./trip-phase";
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
 * **A departure with a diver not back aboard is not finished** (issue #2404).
 * The clock and a stale tap call a boat Back; the roll call may still hold a
 * diver the crew have not counted onto it. The page then keeps its desk and
 * does not file the boat as a record, unless the crew said Home.
 */
describe("a departure with a diver not back aboard", () => {
  // The #2409 boat: 22:00 to 02:00 local, last tap Underway at 22:10, read at 03:00.
  const nightStarts = new Date("2026-07-22T02:00:00.000Z");
  const nightEnds = new Date("2026-07-22T06:00:00.000Z");
  const underway = {
    stage: "underway" as TripStage,
    recordedAt: new Date("2026-07-22T02:10:00.000Z"),
  };
  const at = (
    now: string,
    over: Partial<Parameters<typeof departureStage>[0]> = {},
  ): Parameters<typeof departureStage>[0] => ({
    startsAt: nightStarts,
    endsAt: nightEnds,
    now: new Date(now),
    timeZone: ZONE,
    stage: underway,
    cancelled: false,
    ...over,
  });
  const THREE_AM = "2026-07-22T07:00:00.000Z";

  it("is finished at 03:00 when nobody is unaccounted for, as before", () => {
    expect(departureStage(at(THREE_AM)).finished).toBe(true);
    expect(departureStage(at(THREE_AM, { unaccountedFor: false })).finished).toBe(true);
  });

  it("is not finished at 03:00 while a diver is not back aboard", () => {
    const stage = departureStage(at(THREE_AM, { unaccountedFor: true }));
    expect(stage.finished).toBe(false);
    // Nothing else about the reading moves: the chip stays silent, the clock's phase is its own.
    expect(stage.shown).toBeNull();
    expect(tripPhaseOf(at(THREE_AM))).toBe("back");
  });

  it("stays unfinished however long the diver stays unaccounted for, with no tap at all", () => {
    for (const now of [THREE_AM, "2026-07-23T07:00:00.000Z", "2026-08-30T07:00:00.000Z"]) {
      expect(departureStage(at(now, { unaccountedFor: true, stage: null })).finished, now).toBe(
        false,
      );
    }
  });

  it("is finished once the crew say Home, whoever is unaccounted for", () => {
    const home = {
      stage: "home" as TripStage,
      recordedAt: new Date("2026-07-22T05:30:00.000Z"),
    };
    expect(departureStage(at(THREE_AM, { stage: home, unaccountedFor: true })).finished).toBe(true);
  });

  it("is not finished by a Home from an earlier day of a course, which is only the crew tying up", () => {
    const courseStarts = new Date("2026-07-21T11:00:00.000Z");
    const courseEnds = new Date("2026-07-23T16:00:00.000Z");
    const dayOneHome = {
      stage: "home" as TripStage,
      recordedAt: new Date("2026-07-21T21:00:00.000Z"),
    };
    const input = {
      startsAt: courseStarts,
      endsAt: courseEnds,
      now: new Date("2026-07-25T12:00:00.000Z"),
      timeZone: ZONE,
      stage: dayOneHome,
      cancelled: false,
      unaccountedFor: true,
    };
    expect(departureStage(input).finished).toBe(false);
  });

  it("is never made finished by it, and a boat that is not Back is unchanged", () => {
    expect(departureStage(at("2026-07-22T06:30:00.000Z", { unaccountedFor: true })).finished).toBe(
      false,
    );
    expect(departureStage(at("2026-07-22T06:30:00.000Z")).finished).toBe(false);
  });

  it("has no finish to hold back on a canceled departure", () => {
    expect(departureStage(at(THREE_AM, { cancelled: true, unaccountedFor: true }))).toEqual({
      shown: null,
      finished: false,
      checkInOpen: false,
    });
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
 * **A multi-day run whose nightly window crosses midnight** (issue #2406): 22:00
 * to 02:00 local for three nights. `trips.starts_at`/`ends_at` bound the whole
 * run, and `trip_schedule_days` holds the three real windows.
 */
describe("a three-night 22:00 to 02:00 run", () => {
  // EDT is UTC-4: night one is Jul 21 22:00 to Jul 22 02:00 local.
  const night = (n: number) => ({
    startsAt: new Date(Date.UTC(2026, 6, 21 + n, 2, 0)),
    endsAt: new Date(Date.UTC(2026, 6, 21 + n, 6, 0)),
  });
  const windows = [night(1), night(2), night(3)];
  const run = {
    startsAt: windows[0].startsAt,
    endsAt: windows[2].endsAt,
    timeZone: ZONE,
    cancelled: false,
  };
  const boardingNightOne: { stage: TripStage; recordedAt: Date } = {
    stage: "boarding" as const,
    recordedAt: new Date("2026-07-22T03:30:00.000Z"),
  };
  const read = (now: string, stage: typeof boardingNightOne | null, withWindows = true) =>
    boatStageOf({
      ...run,
      now: new Date(now),
      stage,
      meetingWindows: withWindows ? windows : undefined,
    });

  it("still speaks a night's Boarding tap at 01:00, after local midnight", () => {
    expect(read("2026-07-22T05:00:00.000Z", boardingNightOne)?.stage).toBe("boarding");
  });

  it("lets the word go once its own window is over", () => {
    expect(read("2026-07-22T06:30:00.000Z", boardingNightOne)).toBeNull();
  });

  it("keeps the shop-day rule when no windows are on file", () => {
    expect(read("2026-07-22T05:00:00.000Z", boardingNightOne, false)).toBeNull();
  });

  it("keeps the phase Aboard through the window, and a night-three word speaks past midnight", () => {
    const nightThree = {
      stage: "underway" as const,
      recordedAt: new Date("2026-07-24T03:30:00.000Z"),
    };
    expect(read("2026-07-24T05:00:00.000Z", nightThree)?.stage).toBe("underway");
    expect(
      tripPhaseOf({
        ...run,
        now: new Date("2026-07-24T05:00:00.000Z"),
        stage: nightThree,
        meetingWindows: windows,
      }),
    ).toBe("aboard");
  });

  it("finishes the run on a Home tap in the last window, before midnight", () => {
    const home = { stage: "home" as const, recordedAt: new Date("2026-07-24T03:30:00.000Z") };
    expect(
      tripPhaseOf({
        ...run,
        now: new Date("2026-07-24T03:45:00.000Z"),
        stage: home,
        meetingWindows: windows,
      }),
    ).toBe("back");
  });

  it("does not finish the run on a night-one Home tap", () => {
    const home = { stage: "home" as const, recordedAt: new Date("2026-07-22T05:30:00.000Z") };
    expect(
      tripPhaseOf({
        ...run,
        now: new Date("2026-07-22T05:45:00.000Z"),
        stage: home,
        meetingWindows: windows,
      }),
    ).toBe("aboard");
  });

  it("reads a single sailing exactly as before, windows or not", () => {
    const one = {
      startsAt,
      endsAt,
      now: new Date("2026-07-21T15:00:00.000Z"),
      timeZone: ZONE,
      cancelled: false,
    };
    const tap = { stage: "underway" as const, recordedAt: new Date("2026-07-21T14:30:00.000Z") };
    expect(boatStageOf({ ...one, stage: tap, meetingWindows: [{ startsAt, endsAt }] })).toBe(tap);
    expect(boatStageOf({ ...one, stage: tap })).toBe(tap);
  });
});
