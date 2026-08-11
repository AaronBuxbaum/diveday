import { describe, expect, it } from "vitest";
import {
  assembleDayCloseout,
  buildCloseoutSnapshot,
  type CloseoutTripInput,
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

    expect(state.shape).toBe("all_clear");
    expect(state.shopDay).toBe("2026-08-04");
    expect(state.departures.map((d) => d.status)).toEqual(["all_home", "all_home"]);
    expect(state.leftovers).toEqual([]);
    expect(state.tomorrow).toEqual({ total: 0, byKind: [] });
    expect(state.mustAcknowledge).toEqual([]);
  });

  it("keeps a day with zero departures calm — no boats is a shape, not an error", () => {
    const state = assembleDayCloseout({ trips: [], gaps: [], actions: [], timeZone: TZ, now });

    expect(state.shape).toBe("no_departures");
    expect(state.departures).toEqual([]);
    expect(state.mustAcknowledge).toEqual([]);
  });

  it("makes an unreconciled after-dive count the loudest thing on the page and demands acknowledgement", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" }), trip({ tripId: "t2", title: "Sunset Dive" })],
      gaps: [{ tripId: "t2", reason: "after_dive_uncounted", diveNumber: 2, uncounted: 3 }],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.shape).toBe("outstanding");
    // Loudest first: the gap outranks the clean boat whatever the sailing order.
    expect(state.departures[0]?.tripId).toBe("t2");
    expect(state.departures[0]?.status).toBe("unreconciled");
    expect(state.departures[0]?.uncounted).toBe(3);
    expect(state.departures[0]?.diveNumber).toBe(2);
    expect(state.mustAcknowledge.map((d) => d.tripId)).toEqual(["t2"]);
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

  it("tones a dock-count gap as paperwork: outstanding, but no acknowledgement demanded", () => {
    const state = assembleDayCloseout({
      trips: [trip({ tripId: "t1" })],
      gaps: [{ tripId: "t1", reason: "no_roll_call", diveNumber: 0, uncounted: 8 }],
      actions: [],
      timeZone: TZ,
      now,
    });

    expect(state.shape).toBe("outstanding");
    expect(state.departures[0]?.status).toBe("count_open");
    expect(state.mustAcknowledge).toEqual([]);
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
    // A boat not home yet must be acknowledged to close over; one that has
    // not left is stated but does not gate — closing before a night dive
    // departs is an ordinary early close, not an incident.
    expect(state.mustAcknowledge.map((d) => d.tripId)).toEqual(["out"]);
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

  it("splits the queue into today's leftovers and tomorrow's glance by the shop's own day", () => {
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
    expect(state.tomorrow).toEqual({ total: 1, byKind: [{ kind: "waiver", count: 1 }] });
  });

  it("counts tomorrow by kind instead of re-rendering rows Today owns", () => {
    // Tomorrow's queue as a mix of kinds. The close-out states how much is
    // waiting and hands the rows themselves to Today, the only surface that
    // can act on them (ADR 20260803-not-ready-is-a-view, applied at section
    // level) — so what comes back is counts, never actions.
    const rows = [
      action({ id: "a-0", dueAt: new Date("2026-08-05T11:00:00Z") }),
      action({ id: "a-1", dueAt: new Date("2026-08-05T12:00:00Z") }),
      action({ id: "a-2", kind: "payment", dueAt: new Date("2026-08-05T13:00:00Z") }),
      action({ id: "a-3", kind: "certification", dueAt: new Date("2026-08-05T14:00:00Z") }),
      action({ id: "a-4", kind: "payment", dueAt: new Date("2026-08-05T15:00:00Z") }),
    ];

    const state = assembleDayCloseout({ trips: [], gaps: [], actions: rows, timeZone: TZ, now });

    expect(state.tomorrow.total).toBe(5);
    // Queue order — `sortActions`'s own ranking, so the glance names the kinds
    // in the order the morning will meet them.
    expect(state.tomorrow.byKind).toEqual([
      { kind: "waiver", count: 2 },
      { kind: "payment", count: 2 },
      { kind: "certification", count: 1 },
    ]);
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
    expect(parseCloseoutSnapshot(null)).toEqual({ departures: [], leftovers: [] });
    expect(parseCloseoutSnapshot("nonsense")).toEqual({ departures: [], leftovers: [] });
    expect(
      parseCloseoutSnapshot({
        departures: [{ tripId: 7 }, { tripId: "x", title: "y", status: "all_home" }],
        leftovers: [{ id: "only-id" }, 42],
      }),
    ).toEqual({ departures: [], leftovers: [] });
  });
});

describe("shopDayOf", () => {
  it("names the day the shop's own wall clock is in, not UTC's", () => {
    // 23:30 local on Aug 4 is 03:30 UTC on Aug 5.
    expect(shopDayOf(new Date("2026-08-05T03:30:00Z"), TZ)).toBe("2026-08-04");
  });
});
