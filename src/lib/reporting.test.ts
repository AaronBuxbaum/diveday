import { describe, expect, it } from "vitest";
import {
  formatPercent,
  type MonthlyReportInput,
  type ReportTrip,
  summarizeMonth,
  tripFillRate,
} from "./reporting";

function trip(overrides: Partial<ReportTrip> = {}): ReportTrip {
  return {
    tripId: "t",
    title: "Two-Tank Reef",
    startsAt: new Date("2026-06-10T12:00:00Z"),
    capacity: 10,
    activeBookings: 6,
    waiverComplete: 4,
    ...overrides,
  };
}

function input(overrides: Partial<MonthlyReportInput> = {}): MonthlyReportInput {
  return { trips: [trip()], revenueCents: 0, ...overrides };
}

describe("summarizeMonth", () => {
  it("rolls trips up into seats offered, seats booked, and the month's booking count", () => {
    const report = summarizeMonth(
      input({
        trips: [
          trip({ tripId: "a", capacity: 12, activeBookings: 9, waiverComplete: 8 }),
          trip({ tripId: "b", capacity: 8, activeBookings: 8, waiverComplete: 7 }),
        ],
      }),
    );
    expect(report.tripCount).toBe(2);
    expect(report.seatsOffered).toBe(20);
    expect(report.seatsBooked).toBe(17);
  });

  it("computes fill rate as seats booked over seats offered", () => {
    const report = summarizeMonth(
      input({ trips: [trip({ capacity: 10, activeBookings: 7, waiverComplete: 0 })] }),
    );
    expect(report.fillRate).toBeCloseTo(0.7);
  });

  it("caps fill rate at fully booked when a trip was overbooked (capacity cut below bookings)", () => {
    const report = summarizeMonth(
      input({ trips: [trip({ capacity: 4, activeBookings: 6, waiverComplete: 0 })] }),
    );
    expect(report.fillRate).toBe(1);
  });

  it("counts only sold-out trips as at capacity, and never an unbooked empty trip", () => {
    const report = summarizeMonth(
      input({
        trips: [
          trip({ capacity: 6, activeBookings: 6 }), // full
          trip({ capacity: 6, activeBookings: 5 }), // one seat left
          trip({ capacity: 0, activeBookings: 0 }), // a placeholder trip, not "full"
        ],
      }),
    );
    expect(report.atCapacityTrips).toBe(1);
  });

  it("derives waiver completion and the outstanding count from the bookings", () => {
    const report = summarizeMonth(
      input({
        trips: [
          trip({ activeBookings: 6, waiverComplete: 4 }),
          trip({ activeBookings: 4, waiverComplete: 4 }),
        ],
      }),
    );
    expect(report.waiverComplete).toBe(8);
    expect(report.waiverOutstanding).toBe(2);
    expect(report.waiverCompletion).toBeCloseTo(0.8);
  });

  it("passes revenue through untouched", () => {
    expect(summarizeMonth(input({ revenueCents: 184_500 })).revenueCents).toBe(184_500);
  });

  it("returns null rates for an empty month instead of dividing by zero", () => {
    const report = summarizeMonth(input({ trips: [], revenueCents: 0 }));
    expect(report.tripCount).toBe(0);
    expect(report.seatsOffered).toBe(0);
    expect(report.fillRate).toBeNull();
    expect(report.waiverCompletion).toBeNull();
    expect(report.waiverOutstanding).toBe(0);
  });

  it("does not let a waiver count above the booking count go negative", () => {
    // Defensive: a person covered by another booking's waiver could in principle
    // over-count; outstanding must never read as a negative backlog.
    const report = summarizeMonth(
      input({ trips: [trip({ activeBookings: 3, waiverComplete: 5 })] }),
    );
    expect(report.waiverOutstanding).toBe(0);
  });
});

describe("formatPercent", () => {
  it("rounds a ratio to a whole percent", () => {
    expect(formatPercent(0.824)).toBe("82%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("shows an em dash when there is nothing to measure", () => {
    expect(formatPercent(null)).toBe("—");
  });
});

describe("tripFillRate", () => {
  it("is bookings over capacity, capped at fully booked", () => {
    expect(tripFillRate({ capacity: 10, activeBookings: 5 })).toBeCloseTo(0.5);
    expect(tripFillRate({ capacity: 10, activeBookings: 12 })).toBe(1);
  });

  it("is null for a trip that offered no seats", () => {
    expect(tripFillRate({ capacity: 0, activeBookings: 0 })).toBeNull();
  });
});
