import { describe, expect, it } from "vitest";
import {
  compareMetric,
  compareMonthlyReports,
  compareRatio,
  formatPercent,
  formatPercentChange,
  formatPointsChange,
  formatReportMoney,
  type MonthlyReport,
  type MonthlyReportInput,
  monthHasActivity,
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
  return {
    trips: [trip()],
    revenueCents: 0,
    taxCents: 0,
    importedPaymentCents: 0,
    importedRefundCents: 0,
    importedFinancialRecordCount: 0,
    tipsCents: 0,
    tipCount: 0,
    ...overrides,
  };
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

  it("carries tax separately from net revenue", () => {
    expect(summarizeMonth(input({ revenueCents: 184_500, taxCents: 18_450 }))).toMatchObject({
      revenueCents: 184_500,
      taxCents: 18_450,
    });
  });

  it("carries the labelled imported payment and refund slice without turning it into trip activity", () => {
    const report = summarizeMonth(
      input({
        trips: [],
        revenueCents: 14_000,
        importedPaymentCents: 16_500,
        importedRefundCents: 2_500,
        importedFinancialRecordCount: 2,
      }),
    );
    expect(report.tripCount).toBe(0);
    expect(report.revenueCents).toBe(14_000);
    expect(report).toMatchObject({
      importedPaymentCents: 16_500,
      importedRefundCents: 2_500,
      importedFinancialRecordCount: 2,
    });
  });

  it("carries tips as their own figure and never folds them into revenue (PAY-M2)", () => {
    // A tip is 100% the shop's, charged on its own Stripe session, and never
    // part of the booking payment gate — so "Revenue collected" has to keep
    // meaning payments and deposits, with tips reported beside it. Summing
    // them here is what would make the revenue card stop reconciling.
    const report = summarizeMonth(input({ revenueCents: 184_500, tipsCents: 7_400, tipCount: 3 }));
    expect(report.revenueCents).toBe(184_500);
    expect(report.tipsCents).toBe(7_400);
    expect(report.tipCount).toBe(3);
  });

  it("reports a tipless month as zero rather than leaving the figure absent", () => {
    const report = summarizeMonth(input({ trips: [], revenueCents: 0 }));
    expect(report.tipsCents).toBe(0);
    expect(report.tipCount).toBe(0);
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

describe("monthHasActivity — slice 9f of ADR 20260827-the-shops-shelves", () => {
  it("is true for a month that has departures", () => {
    expect(monthHasActivity({ tripCount: 3, importedFinancialRecordCount: 0 })).toBe(true);
  });

  it("is true for a month whose only record is imported financial history", () => {
    // The migration month: no DiveDay departure, but real money by its own
    // source calendar date. Reading that month as "nothing happened" would be
    // wrong about the shop's books.
    expect(monthHasActivity({ tripCount: 0, importedFinancialRecordCount: 12 })).toBe(true);
  });

  it("is false for a month with neither, which is what stops five zero figures rendering", () => {
    expect(monthHasActivity({ tripCount: 0, importedFinancialRecordCount: 0 })).toBe(false);
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

describe("formatReportMoney", () => {
  it("headlines a month in whole major units, with no trailing minor units", () => {
    expect(formatReportMoney(578_900, "usd", "en-US")).toBe("$5,789");
  });

  it("uses the shop's own currency, not dollars", () => {
    // A Cozumel shop's month is pesos and a German diver's browser groups
    // them its own way — neither is a hardcoded US default.
    expect(formatReportMoney(578_900, "mxn", "en-US")).toBe("MX$5,789");
    // `\u00a0` — Intl separates a German amount from its symbol with a
    // non-breaking space, so normalize rather than assert an invisible glyph.
    expect(formatReportMoney(578_900, "eur", "de-DE").replace(/\u00a0/g, " ")).toBe("5.789 €");
  });

  it("does not divide a zero-decimal currency by a hundred", () => {
    // JPY stores whole yen, so ¥580,000 collected is ¥580,000 — a literal
    // `/ 100` here would headline the month as ¥5,800 and understate it 100x.
    expect(formatReportMoney(580_000, "jpy", "en-US")).toBe("¥580,000");
  });

  it("still reads as dollars when no currency is passed", () => {
    expect(formatReportMoney(578_900)).toBe("$5,789");
  });
});

function report(overrides: Partial<MonthlyReport> = {}): MonthlyReport {
  return {
    tripCount: 20,
    seatsOffered: 200,
    seatsBooked: 122,
    fillRate: 0.61,
    atCapacityTrips: 3,
    revenueCents: 747_900,
    taxCents: 0,
    importedPaymentCents: 0,
    importedRefundCents: 0,
    importedFinancialRecordCount: 0,
    tipsCents: 67_500,
    tipCount: 40,
    waiverComplete: 113,
    waiverOutstanding: 9,
    waiverCompletion: 113 / 122,
    ...overrides,
  };
}

describe("compareMetric — issue #700", () => {
  it("computes a percent change when the baseline clears the small-base threshold", () => {
    expect(compareMetric(122, 98, 10)).toEqual({ current: 122, baseline: 98, percentChange: 24 });
  });

  it("never says '+50%' for 2 bookings becoming 3 — the issue's own example", () => {
    expect(compareMetric(3, 2, 10).percentChange).toBeNull();
  });

  it("says nothing (not '+Infinity%') when the baseline is genuinely zero", () => {
    expect(compareMetric(5, 0, 10).percentChange).toBeNull();
  });

  it("still carries the raw current/baseline numbers even without a percent", () => {
    const cmp = compareMetric(3, 2, 10);
    expect(cmp.current).toBe(3);
    expect(cmp.baseline).toBe(2);
  });
});

describe("compareRatio", () => {
  it("reports a percentage-point delta, not a relative percent of a percent", () => {
    // 56% to 62% is +6 points — never "+11%", which is what a relative
    // reading of two percentages would say and is exactly the misleading
    // shape compareMetric's threshold exists to avoid at every base.
    expect(compareRatio(0.62, 0.56).pointsChange).toBe(6);
  });

  it("is null when either side has nothing to measure", () => {
    expect(compareRatio(null, 0.5).pointsChange).toBeNull();
    expect(compareRatio(0.5, null).pointsChange).toBeNull();
    expect(compareRatio(null, null).pointsChange).toBeNull();
  });
});

describe("compareMonthlyReports", () => {
  it("compares every headline card against the baseline month at once", () => {
    const current = report();
    const baseline = report({
      seatsBooked: 98,
      fillRate: 0.56,
      revenueCents: 669_000,
      tipsCents: 60_000,
      waiverComplete: 90,
      waiverCompletion: 90 / 98,
    });
    const cmp = compareMonthlyReports("yearAgo", current, baseline, "usd");
    expect(cmp.kind).toBe("yearAgo");
    expect(cmp.seatsBooked).toEqual({ current: 122, baseline: 98, percentChange: 24 });
    expect(cmp.revenueCents.percentChange).toBe(12);
    expect(cmp.fillRate.pointsChange).toBe(5);
  });

  it("suppresses a thin-baseline-month's revenue percent even on a real dollar figure", () => {
    // A shop's founding month: $165 in revenue a year ago against $7,479 now
    // is arithmetically "+4433%", the exact number that makes an owner stop
    // trusting the report (issue #700's own worry) — the honest tell is not
    // the dollar figure, it's that almost nothing was booked yet.
    const current = report({ seatsBooked: 122, revenueCents: 747_900 });
    const baseline = report({ seatsBooked: 0, revenueCents: 16_500 });
    const cmp = compareMonthlyReports("yearAgo", current, baseline, "usd");
    expect(cmp.revenueCents.percentChange).toBeNull();
    expect(cmp.revenueCents.current).toBeCloseTo(7479);
    expect(cmp.revenueCents.baseline).toBeCloseTo(165);
  });

  it("suppresses tips the same way, off the same booking-activity signal as revenue", () => {
    const current = report({ seatsBooked: 122, tipsCents: 6_000 });
    const baseline = report({ seatsBooked: 2, tipsCents: 800 });
    const cmp = compareMonthlyReports("previousMonth", current, baseline, "usd");
    expect(cmp.tipsCents.percentChange).toBeNull();
  });

  it("still shows a genuine seasonal swing once the baseline month had real bookings", () => {
    // The whole point of the feature: peak season against a real slow month
    // can legitimately be a very large percent, and suppressing it would
    // hide the exact seasonality comparison this report exists to answer.
    const current = report({ seatsBooked: 122, revenueCents: 747_900 });
    const baseline = report({ seatsBooked: 15, revenueCents: 74_790 });
    const cmp = compareMonthlyReports("yearAgo", current, baseline, "usd");
    expect(cmp.revenueCents.percentChange).toBe(900);
  });

  it("still runs the underlying money math in the shop's own currency, not raw minor units", () => {
    // ¥15,000 vs ¥12,000 is a real +25% in JPY's own (zero-decimal) major
    // unit — not divided by 100 as a dollar-shaped currency would be.
    const current = report({ seatsBooked: 20, revenueCents: 15_000 });
    const baseline = report({ seatsBooked: 15, revenueCents: 12_000 });
    const cmp = compareMonthlyReports("yearAgo", current, baseline, "jpy");
    expect(cmp.revenueCents.percentChange).toBe(25);
  });
});

describe("formatPercentChange / formatPointsChange", () => {
  it("signs a positive change with a leading plus", () => {
    expect(formatPercentChange(24)).toBe("+24%");
    expect(formatPointsChange(6)).toBe("+6pp");
  });

  it("carries the minus sign a negative number already has, unforced", () => {
    expect(formatPercentChange(-8)).toBe("-8%");
    expect(formatPointsChange(-3)).toBe("-3pp");
  });

  it("does not sign a flat zero as a gain", () => {
    expect(formatPercentChange(0)).toBe("0%");
    expect(formatPointsChange(0)).toBe("0pp");
  });
});
