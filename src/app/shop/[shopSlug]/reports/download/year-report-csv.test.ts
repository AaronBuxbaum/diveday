import { describe, expect, it } from "vitest";
import type { MonthlyReport } from "@/lib/reporting";
import { yearReportCsv } from "./year-report-csv";

function report(over: Partial<MonthlyReport>): MonthlyReport {
  return {
    tripCount: 0,
    seatsOffered: 0,
    seatsBooked: 0,
    fillRate: null,
    atCapacityTrips: 0,
    revenueCents: 0,
    taxCents: 0,
    importedPaymentCents: 0,
    importedRefundCents: 0,
    importedFinancialRecordCount: 0,
    tipsCents: 0,
    tipCount: 0,
    ...over,
  } as MonthlyReport;
}

/** Fourth UX review, item 25: a year CSV of month rows and a total. */
describe("yearReportCsv", () => {
  it("writes a row per month and a total that recomputes the fill", () => {
    const csv = yearReportCsv(
      [
        {
          month: { year: 2026, month: 1 },
          report: report({
            revenueCents: 100_000,
            taxCents: 7_000,
            tipsCents: 2_000,
            seatsBooked: 10,
            seatsOffered: 10,
            fillRate: 1,
          }),
        },
        {
          month: { year: 2026, month: 2 },
          report: report({ seatsOffered: 30, fillRate: 0 }),
        },
      ],
      (cents) => (cents / 100).toFixed(2),
    );
    expect(csv.split("\r\n")).toEqual([
      "Month,Net revenue,Tax collected,Tips,Bookings,Seats offered,Seat fill",
      "2026-01,1000.00,70.00,20.00,10,10,100%",
      "2026-02,0.00,0.00,0.00,0,30,0%",
      "Total,1000.00,70.00,20.00,10,40,25%",
      "",
    ]);
  });
});
