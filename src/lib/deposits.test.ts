import { describe, expect, it } from "vitest";
import { cancellationDeadline, checkoutCharge, withinCancellationWindow } from "./deposits";

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
