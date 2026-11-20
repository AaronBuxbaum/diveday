import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { RollCallRecord } from "@/lib/manifests";
import { loggableDives } from "./phases/water-reading";
import type { TripSentence } from "./trip-sentence";
import { waterPersonStatus, waterSentence } from "./water-copy";
import { type WaterCount, type WaterStandingInput, waterStanding } from "./water-standing";

/**
 * **On the water says only what the crew recorded** (ADR
 * 20261117-trip-page-clock). Each case is a state a dock operator reads the
 * page in: nothing recorded, the dock count only, a dive count with people
 * outstanding, everyone back, an open missing-diver alert, and a cancelled
 * trip. The failure paths matter most: a person is never "back" without a
 * count saying so, and never "missing" without one either.
 */

const t = staffTranslator("en-US");
const ZONE = "America/New_York";
const at = (time: string) => new Date(`2026-11-16T${time}:00.000-05:00`);
const FALLBACK: TripSentence = {
  headline: "Scheduled to leave at 9:00 AM.",
  emphasis: null,
  sub: "Scheduled back at 12:30 PM.",
};

function said(
  state: "boarded" | "not_boarded",
  time: string,
  extra: Partial<RollCallRecord> = {},
): RollCallRecord {
  return { state, occurredAt: at(time), recordedByName: "Keiko Tanaka", ...extra };
}

type Results = Record<string, RollCallRecord | undefined>;

/** Two guests and one crew member, with results per checkpoint. */
function counts(
  byCheckpoint: Partial<Record<"departure" | "after_dive_1" | "after_dive_2", Results>>,
  complete: Partial<Record<string, boolean>> = {},
): WaterCount[] {
  return (["departure", "after_dive_1", "after_dive_2"] as const).map((checkpoint) => {
    const results = byCheckpoint[checkpoint] ?? {};
    return {
      checkpoint,
      divers: [
        {
          bookingId: "b-tom",
          personId: "p-tom",
          fullName: "Tom Okafor",
          rollCall: results.tom,
          buddyTeam: { others: [{ fullName: "Lena Fischer" }] },
        },
        {
          bookingId: "b-lena",
          personId: "p-lena",
          fullName: "Lena Fischer",
          rollCall: results.lena,
        },
      ],
      crew: [{ id: "p-sal", fullName: "Sal Reyes", rollCall: results.sal }],
      completeness: { complete: complete[checkpoint] ?? false },
    };
  });
}

function read(over: Partial<WaterStandingInput> = {}, cancelled = false) {
  const standing = waterStanding({
    counts: counts({}),
    alerted: new Set(),
    plannedDives: [
      { diveNumber: 1, site: "Molasses Reef" },
      { diveNumber: 2, site: "French Reef" },
    ],
    logged: new Map(),
    stage: null,
    homeSaidAt: null,
    endsAt: at("12:30"),
    boatChecks: null,
    ...over,
  });
  const sentence = waterSentence(
    standing,
    FALLBACK,
    { locale: "en-US", timeZone: ZONE, cancelled },
    t,
  );
  const plain = (text: string | null) => text?.replace(/\s/gu, " ") ?? null;
  return {
    standing,
    headline: plain(sentence.headline),
    emphasis: sentence.emphasis,
    sub: plain(sentence.sub),
  };
}

const dockDone = {
  departure: {
    tom: said("boarded", "08:50"),
    lena: said("boarded", "08:51"),
    sal: said("boarded", "08:52"),
  },
};

describe("the sentence On the water", () => {
  it("says what the schedule says when nothing is recorded", () => {
    const { headline, standing } = read();
    expect(headline).toBe(FALLBACK.headline);
    expect(standing.latest).toBeNull();
    expect(standing.notYetBack).toEqual([]);
    expect(standing.timeline.map((stop) => stop.state)).toEqual([
      "ahead",
      "ahead",
      "ahead",
      "ahead",
    ]);
  });

  it("says the dock count, and claims nobody is in the water from it", () => {
    const { headline, sub, standing } = read({
      counts: counts(dockDone, { departure: true }),
    });
    expect(headline).toBe("3 people counted aboard at the dock.");
    expect(sub).toBe("Counted by Keiko Tanaka, 8:52 AM · Scheduled back at 12:30 PM.");
    // Nobody is outstanding before an after-dive count has said anything.
    expect(standing.notYetBack).toEqual([]);
  });

  it("says a dock count that is not finished as a fraction, never as a missing person", () => {
    const { headline, standing } = read({
      counts: counts({ departure: { tom: said("boarded", "08:50") } }),
    });
    expect(headline).toBe("Roll call at the dock: 1 of 3 recorded aboard.");
    expect(standing.notYetBack).toEqual([]);
  });

  it("names who an after-dive count has not recorded back yet", () => {
    const { headline, emphasis, sub, standing } = read({
      counts: counts(
        {
          ...dockDone,
          after_dive_1: { lena: said("boarded", "10:38"), sal: said("boarded", "10:39") },
        },
        { departure: true },
      ),
    });
    expect(headline).toBe("1 person is not yet recorded back after dive 1.");
    expect(emphasis).toBe("1 person");
    expect(sub).toBe("2 of 3 recorded back aboard · Counted by Keiko Tanaka, 10:39 AM");
    expect(standing.notYetBack).toEqual([
      expect.objectContaining({
        name: "Tom Okafor",
        status: "unrecorded",
        buddies: ["Lena Fischer"],
        crew: false,
      }),
    ]);
  });

  it("leads with who a count recorded not back aboard, and keeps it until a later count says otherwise", () => {
    const { headline, standing } = read({
      counts: counts(
        {
          ...dockDone,
          after_dive_1: {
            tom: said("not_boarded", "10:38", { note: "Surfaced north of the mooring" }),
            lena: said("boarded", "10:38"),
            sal: said("boarded", "10:39"),
          },
          // Dive 2's count has begun without Tom: his "not back" still stands.
          after_dive_2: { lena: said("boarded", "12:01") },
        },
        { departure: true },
      ),
    });
    expect(headline).toBe("1 person is recorded not back aboard after dive 1.");
    expect(standing.notYetBack[0]).toMatchObject({
      name: "Tom Okafor",
      status: "notBack",
      afterDive: 1,
      note: "Surfaced north of the mooring",
    });
    // Sal has no result at dive 2 yet: listed, after Tom.
    expect(standing.notYetBack.map((person) => [person.name, person.status])).toEqual([
      ["Tom Okafor", "notBack"],
      ["Sal Reyes", "unrecorded"],
    ]);
    expect(waterPersonStatus(standing.notYetBack[0], t)).toBe(
      "Recorded not back aboard after dive 1",
    );
  });

  it("says everyone is recorded back only when the count has every person aboard", () => {
    const { headline, standing } = read({
      counts: counts(
        {
          ...dockDone,
          after_dive_1: {
            tom: said("boarded", "10:40"),
            lena: said("boarded", "10:41"),
            sal: said("boarded", "10:42"),
          },
        },
        { departure: true, after_dive_1: true },
      ),
    });
    expect(headline).toBe("Everyone is recorded back aboard after dive 1.");
    expect(standing.notYetBack).toEqual([]);
    // Who the latest count has aboard, for Wrapped up's close-out when a later
    // count is never finished.
    expect(standing.lastAboard).toEqual(["Tom Okafor", "Lena Fischer", "Sal Reyes"]);
  });

  it("never says everyone is back while the roll call keeps the count open", () => {
    // Every guest tapped back aboard, no crew on the roster: the roll call keeps
    // the count open (`completeness`), so the sentence says what was recorded.
    const noCrew = counts(
      {
        ...dockDone,
        after_dive_2: { tom: said("boarded", "11:40"), lena: said("boarded", "11:41") },
      },
      { departure: true, after_dive_2: false },
    ).map((count) => ({ ...count, crew: [] }));
    const { headline, standing } = read({ counts: noCrew });
    expect(standing.notYetBack).toEqual([]);
    expect(headline).not.toMatch(/Everyone/);
    expect(headline).toBe("2 people recorded back aboard after dive 2. No crew recorded aboard.");
  });

  it("leaves a diver who never left the dock out of every after-dive count", () => {
    const { headline, standing } = read({
      counts: counts(
        {
          departure: {
            tom: said("not_boarded", "08:50"),
            lena: said("boarded", "08:51"),
            sal: said("boarded", "08:52"),
          },
          after_dive_1: {
            tom: said("not_boarded", "08:50", { implied: true }),
            lena: said("boarded", "10:41"),
            sal: said("boarded", "10:42"),
          },
        },
        { departure: true, after_dive_1: true },
      ),
    });
    expect(headline).toBe("Everyone is recorded back aboard after dive 1.");
    expect(standing.latest).toMatchObject({ aboard: 2, out: 2 });
  });

  it("puts an open missing-diver alert above everything, even a finished count", () => {
    const { headline, emphasis, standing } = read({
      alerted: new Set(["b-tom"]),
      counts: counts(
        {
          ...dockDone,
          after_dive_1: {
            tom: said("not_boarded", "10:38"),
            lena: said("boarded", "10:38"),
            sal: said("boarded", "10:39"),
          },
        },
        { departure: true },
      ),
    });
    expect(headline).toBe("1 missing-diver alert is open.");
    expect(emphasis).toBe("1 missing-diver alert");
    expect(standing.notYetBack[0]).toMatchObject({ name: "Tom Okafor", status: "missingAlert" });
  });

  it("leads with an open missing-diver report that names nobody", () => {
    const { headline, standing } = read({
      openAlerts: 1,
      counts: counts(
        {
          ...dockDone,
          after_dive_1: {
            tom: said("boarded", "10:40"),
            lena: said("boarded", "10:41"),
            sal: said("boarded", "10:42"),
          },
        },
        { departure: true, after_dive_1: true },
      ),
    });
    expect(headline).toBe("1 missing-diver alert is open.");
    expect(standing.alerts).toBe(1);
  });

  it("names an alerted person before any after-dive count", () => {
    const { headline, standing } = read({
      alerted: new Set(["p-sal"]),
      counts: counts(dockDone, { departure: true }),
    });
    expect(headline).toBe("1 missing-diver alert is open.");
    expect(standing.notYetBack).toEqual([
      expect.objectContaining({ name: "Sal Reyes", crew: true, status: "missingAlert" }),
    ]);
  });

  it("says a cancelled trip is cancelled, unless a count recorded someone not back aboard", () => {
    expect(read({}, true).headline).toBe(FALLBACK.headline);
    expect(read({ counts: counts(dockDone, { departure: true }) }, true).headline).toBe(
      FALLBACK.headline,
    );
    const missing = read(
      {
        counts: counts({
          ...dockDone,
          after_dive_1: { tom: said("not_boarded", "10:38") },
        }),
      },
      true,
    );
    expect(missing.headline).toBe("1 person is recorded not back aboard after dive 1.");
    // A count nobody finished, or reports that disagree, outrank the cancellation too.
    const unrecorded = read(
      { counts: counts({ ...dockDone, after_dive_1: { tom: said("boarded", "10:38") } }) },
      true,
    );
    expect(unrecorded.headline).toBe("2 people are not yet recorded back after dive 1.");
    const conflict = read(
      {
        counts: counts({
          ...dockDone,
          after_dive_1: {
            tom: said("boarded", "10:38", { evidenceConflict: true }),
            lena: said("boarded", "10:38"),
            sal: said("boarded", "10:39"),
          },
        }),
      },
      true,
    );
    expect(conflict.headline).toBe("1 person is not yet recorded back after dive 1.");
  });

  it("marks a guest who also crews once, as the guest", () => {
    const standing = waterStanding({
      counts: [
        {
          checkpoint: "after_dive_1",
          divers: [{ bookingId: "b-sal", personId: "p-sal", fullName: "Sal Reyes" }],
          crew: [{ id: "p-sal", fullName: "Sal Reyes" }],
          completeness: { complete: false },
        },
        {
          checkpoint: "departure",
          divers: [
            {
              bookingId: "b-sal",
              personId: "p-sal",
              fullName: "Sal Reyes",
              rollCall: said("boarded", "08:50"),
            },
          ],
          crew: [{ id: "p-sal", fullName: "Sal Reyes", rollCall: said("boarded", "08:50") }],
          completeness: { complete: true },
        },
      ],
      alerted: new Set(),
      plannedDives: [{ diveNumber: 1, site: null }],
      logged: new Map(),
      stage: null,
      homeSaidAt: null,
      endsAt: at("12:30"),
      boatChecks: null,
    });
    // The dock is the latest count with anything on it.
    expect(standing.latest).toMatchObject({ dive: 0, aboard: 1, out: 1 });
  });
});

describe("the day so far", () => {
  it("is what was recorded, then what the plan still holds", () => {
    const { standing } = read({
      counts: counts(
        { ...dockDone, after_dive_1: { lena: said("boarded", "10:38") } },
        { departure: true },
      ),
      stage: { stage: "underway", recordedAt: at("09:02") },
      logged: new Map([[1, { enteredAt: at("09:44"), exitedAt: at("10:30"), maxDepthMeters: 12 }]]),
      boatChecks: { checked: 5, total: 5 },
    });
    expect(
      standing.timeline.map((stop) => [stop.kind, stop.state, "dive" in stop ? stop.dive : null]),
    ).toEqual([
      ["dock", "done", null],
      ["stage", "done", null],
      ["dive", "now", 1],
      ["dive", "ahead", 2],
      ["home", "ahead", null],
    ]);
    const dive1 = standing.timeline[2];
    expect(dive1).toMatchObject({ site: "Molasses Reef", logged: { maxDepthMeters: 12 } });
    // On the water: dive 1 is counted, dive 2 is the one the boat is on; home, every dive.
    expect(loggableDives(standing, { back: false })).toEqual([1, 2]);
    expect(loggableDives(standing, { back: true })).toEqual([1, 2]);
    // Nothing counted yet: only the first dive, never one further ahead.
    expect(loggableDives(read().standing, { back: false })).toEqual([1]);
  });
});

describe("seats the roll call never placed", () => {
  const seatsAt = (over: Partial<WaterCount["divers"][number]>[]) => {
    const [dock, ...rest] = counts({});
    return [
      {
        ...dock,
        divers: dock.divers.map((seat, i) => ({ ...seat, ...over[i] })),
      },
      ...rest,
    ];
  };
  const run = (c: WaterCount[]) =>
    waterStanding({
      counts: c,
      alerted: new Set(),
      plannedDives: [],
      logged: new Map(),
      stage: null,
      homeSaidAt: null,
      endsAt: at("12:30"),
      boatChecks: null,
    }).unplaced;

  it("names a guest with no record at the dock, and a blocked one apart", () => {
    const c = seatsAt([
      { rollCall: said("boarded", "09:00") },
      { readiness: { status: "blocked" } },
    ]);
    expect(run(c)).toEqual({ noRecord: [], blocked: ["Lena Fischer"] });
    expect(run(seatsAt([{ rollCall: said("boarded", "09:00") }, {}]))).toEqual({
      noRecord: ["Lena Fischer"],
      blocked: [],
    });
  });

  it("does not name a seat the crew placed, the desk released, or turned away", () => {
    const c = seatsAt([{ rollCall: said("not_boarded", "09:00") }, { notHere: true }]);
    expect(run(c)).toEqual({ noRecord: [], blocked: [] });
  });
});

/**
 * **A planned dive recorded not made** (issue #4681): the crew's record rides
 * on its dive stop, and only while no count speaks for that dive. A count, any
 * count, outranks it: a dive somebody began counting was made.
 */
describe("a dive recorded not made", () => {
  const notMade = new Map([[2, { by: "Sal Reyes", at: at("11:40") }]]);
  const dive = (standing: ReturnType<typeof read>["standing"], n: number) =>
    standing.timeline.find((stop) => stop.kind === "dive" && stop.dive === n);

  it("is said on that dive's stop, and on no other", () => {
    const { standing } = read({
      counts: counts({ ...dockDone, after_dive_1: { tom: said("boarded", "10:30") } }),
      notMade,
    });
    expect(dive(standing, 2)).toMatchObject({ count: null, notMade: notMade.get(2) });
    expect(dive(standing, 1)).toMatchObject({ notMade: null });
  });

  it("gives way to a count of that dive: a dive somebody counted was made", () => {
    const { standing } = read({
      counts: counts({ ...dockDone, after_dive_2: { lena: said("boarded", "11:50") } }),
      notMade,
    });
    expect(dive(standing, 2)).toMatchObject({ notMade: null });
    expect(dive(standing, 2)?.kind === "dive" && dive(standing, 2)).toMatchObject({
      count: { dive: 2 },
    });
  });

  it("gives way to a log of that dive: a dive with times or a depth was made", () => {
    for (const log of [
      { enteredAt: at("11:00"), exitedAt: null, maxDepthMeters: null },
      { enteredAt: null, exitedAt: at("11:45"), maxDepthMeters: null },
      { enteredAt: null, exitedAt: null, maxDepthMeters: 12 },
    ]) {
      const { standing } = read({
        counts: counts({ ...dockDone, after_dive_1: { tom: said("boarded", "10:30") } }),
        logged: new Map([[2, log]]),
        notMade,
      });
      expect(dive(standing, 2)).toMatchObject({ notMade: null });
    }
  });

  it("never takes anybody off the people not recorded back, or quiets an alert", () => {
    const { standing, headline } = read({
      counts: counts({
        ...dockDone,
        after_dive_1: {
          tom: said("not_boarded", "10:30"),
          lena: said("boarded", "10:31"),
          sal: said("boarded", "10:31"),
        },
      }),
      alerted: new Set(["b-tom"]),
      notMade,
    });
    expect(standing.notYetBack.map((person) => [person.name, person.status])).toEqual([
      ["Tom Okafor", "missingAlert"],
    ]);
    expect(standing.alerts).toBe(1);
    expect(headline).not.toBeNull();
    expect(dive(standing, 2)).toMatchObject({ notMade: notMade.get(2) });
  });
});
