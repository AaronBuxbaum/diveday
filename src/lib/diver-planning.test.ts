import { describe, expect, it } from "vitest";
import {
  conditionsChangedSinceBooking,
  DEFAULT_DOCK_DAY_RHYTHM,
  type DockDayRhythm,
  dockDayOffsets,
  dockDayTimeline,
  exposureSuitFor,
  packingConfidence,
  parseDockDayRhythm,
  siteFit,
} from "./diver-planning";

const rhythm = (overrides: Partial<DockDayRhythm> = {}): DockDayRhythm => ({
  ...DEFAULT_DOCK_DAY_RHYTHM,
  ...overrides,
});

/** `step` alone loses the difference between Dive 1 and Dive 2 — keep both. */
const beats = (entries: Array<{ step: string; number?: number }>) =>
  entries.map(({ step, number }) => (number === undefined ? step : `${step}${number}`));

describe("dock-day rhythm", () => {
  const start = new Date("2026-07-18T12:00:00Z");
  const end = new Date("2026-07-18T17:00:00Z");

  it("gives dock times relative to the trip start", () => {
    expect(dockDayTimeline(start, rhythm())[0]?.at.toISOString()).toBe("2026-07-18T11:30:00.000Z");
  });

  it("uses the shop's dock call time for the arrival step", () => {
    const timeline = dockDayTimeline(start, rhythm({ dockCallMinutes: 45 }));
    expect(timeline[0]?.at.toISOString()).toBe("2026-07-18T11:15:00.000Z");
  });

  it("never lets a dock beat land before the diver was asked to arrive", () => {
    // A 10-minute call with a 30-minute briefing is a shop typing a day that
    // doesn't fit; the briefing clamps onto the arrival rather than preceding it.
    const short = dockDayTimeline(start, rhythm({ dockCallMinutes: 10, briefingMinutes: 30 }));
    expect(short[0]?.step).toBe("arrive");
    expect(short[1]?.step).toBe("briefing");
    expect(short[1]?.at.getTime()).toBeGreaterThanOrEqual(short[0]?.at.getTime() ?? 0);
  });

  it("lays the water half out from the shop's own durations, in order", () => {
    const timeline = dockDayTimeline(start, rhythm(), end, 2);
    expect(beats(timeline)).toEqual([
      "arrive",
      "briefing",
      "departure",
      // Numbered by the dive it delivers to, now that a departure has one run
      // per leg rather than a single ride out.
      "boatRide1",
      "dive1",
      "surfaceInterval1",
      "dive2",
      "return",
    ]);
    // 20 min out, 45 min under, 60 min on the surface: dive two starts at 2:05.
    expect(timeline[6]?.at.toISOString()).toBe("2026-07-18T14:05:00.000Z");
    expect(timeline.at(-1)?.at).toEqual(end);
  });

  it("gives a one-dive trip no surface interval", () => {
    const timeline = dockDayTimeline(start, rhythm(), end, 1);
    expect(beats(timeline)).not.toContain("surfaceInterval1");
    expect(beats(timeline)).toContain("dive1");
  });

  it("drops the beats a shop turned off rather than stacking them on departure", () => {
    // Briefs on the boat, kits up on board, walks in off the beach.
    const shore = dockDayTimeline(
      start,
      rhythm({ briefingMinutes: 0, gearSetupMinutes: 0, boatRideMinutes: 0 }),
      end,
      2,
    );
    expect(beats(shore)).toEqual([
      "arrive",
      "departure",
      "dive1",
      "surfaceInterval1",
      "dive2",
      "return",
    ]);
    // Dive one starts the moment they go in, not at some fabricated third.
    expect(shore[2]?.at).toEqual(start);
  });

  it("shows a set-up beat when the shop kits up at the dock", () => {
    const timeline = dockDayTimeline(start, rhythm({ gearSetupMinutes: 25 }));
    expect(beats(timeline)).toEqual(["arrive", "gearSetup", "briefing", "departure"]);
  });

  it("never prints a beat the published return time has already passed", () => {
    // A fourth dive does not fit a five-hour window at this shop's numbers; the
    // return the shop sold wins, and the page does not argue with itself.
    const timeline = dockDayTimeline(start, rhythm(), end, 4);
    expect(beats(timeline)).toContain("dive3");
    expect(beats(timeline)).not.toContain("dive4");
    // ...and the surface interval that was leading into dive four goes with it,
    // rather than sitting at the end of the day with nothing after it.
    expect(beats(timeline).at(-2)).toBe("dive3");
    expect(timeline.every(({ at }) => at <= end)).toBe(true);
    expect(timeline.at(-1)?.at).toEqual(end);
  });

  it("renders only the dock beats when there is no return to bound the day", () => {
    expect(beats(dockDayTimeline(start, rhythm()))).toEqual(["arrive", "briefing", "departure"]);
  });

  it("previews the same shape Settings shows, without inventing a return", () => {
    const preview = dockDayOffsets(rhythm(), 2);
    expect(preview[0]).toEqual({ step: "arrive", minutesFromDeparture: -30 });
    expect(beats(preview)).not.toContain("return");
  });
});

describe("a day that never leaves the shore", () => {
  const start = new Date("2026-07-18T12:00:00Z");
  const end = new Date("2026-07-18T17:00:00Z");

  it("drops the ride out, because a shore diver walks to the water", () => {
    const afloat = beats(dockDayOffsets(rhythm(), 2, undefined, undefined, "boat"));
    const ashore = beats(dockDayOffsets(rhythm(), 2, undefined, undefined, "shore"));
    expect(afloat).toContain("boatRide1");
    expect(ashore).not.toContain("boatRide1");
    // Everything else survives: the same arrival, briefing and two dives.
    expect(ashore).toEqual([
      "arrive",
      "briefing",
      "departure",
      "dive1",
      "surfaceInterval1",
      "dive2",
    ]);
  });

  it("never names a ride between dives either, however long the shop's leg is", () => {
    // A 90-minute leg beats the 60-minute interval and would take the window's
    // name on a boat. On a beach there is no leg to take it.
    // Zero-indexed by leg: entry 1 is the run before dive 2.
    const legs = [20, 90];
    const afloat = beats(dockDayOffsets(rhythm(), 2, undefined, legs, "boat"));
    const ashore = beats(dockDayOffsets(rhythm(), 2, undefined, legs, "shore"));
    expect(afloat).toContain("boatRide2");
    expect(ashore).not.toContain("boatRide2");
    expect(ashore).toContain("surfaceInterval1");
  });

  it("treats a pool session the same way", () => {
    const pool = beats(dockDayOffsets(rhythm(), 1, undefined, undefined, "pool"));
    expect(pool.some((beat) => beat.startsWith("boatRide"))).toBe(false);
  });

  it("still bounds the water half at the published return", () => {
    // The truncation rule is about the trip's own window, not about the hull —
    // a shore day that overruns its stated return must still stop at it.
    const tight = dockDayTimeline(
      start,
      rhythm({ bottomTimeMinutes: 200 }),
      end,
      3,
      undefined,
      undefined,
      "shore",
    );
    expect(tight.every((entry) => entry.at <= end)).toBe(true);
    expect(beats(tight)).not.toContain("dive3");
  });

  it("defaults to a boat when nobody says otherwise", () => {
    // Every existing call site and every trip row predates this argument, and
    // `trips.dive_mode` defaults to boat — so the omitted case must not change.
    expect(beats(dockDayOffsets(rhythm(), 2))).toEqual(
      beats(dockDayOffsets(rhythm(), 2, undefined, undefined, "boat")),
    );
  });
});

describe("parsing a submitted rhythm", () => {
  const complete = {
    dockCallMinutes: "30",
    gearSetupMinutes: "0",
    briefingMinutes: "15",
    boatRideMinutes: "20",
    bottomTimeMinutes: "45",
    surfaceIntervalMinutes: "60",
  };

  it("accepts a complete, in-range submission", () => {
    expect(parseDockDayRhythm(complete)).toEqual(DEFAULT_DOCK_DAY_RHYTHM);
  });

  it("refuses the whole save rather than clamping one bad field", () => {
    expect(parseDockDayRhythm({ ...complete, bottomTimeMinutes: "0" })).toBeNull();
    expect(parseDockDayRhythm({ ...complete, dockCallMinutes: "1000" })).toBeNull();
    expect(parseDockDayRhythm({ ...complete, briefingMinutes: "12.5" })).toBeNull();
    expect(parseDockDayRhythm({ ...complete, boatRideMinutes: "-5" })).toBeNull();
  });

  it("refuses a partial post, since the beats are validated against each other", () => {
    expect(parseDockDayRhythm({ dockCallMinutes: "30" })).toBeNull();
  });
});

describe("a dive site's own time in the water", () => {
  const start = new Date("2026-07-18T12:00:00Z");
  const end = new Date("2026-07-18T18:00:00Z");

  // The reason this exists: a two-tank morning routinely visits a wall the
  // shop runs at 30 minutes and a shallow reef it runs at 60, and one
  // shop-wide number told the diver the wrong time on whichever it was not.
  it("counts each dive at its own site's minutes", () => {
    const timeline = dockDayTimeline(start, rhythm(), end, 2, [30, 60]);
    const dive2 = timeline.find((beat) => beat.step === "dive" && beat.number === 2);
    // Departure + 20 boat ride + 30 (this site) + 60 surface interval.
    expect(dive2?.at.toISOString()).toBe("2026-07-18T13:50:00.000Z");
  });

  it("falls back to the shop's figure for a dive whose site names none", () => {
    const withOverride = dockDayTimeline(start, rhythm(), end, 2, [null, 60]);
    const shopOnly = dockDayTimeline(start, rhythm(), end, 2);
    const at = (entries: ReturnType<typeof dockDayTimeline>) =>
      entries.find((beat) => beat.step === "dive" && beat.number === 2)?.at.toISOString();
    // Dive 1 named nothing, so dive 2 starts exactly where it always did.
    expect(at(withOverride)).toBe(at(shopOnly));
  });

  // Absent, short, and zero-ish lists all mean "nothing to say about this
  // dive" rather than "a dive of no length".
  it("ignores a list that runs out, and a nonsense figure inside it", () => {
    const short = dockDayTimeline(start, rhythm(), end, 2, [30]);
    const zero = dockDayTimeline(start, rhythm(), end, 2, [30, 0]);
    expect(beats(short)).toEqual(beats(zero));
    const dive2 = short.find((beat) => beat.step === "dive" && beat.number === 2);
    expect(dive2?.at.toISOString()).toBe("2026-07-18T13:50:00.000Z");
  });

  it("shows through to the preview Settings renders, not only to a departure", () => {
    const offsets = dockDayOffsets(rhythm(), 2, [30, 60]);
    const dive2 = offsets.find((beat) => beat.step === "dive" && beat.number === 2);
    expect(dive2?.minutesFromDeparture).toBe(20 + 30 + 60);
  });
});

/**
 * The reason this exists: a departure is dock -> A -> B -> dock, and the legs
 * are order-dependent — A->B is not B->A when the sites sit on different parts
 * of the reef line. One number per trip could only be wrong in a way that
 * varied per departure (ADR 20260815-per-leg-travel-minutes).
 */
describe("a departure's own legs", () => {
  const start = new Date("2026-07-18T12:00:00Z");
  const end = new Date("2026-07-18T20:00:00Z");
  const diveAt = (entries: ReturnType<typeof dockDayTimeline>, number: number) =>
    entries.find((beat) => beat.step === "dive" && beat.number === number)?.at.toISOString();

  it("rides out on the trip's own first leg rather than the shop's usual one", () => {
    // Ten minutes to the house reef, not the shop's habitual twenty.
    const timeline = dockDayTimeline(start, rhythm(), end, 2, undefined, [10]);
    expect(diveAt(timeline, 1)).toBe("2026-07-18T12:10:00.000Z");
  });

  it("leaves a leg the trip says nothing about on the shop's own figure", () => {
    // The whole no-regression promise: a departure that states one leg must not
    // read worse than one that states none.
    const partial = dockDayTimeline(start, rhythm(), end, 2, undefined, [10, null]);
    const empty = dockDayTimeline(start, rhythm(), end, 2);
    expect(beats(partial)).toEqual(beats(empty));
    // Only the leg that was stated moved: dive 2 is still 45 under + 60 up.
    expect(diveAt(partial, 2)).toBe("2026-07-18T13:55:00.000Z");
    expect(diveAt(empty, 2)).toBe("2026-07-18T14:05:00.000Z");
  });

  it("changes nothing at all for a shop that has filled nothing in", () => {
    const before = dockDayTimeline(start, rhythm(), end, 3);
    const after = dockDayTimeline(start, rhythm(), end, 3, undefined, [null, undefined]);
    expect(after).toEqual(before);
  });

  it("runs to the next site inside the surface interval it fits in", () => {
    // Twenty-five minutes across the reef, under a sixty-minute interval: the
    // boat moves while the divers sit it out, so the day does not grow.
    const timeline = dockDayTimeline(start, rhythm(), end, 2, undefined, [20, 25]);
    expect(diveAt(timeline, 2)).toBe(diveAt(dockDayTimeline(start, rhythm(), end, 2), 2));
    expect(beats(timeline)).toContain("surfaceInterval1");
  });

  it("lets a run longer than the interval push the next dive out, and name itself", () => {
    // Ninety minutes out to the wall under a sixty-minute interval: the run is
    // the dominant fact about that window, so it is what the diver reads.
    const timeline = dockDayTimeline(start, rhythm(), end, 2, undefined, [20, 90]);
    expect(beats(timeline)).toEqual([
      "arrive",
      "briefing",
      "departure",
      "boatRide1",
      "dive1",
      "boatRide2",
      "dive2",
      "return",
    ]);
    // 20 out + 45 under + 90 across, rather than the 60 it would have been.
    expect(diveAt(timeline, 2)).toBe("2026-07-18T14:35:00.000Z");
  });

  it("honours a stated zero, which a bottom time deliberately does not", () => {
    // Same site twice, or a walk-in entry: `0` is an answer here, so the ride
    // out drops rather than falling back to the shop's twenty minutes.
    const timeline = dockDayTimeline(start, rhythm(), end, 2, undefined, [0]);
    expect(beats(timeline)).not.toContain("boatRide1");
    expect(diveAt(timeline, 1)).toBe(start.toISOString());
  });

  it("ignores a nonsense leg rather than laying out a negative run", () => {
    const nonsense = dockDayTimeline(start, rhythm(), end, 2, undefined, [-5, 12.5]);
    expect(nonsense).toEqual(dockDayTimeline(start, rhythm(), end, 2));
  });

  it("still lets the published return time truncate a day the legs made too long", () => {
    // Two hours out and two hours back across is a day this window cannot hold.
    const short = new Date("2026-07-18T15:00:00Z");
    const timeline = dockDayTimeline(start, rhythm(), short, 2, undefined, [120, 120]);
    // The second run is walked back off the tail with the dive it existed for,
    // rather than sitting at the end as a boat that set off and gave up.
    expect(beats(timeline)).toEqual([
      "arrive",
      "briefing",
      "departure",
      "boatRide1",
      "dive1",
      "return",
    ]);
    expect(timeline.every(({ at }) => at <= short)).toBe(true);
  });
});

describe("booking delight planning", () => {
  it("explains site fit from evidence without turning it into a gate", () => {
    expect(
      siteFit({
        difficultyLevel: "advanced",
        depthRange: "25–30 m",
        currentNote: "strong current",
      }).tone,
    ).toBe("demanding");
    expect(
      siteFit({ difficultyLevel: "beginner", depthRange: "8–12 m", currentNote: "gentle" }).tone,
    ).toBe("welcoming");
    // No published facts at all is its own answer, never a guess either way.
    expect(siteFit({ difficultyLevel: null, depthRange: null, currentNote: null }).tone).toBe(
      "unknown",
    );
  });

  it("takes the shop's chosen difficulty over what the free text hints", () => {
    // The regression the code half of this change exists for: the sniff reads
    // text the shop wrote for another purpose, and a gentle reef whose current
    // note mentions a deep channel used to read as demanding with nothing able
    // to take it back. A chosen level now settles it.
    expect(
      siteFit({
        difficultyLevel: "beginner",
        depthRange: "8–12 m",
        currentNote: "watch the deep channel on the swim back",
      }).tone,
    ).toBe("welcoming");
    // …and with no level chosen, the sniff still has the last word.
    expect(
      siteFit({
        difficultyLevel: null,
        depthRange: "8–12 m",
        currentNote: "watch the deep channel on the swim back",
      }).tone,
    ).toBe("demanding");
  });

  it("separates what a diver brings from requested rental gear", () => {
    const plan = packingConfidence(["Swimsuit", "Certification card"], {
      rentsBcd: true,
      rentsWetsuit: false,
    });
    expect(plan.bring).toContain("Swimsuit");
    expect(plan.rented).toEqual(["bcd"]);
  });

  it("rents nothing off a row that only carries the diver's note", () => {
    // `rental_fit_profiles` gained a second writer in issue 627 — the note,
    // saved on its own. Every `rents_*` column defaults to true, so a diver who
    // typed one sentence and never opened the gear form would otherwise be told
    // the shop has a full kit waiting for them.
    const plan = packingConfidence(["Swimsuit"], {
      rentsBcd: true,
      rentsWetsuit: true,
      fitStatedAt: null,
    });
    expect(plan.rented).toEqual([]);
    expect(plan.bring).toContain("Swimsuit");
  });

  it("still rents off a fit built without the marker, so no real diver is dropped", () => {
    expect(packingConfidence([], { rentsBcd: true }).rented).toEqual(["bcd"]);
  });

  it("gives every diver the same fixed provided-item codes", () => {
    expect(packingConfidence([], null).provided).toEqual(["tanksAndWeights", "crewBriefing"]);
  });

  it("stops promising a briefing to a shop that doesn't run one", () => {
    expect(packingConfidence([], null, false).provided).toEqual(["tanksAndWeights"]);
  });

  it("turns a water temperature into the suit most divers want", () => {
    // A reading is a number a diver has to translate; this is the
    // translation. Bands are the ordinary recreational rule of thumb, read
    // warmest-first so a reading takes the first band it clears.
    expect(exposureSuitFor(30)).toBe("swimwear");
    expect(exposureSuitFor(29)).toBe("swimwear");
    expect(exposureSuitFor(28)).toBe("shorty");
    expect(exposureSuitFor(25)).toBe("shorty");
    expect(exposureSuitFor(24)).toBe("wetsuit5mm");
    expect(exposureSuitFor(21)).toBe("wetsuit5mm");
    expect(exposureSuitFor(20)).toBe("wetsuit7mm");
    expect(exposureSuitFor(17)).toBe("wetsuit7mm");
    expect(exposureSuitFor(16)).toBe("drysuit");
  });

  it("answers for water no recreational diver would call ordinary", () => {
    // The entry form accepts -2°C to 40°C (src/lib/temperature-units.ts), so
    // both ends have to land somewhere rather than fall off the table.
    expect(exposureSuitFor(-2)).toBe("drysuit");
    expect(exposureSuitFor(40)).toBe("swimwear");
  });

  it("only calls a newer crew briefing a change", () => {
    const booked = new Date("2026-07-18T10:00:00Z");
    expect(conditionsChangedSinceBooking(new Date("2026-07-18T11:00:00Z"), booked)).toBe(true);
    expect(conditionsChangedSinceBooking(booked, booked)).toBe(false);
  });
});
