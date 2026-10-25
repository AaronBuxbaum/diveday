import { describe, expect, it } from "vitest";
import type { DiverProfile } from "@/lib/diver-profile";
import { diverStanding } from "./diver-standing";

const NOW = new Date("2026-10-16T12:00:00Z");
const base = {
  now: NOW,
  shop: { timezone: "America/New_York", currency: "usd" },
  showMoney: true,
};

/**
 * `numberedDiveDay` is the database's own answer (`numberedDiveDay()` in
 * src/db/dive-days.ts, selected beside the seat): false for a cancelled seat, a
 * no-show, a ride-along, a held seat or a departure nobody dived.
 */
function seat(id: string, startsAt: string, status = "booked") {
  return {
    booking: { id, status },
    trip: { id: `trip-${id}`, status: "scheduled", startsAt: new Date(startsAt) },
    numberedDiveDay: status === "booked" || status === "checked_in",
    outWithShop: status === "booked" || status === "checked_in",
  };
}

function diver(over: Partial<Record<string, unknown>> = {}): DiverProfile {
  return {
    bookings: [],
    priorVisits: [],
    orders: [],
    bookingPayments: [],
    friendsBrought: 0,
    ...over,
  } as unknown as DiverProfile;
}

describe("diverStanding", () => {
  it("counts dive days from sailed seats and imported visits, first and last on the shop's calendar", () => {
    const standing = diverStanding(
      diver({
        bookings: [
          seat("a", "2026-09-30T23:30:00Z"), // Sep 30 in Florida, Oct 1 in UTC
          seat("b", "2026-11-01T12:00:00Z"), // ahead: not a visit yet
          seat("c", "2026-08-01T12:00:00Z", "cancelled"),
        ],
        priorVisits: [{ visitedOn: "2024-03-02" }],
      }),
      base,
    );
    expect(standing).toMatchObject({ diveDays: 2, since: "2024-03-02", lastOut: "2026-09-30" });
  });

  // Issue 2809: the standing line counts what the milestone, the recap and
  // Your days count.
  it("counts a morning and an afternoon boat on one date as one dive day", () => {
    const standing = diverStanding(
      diver({
        bookings: [seat("am", "2026-09-30T12:00:00Z"), seat("pm", "2026-09-30T18:00:00Z")],
      }),
      base,
    );
    expect(standing).toMatchObject({ diveDays: 1, since: "2026-09-30", lastOut: "2026-09-30" });
  });

  it("does not count a no-show, or a seat the database says was no dive day", () => {
    const standing = diverStanding(
      diver({
        bookings: [
          seat("gone", "2026-09-20T12:00:00Z", "no_show"),
          { ...seat("rode", "2026-09-25T12:00:00Z"), numberedDiveDay: false },
          seat("dived", "2026-09-28T12:00:00Z"),
        ],
      }),
      base,
    );
    expect(standing).toMatchObject({ diveDays: 1, since: "2026-09-28", lastOut: "2026-09-28" });
  });

  // Review 2 of issue 2809: a partner who rides along every Saturday has no
  // dive days, and still reads when they were last out.
  it("keeps last out for a rider or snorkeler regular with no dive days", () => {
    const rode = (id: string, startsAt: string) => ({
      ...seat(id, startsAt),
      numberedDiveDay: false,
    });
    const standing = diverStanding(
      diver({
        bookings: [
          rode("sat1", "2026-10-03T12:00:00Z"),
          rode("sat2", "2026-10-10T12:00:00Z"),
          seat("gone", "2026-10-14T12:00:00Z", "no_show"),
        ],
      }),
      base,
    );
    expect(standing).toMatchObject({ diveDays: 0, since: null, lastOut: "2026-10-10" });
  });

  it("does not count an imported visit twice on a day with a seat, nor one that did not happen", () => {
    const standing = diverStanding(
      diver({
        bookings: [seat("a", "2026-09-30T12:00:00Z")],
        priorVisits: [
          { visitedOn: "2026-09-30", statusLabel: "Completed" },
          { visitedOn: "2025-01-04", statusLabel: "Cancelled" },
        ],
      }),
      base,
    );
    expect(standing).toMatchObject({ diveDays: 1, since: "2026-09-30", lastOut: "2026-09-30" });
  });

  it("counts money kept once per seat, in the shop's currency only", () => {
    const standing = diverStanding(
      diver({
        orders: [
          {
            order: {
              bookingId: "a",
              currency: "usd",
              amountPaidCents: 20_000,
              refundedCents: 5_000,
            },
          },
          { order: { bookingId: null, currency: "usd", amountPaidCents: 4_000, refundedCents: 0 } },
          { order: { bookingId: "x", currency: "eur", amountPaidCents: 9_900, refundedCents: 0 } },
        ],
        bookingPayments: [
          // Has an order: the order is the record, so this is not counted again.
          {
            booking: { id: "a" },
            payment: { status: "paid", currency: "usd", amountCents: 20_000 },
          },
          {
            booking: { id: "b" },
            payment: { status: "deposit_paid", currency: "usd", amountCents: 5_000 },
          },
          {
            booking: { id: "c" },
            payment: { status: "partly_refunded", currency: "usd", amountCents: 8_000 },
          },
          {
            booking: { id: "d" },
            payment: { status: "unpaid", currency: "usd", amountCents: 8_000 },
          },
        ],
      }),
      base,
    );
    expect(standing.spent).toEqual({ cents: 15_000 + 4_000 + 5_000, currency: "usd" });
  });

  it("says no money to a reader who may not see it, and none at zero", () => {
    const paid = {
      orders: [
        { order: { bookingId: "a", currency: "usd", amountPaidCents: 100, refundedCents: 0 } },
      ],
    };
    expect(diverStanding(diver(paid), { ...base, showMoney: false }).spent).toBeNull();
    expect(diverStanding(diver(), base).spent).toBeNull();
  });

  it("carries the friends brought", () => {
    expect(diverStanding(diver({ friendsBrought: 2 }), base).friends).toBe(2);
  });
});
