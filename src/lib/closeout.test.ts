import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleDayCloseout,
  assembleEveningClose,
  buildCloseoutSnapshot,
  type CloseoutRollCallGap,
  type CloseoutTripInput,
  closeoutAdminTaskStatus,
  parseCloseoutSnapshot,
  shopDayOf,
} from "./closeout";
import { type CrewRollCallSubject, rollCallCompleteness } from "./manifests";
import type { TodayAction } from "./today";
import {
  liveStageOf,
  STAGE_STALE_AFTER_MS,
  TRIP_STAGES,
  type TripStage,
  type TripStageReading,
} from "./trip-stages";
import { DEPARTURE_BUFFER_MS } from "./trips";

const TZ = "America/New_York";
// A fixed evening instant: 17:30 shop-local on 2026-08-04 (EDT, UTC-4).
const now = new Date("2026-08-04T21:30:00Z");
const HOUR = 60 * 60 * 1000;

/** Two crew, both counted back — the ordinary shape of a finished departure. */
const CREW_COUNTED_BACK: CrewRollCallSubject[] = [
  { rollCall: { state: "boarded" } },
  { rollCall: { state: "boarded" } },
];

function trip(overrides: Partial<CloseoutTripInput> & { tripId: string }): CloseoutTripInput {
  return {
    title: "Two-Tank Reef",
    // Sailed 07:30 local, home 11:30 local — an ordinary finished morning boat.
    startsAt: new Date("2026-08-04T11:30:00Z"),
    endsAt: new Date("2026-08-04T15:30:00Z"),
    booked: 8,
    capacity: 12,
    plannedDives: 2,
    crew: CREW_COUNTED_BACK,
    recapShoutout: null,
    ...overrides,
  };
}

/** One tap at the rail, as `latestTripStagesByTrip` hands it in. */
function stage(word: TripStage, recordedAt: Date): TripStageReading {
  return { stage: word, siteName: "Molasses Reef", recordedAt, recordedByName: "Marco Diaz" };
}

function action(overrides: Partial<TodayAction> & { id: string }): TodayAction {
  return {
    kind: "waiver",
    urgency: "now",
    subject: "Priya Patel",
    context: "Two-Tank Reef · 7:30 AM",
    detail: "Waiver has not been sent.",
    actionLabel: "Send waiver",
    href: "/shop/demo/trips/t1#booking-b1",
    dueAt: new Date(now.getTime() + 2 * HOUR),
    ...overrides,
  };
}

describe("assembleDayCloseout", () => {
  it("reads an all-clear day as exactly that: every boat home, nothing left over", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" }), trip({ tripId: "t2", title: "Sunset Dive" })],
      gaps: [],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.shopDay).toBe("2026-08-04");
    expect(state.departures.map((d) => d.status)).toEqual(["all_home", "all_home"]);
    expect(state.leftovers).toEqual([]);
  });

  it("keeps a day with zero departures calm — no boats is not an error", () => {
    const state = assembleDayCloseout({ trips: [], gaps: [], actions: [], timeZone: TZ, now });

    expect(state.departures).toEqual([]);
    expect(state.leftovers).toEqual([]);
  });

  it("keeps a quiet day open when work exists without a departure", () => {
    const state = assembleDayCloseout({
      trips: [],
      gaps: [],
      actions: [action({ id: "leftover", dueAt: null })],
      timeZone: TZ,
      now,
    });

    expect(state.leftovers).toHaveLength(1);
  });

  it("counts administrative follow-up as outstanding while keeping it separate from roll call", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" })],
      gaps: [],
      actions: [],
      adminTasks: [
        {
          id: "post_dive_reports",
          status: "pending",
          total: 8,
          completed: 6,
          pending: 2,
          failed: 0,
        },
      ],
      timeZone: TZ,
      now,
    });

    expect(state.adminTasks).toEqual([
      {
        id: "post_dive_reports",
        status: "pending",
        total: 8,
        completed: 6,
        pending: 2,
        failed: 0,
      },
    ]);
  });

  it("derives administrative task tone from failed and pending counts", () => {
    expect(closeoutAdminTaskStatus({ total: 8, completed: 8, pending: 0, failed: 0 })).toBe(
      "complete",
    );
    expect(closeoutAdminTaskStatus({ total: 8, completed: 6, pending: 2, failed: 0 })).toBe(
      "pending",
    );
    expect(closeoutAdminTaskStatus({ total: 8, completed: 6, pending: 0, failed: 2 })).toBe(
      "attention",
    );
  });

  it("makes an unreconciled after-dive count the loudest thing on the page", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" }), trip({ tripId: "t2", title: "Sunset Dive" })],
      gaps: [{ tripId: "t2", reason: "after_dive_uncounted", diveNumber: 2, uncounted: 3 }],
      actions: [],
      timeZone: TZ,
      now,
    });

    // Loudest first: the gap outranks the clean boat whatever the sailing order.
    expect(state.departures[0]?.tripId).toBe("t2");
    expect(state.departures[0]?.status).toBe("unreconciled");
    expect(state.departures[0]?.uncounted).toBe(3);
    expect(state.departures[0]?.diveNumber).toBe(2);
  });

  it("headlines a missing diver over a clerical gap on the same boat", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" })],
      gaps: [
        { tripId: "t1", reason: "departure_uncounted", diveNumber: 0, uncounted: 2 },
        { tripId: "t1", reason: "missing_diver", diveNumber: 1, uncounted: 1 },
      ],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.departures[0]?.gapReason).toBe("missing_diver");
    expect(state.departures[0]?.status).toBe("unreconciled");
  });

  it("tones a dock-count gap as paperwork rather than as a person in the water", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" })],
      gaps: [{ tripId: "t1", reason: "no_roll_call", diveNumber: 0, uncounted: 8 }],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.departures[0]?.status).toBe("count_open");
  });

  it("says so while a boat is still out, and when one has not even left", () => {
    const state = assembleDayCloseout({
      trips: [
        trip({
          tripId: "out",
          title: "Afternoon Two-Tank",
          startsAt: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() + 1 * HOUR),
        }),
        trip({
          tripId: "night",
          title: "Night Dive",
          startsAt: new Date(now.getTime() + 2 * HOUR),
          endsAt: new Date(now.getTime() + 5 * HOUR),
        }),
      ],
      gaps: [],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.departures.map((d) => [d.tripId, d.status])).toEqual([
      ["out", "still_out"],
      ["night", "not_departed"],
    ]);
  });

  // **A crew tap settles a station the clock would leave open; it never
  // reopens one the clock has closed** — issue #1480. The late-arrival hour is
  // an allowance for a *time-based inference*; a crew member tapping Home at
  // the rail is the statement that inference was standing in for. The first
  // four cases below pin the constraints the issue binds the promotion with;
  // the last two pin the direction it deliberately does *not* run in, so a
  // later session reads the asymmetry as the rule rather than an oversight.
  describe("a recorded home stage", () => {
    const MINUTE = 60 * 1000;
    /** Sailed at dawn, due back five minutes ago — still out for another 55. */
    const inBuffer = (overrides: Partial<CloseoutTripInput> = {}): CloseoutTripInput =>
      trip({
        tripId: "t1",
        startsAt: new Date(now.getTime() - 5 * HOUR),
        endsAt: new Date(now.getTime() - 5 * MINUTE),
        ...overrides,
      });
    const statusOf = (
      input: CloseoutTripInput,
      gaps: readonly CloseoutRollCallGap[] = [],
      at: Date = now,
    ) =>
      assembleDayCloseout({ trips: [input], gaps, actions: [], timeZone: TZ, now: at })
        .departures[0]?.status;

    it("settles a boat the clock would still call still out", () => {
      // The control first: without the tap this same departure is still out,
      // which is what makes the promotion below the stage's doing.
      expect(statusOf(inBuffer())).toBe("still_out");
      expect(
        statusOf(inBuffer({ stage: stage("home", new Date(now.getTime() - 10 * MINUTE)) })),
      ).toBe("all_home");
    });

    it("never closes the day over a diver nobody counted", () => {
      // **Constraint 1**, structurally: the gap branch returns before the
      // clock and the stage are consulted at all, so no tap at the rail can
      // promote a departure whose head count is open.
      const tapped = inBuffer({ stage: stage("home", new Date(now.getTime() - 10 * MINUTE)) });
      expect(
        statusOf(tapped, [{ tripId: "t1", reason: "missing_diver", diveNumber: 2, uncounted: 1 }]),
      ).toBe("unreconciled");
      expect(
        statusOf(tapped, [{ tripId: "t1", reason: "no_roll_call", diveNumber: 0, uncounted: 8 }]),
      ).toBe("count_open");
    });

    it("leaves a departure nobody tapped to the clock, exactly as before", () => {
      // **Constraint 2.** The buffer is unchanged for every shop that has
      // never tapped a stage: an hour past the scheduled return, and home.
      const elapsed = trip({
        tripId: "t1",
        startsAt: new Date(now.getTime() - 6 * HOUR),
        endsAt: new Date(now.getTime() - HOUR - MINUTE),
      });
      expect(statusOf(elapsed)).toBe("all_home");
      expect(statusOf({ ...elapsed, stage: null })).toBe("all_home");
    });

    it("stops reading a stage the crew stopped maintaining", () => {
      // **Constraint 3.** A word goes stale two buffers past the departure's
      // own end (`STAGE_STALE_AFTER_MS`), and by then the clock has long since
      // answered on its own — so a stale stage cannot move this reading in
      // *either* direction. The window in which it could is empty, and that is
      // arithmetic rather than convention:
      expect(STAGE_STALE_AFTER_MS).toBeGreaterThan(DEPARTURE_BUFFER_MS);

      const endsAt = new Date(now.getTime() - 3 * HOUR);
      const long = (word: TripStage) =>
        trip({
          tripId: "t1",
          startsAt: new Date(now.getTime() - 8 * HOUR),
          endsAt,
          stage: stage(word, new Date(endsAt.getTime() - 5 * MINUTE)),
        });
      expect(statusOf(long("home"))).toBe("all_home");
      expect(statusOf(long("underway"))).toBe("all_home");
    });

    it("promotes on home and on nothing else", () => {
      // **Constraint 4.** Four of the five words say the boat is out; only the
      // fifth says she is back, and only the fifth is allowed to say so.
      for (const word of ["boarding", "underway", "surface", "heading_in"] as const) {
        expect(
          statusOf(inBuffer({ stage: stage(word, new Date(now.getTime() - 10 * MINUTE)) })),
        ).toBe("still_out");
      }
    });

    it("leaves the clock's own close standing through the overdue hour", () => {
      // The direction the rule does not run in. Between the clock's close
      // (`endsAt` + one buffer) and the word going stale (two buffers) there
      // is a live, contrary `underway` — and the departure still reads home,
      // because no stage demotes. What makes that safe rather than a boat lost
      // quietly is the gap branch, which returns first: the second expectation
      // is the same overdue boat with its head count open.
      const overdue = trip({
        tripId: "t1",
        startsAt: new Date(now.getTime() - 6 * HOUR),
        endsAt: new Date(now.getTime() - HOUR - 30 * MINUTE),
        stage: stage("underway", new Date(now.getTime() - 10 * MINUTE)),
      });
      // The word is genuinely still speaking here, not quietly stale:
      expect(liveStageOf(overdue.stage ?? null, overdue.endsAt, now)).not.toBeNull();

      expect(statusOf(overdue)).toBe("all_home");
      expect(
        statusOf(overdue, [{ tripId: "t1", reason: "missing_diver", diveNumber: 2, uncounted: 1 }]),
      ).toBe("unreconciled");
    });

    it("leaves a boat the clock has not released alone, whatever the crew taps", () => {
      // `hasSailed` carries no matching promotion, and this pins that as a
      // decision rather than a bug: fifty minutes into an hour-buffered
      // departure every one of the five words reads `not_departed`, `home`
      // included. Nothing turns on it — `not_departed` and `still_out` are
      // both unsettled, and neither ends the day.
      for (const word of TRIP_STAGES) {
        expect(
          statusOf(
            trip({
              tripId: "t1",
              startsAt: new Date(now.getTime() - 50 * MINUTE),
              endsAt: new Date(now.getTime() + 3 * HOUR),
              stage: stage(word, new Date(now.getTime() - 45 * MINUTE)),
            }),
          ),
        ).toBe("not_departed");
      }
    });

    it("closes the day an hour early once the tap settles the last station", () => {
      // The unlock, end to end through the evening join: `settled` reads the
      // promoted status, so the closing block and the homecoming line both
      // arrive while the clock still has fifty-five minutes to run.
      const tapped = inBuffer({ stage: stage("home", new Date(now.getTime() - 10 * MINUTE)) });
      const untapped = inBuffer();

      expect(
        assembleEveningClose(
          assembleDayCloseout({ trips: [untapped], gaps: [], actions: [], timeZone: TZ, now })
            .departures,
          now,
        ).closing,
      ).toBe(false);

      const evening = assembleEveningClose(
        assembleDayCloseout({ trips: [tapped], gaps: [], actions: [], timeZone: TZ, now })
          .departures,
        now,
      );
      expect(evening.stations[0]?.settled).toBe(true);
      expect(evening.closing).toBe(true);
      expect(evening.allHome).toBe(true);
    });
  });

  it("marks only the boats that are actually back as ended, and carries each one's recap note", () => {
    // `ended` is what decides whether the close-out offers a departure the
    // crew's post-trip note. A boat still out has no day to write about yet
    // and one that has not left has no recap coming — the same reading
    // `sendDueRecaps` makes about whose recap is due.
    const state = assembleDayCloseout({
      trips: [
        trip({ tripId: "home", recapShoutout: "Eagle ray on the second dive!" }),
        trip({
          tripId: "out",
          title: "Afternoon Two-Tank",
          startsAt: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() + 1 * HOUR),
        }),
        trip({
          tripId: "night",
          title: "Night Dive",
          startsAt: new Date(now.getTime() + 2 * HOUR),
          endsAt: new Date(now.getTime() + 5 * HOUR),
        }),
      ],
      gaps: [],
      actions: [],
      timeZone: TZ,
      now,
    });

    const byTrip = new Map(state.departures.map((d) => [d.tripId, d]));
    expect(byTrip.get("home")?.ended).toBe(true);
    expect(byTrip.get("out")?.ended).toBe(false);
    expect(byTrip.get("night")?.ended).toBe(false);
    expect(byTrip.get("home")?.recapShoutout).toBe("Eagle ray on the second dive!");
    expect(byTrip.get("out")?.recapShoutout).toBeNull();
  });

  it("ignores another day's roll-call gaps: yesterday's residue is Today's chase, not tonight's list", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" })],
      gaps: [{ tripId: "yesterday", reason: "missing_diver", diveNumber: 1, uncounted: 1 }],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.departures.map((d) => d.status)).toEqual(["all_home"]);
  });

  it("keeps today's own open rows as leftovers, and nothing dated past today", () => {
    const leftoverDated = action({ id: "a-today", dueAt: new Date(now.getTime() + HOUR) });
    const leftoverUndated = action({
      id: "a-undated",
      kind: "stuck_payment_operation",
      dueAt: null,
    });
    // 08:00 local tomorrow.
    const tomorrowRow = action({ id: "a-tomorrow", dueAt: new Date("2026-08-05T12:00:00Z") });
    // Two days out — neither list's business.
    const laterRow = action({ id: "a-later", dueAt: new Date("2026-08-06T12:00:00Z") });
    // A roll-call row never becomes a leftover: head counts are chased, not carried.
    const rollCall = action({
      id: "roll-call:t9:missing_diver:after_dive_1",
      kind: "roll_call_missing_diver",
      dueAt: new Date(now.getTime() - 2 * HOUR),
    });

    const state = assembleDayCloseout({
      trips: [],
      gaps: [],
      actions: [laterRow, tomorrowRow, leftoverUndated, leftoverDated, rollCall],
      timeZone: TZ,
      now,
    });

    expect(state.leftovers.map((a) => a.id)).toEqual(["a-today", "a-undated"]);
  });

  it("leaves the standing units confirmation with Today instead of close-out", () => {
    const state = assembleDayCloseout({
      trips: [],
      gaps: [],
      actions: [
        action({
          id: "units:unconfirmed",
          kind: "units_unconfirmed",
          dueAt: null,
          subject: "Check your currency and depth unit",
        }),
      ],
      timeZone: TZ,
      now,
    });

    expect(state.leftovers).toEqual([]);
  });

  it("leaves tomorrow entirely to the spine — no row dated tomorrow is a leftover", () => {
    // The evening used to end on a parting glance that tallied tomorrow's
    // queue by kind. That card went with the page (H-62): the home's own
    // Tomorrow disclosure is what the evening closes on, built from the queue
    // rather than from a second tally of it. What survives is the boundary —
    // a row that belongs to tomorrow is not something today left over.
    const rows = [
      action({ id: "a-0", dueAt: new Date("2026-08-05T11:00:00Z") }),
      action({ id: "a-1", dueAt: new Date("2026-08-05T12:00:00Z") }),
      action({ id: "a-2", kind: "payment", dueAt: new Date("2026-08-05T13:00:00Z") }),
    ];

    const state = assembleDayCloseout({ trips: [], gaps: [], actions: rows, timeZone: TZ, now });

    expect(state.leftovers).toEqual([]);
  });
});

describe("buildCloseoutSnapshot", () => {
  const state = assembleDayCloseout({
    trips: [trip({ tripId: "clean" }), trip({ tripId: "gap", title: "Sunset Dive" })],
    gaps: [{ tripId: "gap", reason: "missing_crew", diveNumber: 1, uncounted: 1 }],
    actions: [action({ id: "a1" }), action({ id: "a2", subject: "Marco Diaz" })],
    timeZone: TZ,
    now,
  });

  it("records exactly what was outstanding: the unsettled departures and every leftover's decision", () => {
    const snapshot = buildCloseoutSnapshot(state, { a2: "dismiss" });

    // The clean boat is not "outstanding" — recording it would bury the one that is.
    expect(snapshot.departures).toEqual([
      {
        tripId: "gap",
        title: "Sunset Dive",
        status: "unreconciled",
        gapReason: "missing_crew",
        uncounted: 1,
      },
    ]);
    // Queue order (sortActions): Marco sorts before Priya on the name tiebreak.
    expect(snapshot.leftovers.map((l) => [l.id, l.decision])).toEqual([
      ["a2", "dismiss"],
      ["a1", "carry"],
    ]);
    expect(snapshot.adminTasks).toEqual([]);
  });

  it("defaults an unstated decision to carry and ignores ids the day does not hold", () => {
    const snapshot = buildCloseoutSnapshot(state, {
      "not-a-real-row": "dismiss",
      // Prototype-shaped keys must not resolve to anything.
      constructor: "dismiss",
    } as Record<string, "carry" | "dismiss">);

    expect(snapshot.leftovers.every((l) => l.decision === "carry")).toBe(true);
  });

  it("round-trips through the defensive parser", () => {
    const snapshot = buildCloseoutSnapshot(state, { a1: "dismiss" });
    expect(parseCloseoutSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("drops malformed stored rows instead of crashing the trail", () => {
    expect(parseCloseoutSnapshot(null)).toEqual({ departures: [], leftovers: [], adminTasks: [] });
    expect(parseCloseoutSnapshot("nonsense")).toEqual({
      departures: [],
      leftovers: [],
      adminTasks: [],
    });
    expect(
      parseCloseoutSnapshot({
        departures: [{ tripId: 7 }, { tripId: "x", title: "y", status: "all_home" }],
        leftovers: [{ id: "only-id" }, 42],
      }),
    ).toEqual({ departures: [], leftovers: [], adminTasks: [] });
  });
});

describe("shopDayOf", () => {
  it("names the day the shop's own wall clock is in, not UTC's", () => {
    // 23:30 local on Aug 4 is 03:30 UTC on Aug 5.
    expect(shopDayOf(new Date("2026-08-05T03:30:00Z"), TZ)).toBe("2026-08-04");
  });
});

/**
 * **The evening reading, and the one thing it must never get wrong** (ADR
 * 20260827-clearwater-surface-language, decision 4).
 *
 * The day closes when the day is over — with the standing one-hour
 * late-arrival buffer this app carries on every "has it sailed" question,
 * because trips run late. Everything else here is arithmetic over what
 * `assembleDayCloseout` already decided; this is the part a wrong answer would
 * put a shop's day to bed while a boat is still on the water.
 */
describe("assembleEveningClose", () => {
  const day = (overrides: Partial<CloseoutTripInput> & { tripId: string }) =>
    assembleDayCloseout({
      trips: [trip(overrides)],
      gaps: [],
      actions: [],
      timeZone: TZ,
      now,
    }).departures;

  it("settles a boat whose head count closed clean, and counts everyone back", () => {
    const evening = assembleEveningClose(day({ tripId: "t1", booked: 10 }), now);

    expect(evening.stations.map((station) => [station.tripId, station.settled])).toEqual([
      ["t1", true],
    ]);
    // **Souls, not seats** (issue #1346): ten divers and the two crew who took
    // them out. The crew were in neither number until 2026-09-05, on the one
    // sentence in the product about who came home.
    expect([evening.divers, evening.crew]).toEqual([10, 2]);
    expect([evening.out, evening.back]).toEqual([12, 12]);
    expect(evening.closing).toBe(true);
    expect(evening.allHome).toBe(true);
  });

  it("withholds the moment when nobody counted the crew, and says so the way the manifest does", () => {
    // **The #1346 invariant, asserted on both surfaces at once.** A departure
    // whose divers are all counted back and whose two assigned crew have no
    // result at all: the home said "all boats are home" while the same boat's
    // manifest said `crew_awaiting`, because `listRollCallGaps` counts only
    // crew who already have a result. One fixture, both readings — asserting
    // `allHome` alone would let the two drift apart again.
    const crew: CrewRollCallSubject[] = [{}, {}];
    const evening = assembleEveningClose(day({ tripId: "t1", booked: 10, crew }), now);

    expect(evening.stations[0]?.status).toBe("all_home");
    expect(evening.closing).toBe(true);
    expect(evening.allHome).toBe(false);
    expect(
      rollCallCompleteness({
        checkpoint: "after_dive_2",
        totalDivers: 10,
        awaiting: 0,
        notBackAboard: 0,
        crew,
      }).crewReason,
    ).toBe("crew_awaiting");
  });

  it("withholds it from a departure that names no crew at all", () => {
    // `crew_none_assigned` parity with the manifest: an empty roster is a
    // scheduling gap, never evidence that nobody else was aboard.
    const evening = assembleEveningClose(day({ tripId: "t1", booked: 10, crew: [] }), now);

    expect(evening.stations[0]?.crewAccountedFor).toBe(false);
    expect(evening.allHome).toBe(false);
    // The divers still count, and the crew half is honestly zero.
    expect([evening.divers, evening.crew, evening.out]).toEqual([10, 0, 10]);
  });

  it("withholds it from a crew recorded entirely ashore", () => {
    // `crew_none_aboard`: a complete set of results that together say the boat
    // sailed with nobody running it.
    // `implied` is the carried-forward dock result: they never left, so they
    // are accounted for on land rather than missing from the water. The
    // arithmetic therefore comes out even — and precisely because it does, the
    // moment must not.
    const ashore: CrewRollCallSubject[] = [
      { rollCall: { state: "not_boarded", implied: true } },
      { rollCall: { state: "not_boarded", implied: true } },
    ];
    const evening = assembleEveningClose(day({ tripId: "t1", booked: 10, crew: ashore }), now);

    expect(evening.stations[0]?.crewAccountedFor).toBe(false);
    expect([evening.out, evening.back]).toEqual([12, 12]);
    expect(evening.allHome).toBe(false);
  });

  it("counts a crew member who did not come back as still out", () => {
    const crew: CrewRollCallSubject[] = [
      { rollCall: { state: "boarded" } },
      { rollCall: { state: "not_boarded" } },
    ];
    const evening = assembleEveningClose(day({ tripId: "t1", booked: 10, crew }), now);

    expect([evening.out, evening.back]).toEqual([12, 11]);
    expect(evening.allHome).toBe(false);
  });

  it("holds the closing block back while a boat is still out", () => {
    // **The pin.** A departure due back in an hour is not a departure the day
    // may be closed over, and nothing on the page may suggest otherwise.
    const departures = assembleDayCloseout({
      trips: [
        trip({ tripId: "home" }),
        trip({
          tripId: "out",
          startsAt: new Date(now.getTime() - 3 * HOUR),
          endsAt: new Date(now.getTime() + HOUR),
        }),
      ],
      gaps: [],
      actions: [],
      timeZone: TZ,
      now,
    }).departures;
    const evening = assembleEveningClose(departures, now);

    expect(evening.stations.find((station) => station.tripId === "out")?.settled).toBe(false);
    expect(evening.closing).toBe(false);
    expect(evening.allHome).toBe(false);
  });

  it("holds it back through the whole late-arrival buffer, and lets go the moment it passes", () => {
    // A boat scheduled home ten minutes ago has not settled: trips run late,
    // and the hour is the allowance every other "is it back" question makes.
    const justIn = trip({
      tripId: "late",
      startsAt: new Date(now.getTime() - 4 * HOUR),
      endsAt: new Date(now.getTime() - 10 * 60 * 1000),
    });
    const before = assembleEveningClose(
      assembleDayCloseout({ trips: [justIn], gaps: [], actions: [], timeZone: TZ, now }).departures,
      now,
    );
    expect(before.closing).toBe(false);

    const later = new Date(now.getTime() + 51 * 60 * 1000);
    const after = assembleEveningClose(
      assembleDayCloseout({
        trips: [justIn],
        gaps: [],
        actions: [],
        timeZone: TZ,
        now: later,
      }).departures,
      later,
    );
    expect(after.closing).toBe(true);
  });

  it("never closes a day that had no departures at all", () => {
    const evening = assembleEveningClose([], now);

    expect(evening.stations).toEqual([]);
    expect(evening.closing).toBe(false);
    // Nothing sailed, so there is no homecoming to mark — the quiet-day
    // collapse is the page, not a celebration about an empty dock.
    expect(evening.allHome).toBe(false);
  });

  it("subtracts an after-dive gap from the count back, and withholds the moment", () => {
    const departures = assembleDayCloseout({
      trips: [trip({ tripId: "t1", booked: 10 })],
      gaps: [{ tripId: "t1", reason: "missing_diver", diveNumber: 2, uncounted: 1 }],
      actions: [],
      timeZone: TZ,
      now,
    }).departures;
    const evening = assembleEveningClose(departures, now);

    expect([evening.out, evening.back]).toEqual([12, 11]);
    // The day is over, so the block may render — but a boat that came back one
    // person short is not "all boats are home", and the accent stays unspent.
    expect(evening.closing).toBe(true);
    expect(evening.allHome).toBe(false);
  });

  it("leaves a dock-count gap's numbers alone — paperwork is not a person in the water", () => {
    const departures = assembleDayCloseout({
      trips: [trip({ tripId: "t1", booked: 10 })],
      gaps: [{ tripId: "t1", reason: "no_roll_call", diveNumber: 0, uncounted: 10 }],
      actions: [],
      timeZone: TZ,
      now,
    }).departures;
    const evening = assembleEveningClose(departures, now);

    expect([evening.out, evening.back]).toEqual([12, 12]);
    // …and precisely because the arithmetic comes out even, the moment must
    // not: nobody counted this boat at the dock, so "10 out, 10 back" is a
    // claim the shop's records cannot support.
    expect(evening.stations[0]?.status).toBe("count_open");
    expect(evening.closing).toBe(true);
    expect(evening.allHome).toBe(false);
  });

  it("puts the stations in clock order, not in the loudest-first order the list arrives in", () => {
    const departures = assembleDayCloseout({
      trips: [
        trip({ tripId: "dawn", startsAt: new Date("2026-08-04T11:00:00Z") }),
        trip({
          tripId: "afternoon",
          startsAt: new Date("2026-08-04T15:00:00Z"),
          endsAt: new Date("2026-08-04T18:00:00Z"),
        }),
      ],
      gaps: [{ tripId: "afternoon", reason: "no_roll_call", diveNumber: 0, uncounted: 2 }],
      actions: [],
      timeZone: TZ,
      now,
    }).departures;
    // The closing list ranks the loudest departure first; the spine is a clock.
    expect(departures[0]?.tripId).toBe("afternoon");
    expect(assembleEveningClose(departures, now).stations.map((s) => s.tripId)).toEqual([
      "dawn",
      "afternoon",
    ]);
  });
});

/**
 * The glossary said every departure's end state is read off the same roll-call
 * evidence Today chases. Since issue #1480 it is read off that evidence, then
 * the clock, then the crew's own stage — and the stage only ever promotes
 * (`dive-domain-expert`, the RFH-07 layer). A reader who takes the old sentence
 * at its word cannot tell why a departure the clock calls still-out reads home.
 *
 * A text scan, like `src/lib/gear.test.ts`'s register-group entry.
 */
describe("the glossary's close-out entry", () => {
  const entry = async () => {
    const glossary = await readFile(path.join(process.cwd(), "docs/product/glossary.md"), "utf8");
    const block = glossary.split(/^- \*\*/m).find((part) => part.startsWith("Close-out**"));
    expect(block, "docs/product/glossary.md has no **Close-out** entry").toBeDefined();
    return block ?? "";
  };

  it("states the three sources in the order departureStatus reads them", async () => {
    const text = await entry();
    expect(text).toContain("departureStatus");
    const [roll, clock, stage] = ["roll-call evidence", "then the clock", "trip stage"].map(
      (needle) => text.indexOf(needle),
    );
    expect(roll).toBeGreaterThan(-1);
    expect(clock).toBeGreaterThan(roll);
    expect(stage).toBeGreaterThan(clock);
  });

  it("states the promotion and its one-way-ness", async () => {
    const text = await entry();
    expect(text).toContain("#1480");
    expect(text).toMatch(/never reopens one the clock has closed/);
    expect(text).toMatch(/Nothing\s+demotes/);
  });
});
