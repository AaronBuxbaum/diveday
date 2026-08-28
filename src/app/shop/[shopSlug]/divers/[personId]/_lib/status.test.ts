import { describe, expect, it } from "vitest";
import type { ReadinessResult } from "@/lib/readiness";
import type { DiverProfile } from "../_components/shared";
import { bookingIsAhead, buildDiverStatus, nextBookingAhead } from "./status";

const NOW = new Date("2026-08-26T18:00:00.000Z");
const TOMORROW = new Date("2026-08-27T11:00:00.000Z");
const LAST_MONTH = new Date("2026-07-12T11:00:00.000Z");

type Overrides = {
  person?: Partial<DiverProfile["person"]>;
  waiver?: DiverProfile["waiver"];
  bookings?: unknown[];
  certifications?: unknown[];
  specialtyCertifications?: unknown[];
  nitroxCertifications?: unknown[];
  orders?: unknown[];
  bookingPayments?: unknown[];
};

/** A record with nothing outstanding — every row below is one thing added to this. */
function diver(overrides: Overrides = {}): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Grace Mensah",
      emergencyContactName: "Kojo Mensah",
      emergencyContactPhone: "+13055550177",
      ...overrides.person,
    },
    waiver: overrides.waiver ?? { state: "current" },
    waiverRequest: "not_sent",
    bookings: overrides.bookings ?? [],
    certifications: overrides.certifications ?? [],
    specialtyCertifications: overrides.specialtyCertifications ?? [],
    nitroxCertifications: overrides.nitroxCertifications ?? [],
    orders: overrides.orders ?? [],
    bookingPayments: overrides.bookingPayments ?? [],
    priorVisits: [],
  } as unknown as DiverProfile;
}

type BookingEntry = DiverProfile["bookings"][number];

function booking(
  id: string,
  startsAt: Date,
  overrides: Record<string, unknown> = {},
): BookingEntry {
  return {
    booking: { id, status: "confirmed", tripId: `trip-${id}`, ...overrides },
    trip: {
      id: `trip-${id}`,
      title: "Two-Tank Reef",
      startsAt,
      endsAt: startsAt,
      status: "scheduled",
    },
    course: null,
  } as unknown as BookingEntry;
}

const blocked = (code: string): ReadinessResult =>
  ({ status: "blocked", blockers: [{ code }] }) as ReadinessResult;

describe("the status ledger's silence", () => {
  /**
   * **The pinned rule** (ADR 20260827-people-not-lists): a clear diver's
   * record shows no status section at all — not a heading, not an "all clear"
   * line. The empty array is what the surface renders nothing from, so it is
   * asserted here as hard as any row is.
   */
  it("returns nothing at all for a diver with nothing outstanding", () => {
    expect(buildDiverStatus(diver(), null, { now: NOW })).toEqual([]);
  });

  it("stays empty when the diver's next departure clears them", () => {
    const ahead = diver({ bookings: [booking("b1", TOMORROW)] });
    const ready: ReadinessResult = { status: "ready", blockers: [] };
    expect(buildDiverStatus(ahead, ready, { now: NOW })).toEqual([]);
  });
});

describe("what earns a row", () => {
  it("names a card nobody has looked at, as work rather than a blocker", () => {
    const rows = buildDiverStatus(
      diver({ certifications: [{ id: "c1", status: "pending" }] }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "certification",
      tone: "warning",
      action: { target: "verify" },
    });
  });

  it("says an unsigned release is outstanding, and offers to send it", () => {
    const rows = buildDiverStatus(diver({ waiver: { state: "none" } as never }), null, {
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "waiver",
      tone: "warning",
      sentence: { key: "divers.status.waiverMissing" },
      action: { target: "send_waiver" },
    });
  });

  it("tells a lapsed signature from one that was never given", () => {
    const rows = buildDiverStatus(diver({ waiver: { state: "expired" } as never }), null, {
      now: NOW,
    });
    expect(rows[0]?.sentence).toEqual({ key: "divers.status.waiverExpired" });
  });

  /**
   * A medical hold has no act the shop can take from this page — the release
   * waits on a doctor. Offering "Send the waiver" beside it would point a
   * staffer at a send `issueWaiverRequest` refuses.
   */
  it("offers no fix for a medical hold, because the shop has none to offer", () => {
    const rows = buildDiverStatus(diver({ waiver: { state: "medical_review" } as never }), null, {
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ kind: "waiver", tone: "danger" });
    expect(rows[0]?.action).toBeUndefined();
  });

  it("counts money owed and points at the invoice that owes it", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [booking("b1", LAST_MONTH)],
        orders: [{ order: { id: "order-9", bookingId: "b1", status: "open" } }],
      }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "payment",
      tone: "warning",
      action: { target: "collect" },
      orderId: "order-9",
    });
  });

  it("asks for an emergency contact when either half of it is missing", () => {
    const rows = buildDiverStatus(diver({ person: { emergencyContactPhone: "" } }), null, {
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "contact", tone: "warning" });
  });
});

describe("a departure the diver is actually on", () => {
  /**
   * Trip-bound blockers come from the readiness engine and carry the blocker
   * itself, so the record can never word a gate differently from the boat.
   */
  it("escalates to danger and carries the blocker, not a sentence of its own", () => {
    const rows = buildDiverStatus(
      diver({
        bookings: [booking("b1", TOMORROW)],
        certifications: [{ id: "c1", status: "pending" }],
      }),
      blocked("certification_pending"),
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "certification",
      tone: "danger",
      sentence: { blocker: { code: "certification_pending" } },
      tripContext: { tripId: "trip-b1" },
    });
  });

  it("puts the boat's blocker above the record's own housekeeping", () => {
    const rows = buildDiverStatus(
      diver({
        person: { emergencyContactName: "" },
        bookings: [booking("b1", TOMORROW)],
        waiver: { state: "none" } as never,
      }),
      blocked("waiver_not_sent"),
      { now: NOW },
    );
    expect(rows.map((row) => row.tone)).toEqual(["danger", "warning"]);
    expect(rows.map((row) => row.kind)).toEqual(["waiver", "contact"]);
  });

  it("keeps one row per kind — three pending cards are one job", () => {
    const rows = buildDiverStatus(
      diver({
        certifications: [
          { id: "c1", status: "pending" },
          { id: "c2", status: "pending" },
        ],
        specialtyCertifications: [{ id: "s1", status: "pending" }],
      }),
      null,
      { now: NOW },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentence).toEqual({
      key: "divers.status.cardsWaiting",
      values: { count: 3 },
    });
  });
});

describe("the late-arrival buffer", () => {
  /**
   * AGENTS.md's standing rule: a boat that left at 7:00 is not "in the past"
   * at 7:05. The record's old Upcoming/History split ignored it, which filed a
   * diver's own boat as history while they were still on the dock.
   */
  it("keeps a departure ahead of the diver for an hour past its start", () => {
    const entry = booking("b1", new Date("2026-08-26T17:30:00.000Z"));
    expect(bookingIsAhead(entry, NOW)).toBe(true);
    expect(bookingIsAhead(entry, new Date("2026-08-26T18:31:00.000Z"))).toBe(false);
  });

  it("measures status against the soonest departure still ahead", () => {
    const record = diver({
      bookings: [booking("later", new Date("2026-09-04T11:00:00.000Z")), booking("b1", TOMORROW)],
    });
    expect(nextBookingAhead(record, NOW)?.booking.id).toBe("b1");
  });

  it("ignores a cancelled seat and a cancelled departure", () => {
    const record = diver({
      bookings: [
        booking("cancelled-seat", TOMORROW, { status: "cancelled" }),
        {
          ...booking("blown-out", TOMORROW),
          trip: { ...booking("x", TOMORROW).trip, status: "cancelled" },
        } as BookingEntry,
      ],
    });
    expect(nextBookingAhead(record, NOW)).toBeNull();
  });
});
