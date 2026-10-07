import { describe, expect, it } from "vitest";
import {
  cancellationDeadline,
  checkoutCharge,
  checkoutSeatTerms,
  refundOnCancellation,
  seatListPriceCents,
  withinCancellationWindow,
} from "./deposits";

describe("checkoutCharge", () => {
  it("returns null for an unpriced trip so checkout never fires a $0 charge", () => {
    expect(checkoutCharge({ priceCents: null, depositCents: null }, null)).toBeNull();
    expect(checkoutCharge({ priceCents: 0, depositCents: null }, null)).toBeNull();
  });

  it("charges the full fare with no balance when no deposit is set", () => {
    expect(checkoutCharge({ priceCents: 18000, depositCents: null }, null)).toEqual({
      amountCents: 18000,
      isDeposit: false,
      balanceDueCents: 0,
    });
  });

  it("charges the deposit and leaves the balance due when a deposit is below the fare", () => {
    expect(checkoutCharge({ priceCents: 18000, depositCents: 5000 }, null)).toEqual({
      amountCents: 5000,
      isDeposit: true,
      balanceDueCents: 13000,
    });
  });

  it("treats a deposit at or above the fare, or non-positive, as no deposit (charge full)", () => {
    for (const depositCents of [18000, 20000, 0, -100]) {
      expect(checkoutCharge({ priceCents: 18000, depositCents }, null)).toMatchObject({
        amountCents: 18000,
        isDeposit: false,
        balanceDueCents: 0,
      });
    }
  });

  it("deposits against the course's total, not the trip's standalone price", () => {
    const course = { title: "Open Water", priceCents: 45000, eLearningPriceCents: 15000 };
    // Course total is 60000; a 10000 deposit is a deposit, balance 50000.
    expect(checkoutCharge({ priceCents: 18000, depositCents: 10000 }, course)).toEqual({
      amountCents: 10000,
      isDeposit: true,
      balanceDueCents: 50000,
    });
  });
});

describe("cancellationDeadline", () => {
  const startsAt = new Date("2026-08-01T12:00:00.000Z");

  it("is null when the shop states no window", () => {
    expect(cancellationDeadline({ startsAt, cancellationWindowHours: null })).toBeNull();
    expect(cancellationDeadline({ startsAt, cancellationWindowHours: 0 })).toBeNull();
  });

  it("is the window's worth of hours before departure", () => {
    expect(cancellationDeadline({ startsAt, cancellationWindowHours: 48 })?.toISOString()).toBe(
      "2026-07-30T12:00:00.000Z",
    );
  });
});

describe("withinCancellationWindow", () => {
  const trip = { startsAt: new Date("2026-08-01T12:00:00.000Z"), cancellationWindowHours: 48 };

  it("is true before the deadline and false after it", () => {
    expect(withinCancellationWindow(trip, new Date("2026-07-29T12:00:00.000Z"))).toBe(true);
    expect(withinCancellationWindow(trip, new Date("2026-07-31T12:00:00.000Z"))).toBe(false);
  });

  it("is false when there is no stated window (nothing to be inside of)", () => {
    expect(
      withinCancellationWindow(
        { startsAt: trip.startsAt, cancellationWindowHours: null },
        new Date("2026-07-01T12:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

describe("refundOnCancellation", () => {
  const startsAt = new Date("2026-08-01T12:00:00.000Z");
  const trip = { startsAt, cancellationWindowHours: 48 };

  it("declines to automate when the trip states no window (staff decides)", () => {
    expect(
      refundOnCancellation({ startsAt, cancellationWindowHours: null }, 5000, startsAt),
    ).toEqual({ refundCents: 0, outcome: "no_policy" });
  });

  it("refunds the full amount paid inside the window", () => {
    expect(refundOnCancellation(trip, 5000, new Date("2026-07-29T12:00:00.000Z"))).toEqual({
      refundCents: 5000,
      outcome: "refund",
    });
  });

  it("forfeits the seat once the deadline has passed", () => {
    expect(refundOnCancellation(trip, 5000, new Date("2026-07-31T12:00:00.000Z"))).toEqual({
      refundCents: 0,
      outcome: "forfeit",
    });
  });

  it("treats the deadline instant itself as past the window", () => {
    // Deadline is exactly 2026-07-30T12:00 — a cancel at that instant forfeits.
    expect(refundOnCancellation(trip, 5000, new Date("2026-07-30T12:00:00.000Z")).outcome).toBe(
      "forfeit",
    );
  });

  it("never refunds more than was paid and clamps a non-positive amount to zero", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(refundOnCancellation(trip, 0, now).refundCents).toBe(0);
    expect(refundOnCancellation(trip, -100, now).refundCents).toBe(0);
  });
});

describe("seatListPriceCents", () => {
  const trip = { priceCents: 12_000, snorkelerPriceCents: 4_500, riderPriceCents: 0 };

  it("prices a diver at the trip's fare and every other seat at its own column", () => {
    expect(seatListPriceCents(trip, null, "diver")).toBe(12_000);
    expect(seatListPriceCents(trip, null, "snorkeler")).toBe(4_500);
    expect(seatListPriceCents(trip, null, "rider")).toBe(0);
  });

  it("never falls back to the diver's fare for a seat the trip does not price", () => {
    expect(
      seatListPriceCents({ priceCents: 12_000, snorkelerPriceCents: null }, null, "snorkeler"),
    ).toBeNull();
  });
});

describe("checkoutSeatTerms", () => {
  const trip = {
    priceCents: 12_000,
    depositCents: 3_000,
    snorkelerPriceCents: 4_500,
    riderPriceCents: 0,
  };

  it("quotes the diver deposit and each other seat at its own fare and deposit", () => {
    expect(checkoutSeatTerms(trip, null)).toEqual({
      depositCents: 3_000,
      otherSeatOffers: [
        { type: "snorkeler", fareCents: 4_500, depositCents: 3_000 },
        { type: "rider", fareCents: 0, depositCents: null },
      ],
    });
  });

  it("offers no other seat on a departure that prices none, or on a course session", () => {
    const plain = { ...trip, snorkelerPriceCents: null, riderPriceCents: null };
    expect(checkoutSeatTerms(plain, null).otherSeatOffers).toEqual([]);
    expect(checkoutSeatTerms({ ...trip, courseId: "course-1" }, null).otherSeatOffers).toEqual([]);
  });

  it("quotes no deposit on a departure that takes none", () => {
    expect(checkoutSeatTerms({ ...trip, depositCents: null }, null).depositCents).toBeNull();
  });
});
