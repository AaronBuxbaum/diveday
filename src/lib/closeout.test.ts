import { describe, expect, it } from "vitest";
import {
  assembleDayCloseout,
  assembleEveningClose,
  buildCloseoutSnapshot,
  type CloseoutTripInput,
  closeoutAdminTaskStatus,
  parseCloseoutSnapshot,
  shopDayOf,
} from "./closeout";
import type { TodayAction } from "./today";

const TZ = "America/New_York";
// A fixed evening instant: 17:30 shop-local on 2026-08-04 (EDT, UTC-4).
const now = new Date("2026-08-04T21:30:00Z");
const HOUR = 60 * 60 * 1000;

function trip(overrides: Partial<CloseoutTripInput> & { tripId: string }): CloseoutTripInput {
  return {
    title: "Two-Tank Reef",
    // Sailed 07:30 local, home 11:30 local — an ordinary finished morning boat.
    startsAt: new Date("2026-08-04T11:30:00Z"),
    endsAt: new Date("2026-08-04T15:30:00Z"),
    booked: 8,
    recapShoutout: null,
    ...overrides,
  };
}

function action(overrides: Partial<TodayAction> & { id: string }): TodayAction {
  return {
    kind: "waiver",
    urgency: "now",
    subject: "Priya Patel",
    context: "Two-Tank Reef · 7:30 AM",
    detail: "Waiver has not been sent.",
    actionLabel: "Send waiver",
    href: "/shop/demo/trips/t1/guests#booking-b1",
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
    expect([evening.out, evening.back]).toEqual([10, 10]);
    expect(evening.closing).toBe(true);
    expect(evening.allHome).toBe(true);
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

    expect([evening.out, evening.back]).toEqual([10, 9]);
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

    expect([evening.out, evening.back]).toEqual([10, 10]);
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
