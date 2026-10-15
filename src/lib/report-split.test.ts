import { describe, expect, it } from "vitest";
import { sailedSplit } from "./report-split";
import type { MonthlyReport } from "./reporting";

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

/** Fourth UX review, item 22: "so far" split into what sailed and what is still for sale. */
describe("sailedSplit", () => {
  it("splits seats, fill and revenue at now", () => {
    const month = report({
      tripCount: 20,
      seatsOffered: 235,
      seatsBooked: 129,
      fillRate: 129 / 235,
      revenueCents: 653_900,
    });
    const sailed = report({
      tripCount: 11,
      seatsOffered: 130,
      seatsBooked: 104,
      fillRate: 0.8,
      revenueCents: 590_000,
    });
    expect(sailedSplit(month, sailed)).toEqual({
      seats: { sailed: 104, toSail: 25 },
      fill: { sailed: 0.8, toSail: 25 / 105 },
      revenueCents: { sailed: 590_000, toSail: 63_900 },
    });
  });

  it("says nothing when every boat has sailed or none has", () => {
    const month = report({ tripCount: 3, seatsOffered: 30, seatsBooked: 20 });
    expect(sailedSplit(month, month)).toBeNull();
    expect(sailedSplit(month, report({}))).toBeNull();
  });
});
