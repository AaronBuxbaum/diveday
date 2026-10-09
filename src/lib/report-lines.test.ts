import { describe, expect, it } from "vitest";
import {
  checkoutKeptRatio,
  orderKeptRatio,
  packageDiveValueCents,
  revenueByLine,
  revenueLineForOrderItem,
} from "./report-lines";

const plain = { workOrder: false, courseTrip: false };

describe("revenueLineForOrderItem", () => {
  it("puts each kind on its own line", () => {
    expect(revenueLineForOrderItem("course_fee", plain)).toBe("courses");
    expect(revenueLineForOrderItem("e_learning_fee", plain)).toBe("courses");
    expect(revenueLineForOrderItem("trip_fee", plain)).toBe("funDives");
    expect(revenueLineForOrderItem("nitrox", plain)).toBe("funDives");
    expect(revenueLineForOrderItem("deposit", plain)).toBe("funDives");
    expect(revenueLineForOrderItem("rental", plain)).toBe("rentals");
    expect(revenueLineForOrderItem("dive_package", plain)).toBe("packages");
    expect(revenueLineForOrderItem("merchandise", plain)).toBe("retail");
    expect(revenueLineForOrderItem("other", plain)).toBe("retail");
  });

  it("follows the departure: a trip fee on a course's session is course money", () => {
    expect(revenueLineForOrderItem("trip_fee", { workOrder: false, courseTrip: true })).toBe(
      "courses",
    );
  });

  it("bills a gear-bench job to the gear bench whatever its lines are called", () => {
    for (const kind of ["merchandise", "other", "rental"] as const) {
      expect(revenueLineForOrderItem(kind, { workOrder: true, courseTrip: false })).toBe(
        "gearBench",
      );
    }
  });

  it("never counts money collected for someone else", () => {
    expect(revenueLineForOrderItem("pass_through_fee", plain)).toBeNull();
    expect(revenueLineForOrderItem("pass_through_fee", { workOrder: true, courseTrip: true })).toBe(
      null,
    );
  });
});

describe("orderKeptRatio", () => {
  it("is the share still held after refunds, tax included on both sides", () => {
    expect(orderKeptRatio({ amountPaidCents: 11_000, totalCents: 11_000 })).toBe(1);
    expect(orderKeptRatio({ amountPaidCents: 5_500, totalCents: 11_000 })).toBe(0.5);
    expect(orderKeptRatio({ amountPaidCents: 0, totalCents: 11_000 })).toBe(0);
    expect(orderKeptRatio({ amountPaidCents: 0, totalCents: 0 })).toBe(0);
  });
});

describe("checkoutKeptRatio", () => {
  it("takes the tax out of what settled and a refund off what is left", () => {
    // $200 asked, $216 settled with $16 tax, $54 refunded (a quarter).
    expect(
      checkoutKeptRatio({
        totalCents: 20_000,
        settledTotalCents: 21_600,
        taxCents: 1_600,
        refundedCents: 5_400,
      }),
    ).toBeCloseTo(0.75);
  });

  it("scales a seat down by a promotion Stripe took off the session", () => {
    expect(
      checkoutKeptRatio({
        totalCents: 20_000,
        settledTotalCents: 18_000,
        taxCents: null,
        refundedCents: 0,
      }),
    ).toBeCloseTo(0.9);
  });

  it("stands on the ask when nothing settled was recorded", () => {
    expect(
      checkoutKeptRatio({
        totalCents: 20_000,
        settledTotalCents: null,
        taxCents: null,
        refundedCents: 0,
      }),
    ).toBe(1);
  });

  it("is zero for a fully refunded or empty checkout", () => {
    expect(
      checkoutKeptRatio({
        totalCents: 20_000,
        settledTotalCents: 20_000,
        taxCents: 0,
        refundedCents: 20_000,
      }),
    ).toBe(0);
    expect(
      checkoutKeptRatio({ totalCents: 0, settledTotalCents: 0, taxCents: 0, refundedCents: 0 }),
    ).toBe(0);
  });
});

describe("revenueByLine", () => {
  it("nets each refund on the line it was paid on, and orders the lines", () => {
    expect(
      revenueByLine([
        { line: "rentals", cents: 4_000, keptRatio: 1 },
        { line: "courses", cents: 50_000, keptRatio: 0.5 },
        { line: "courses", cents: 10_000, keptRatio: 1 },
        { line: "retail", cents: 2_000, keptRatio: 1 },
      ]),
    ).toEqual([
      { line: "courses", cents: 35_000 },
      { line: "rentals", cents: 4_000 },
      { line: "retail", cents: 2_000 },
    ]);
  });

  it("leaves out a line that came to nothing, refunded to zero included", () => {
    expect(
      revenueByLine([
        { line: "packages", cents: 45_000, keptRatio: 0 },
        { line: "funDives", cents: 0, keptRatio: 1 },
      ]),
    ).toEqual([]);
  });

  it("never lets a stray ratio inflate or invert a line", () => {
    expect(
      revenueByLine([
        { line: "gearBench", cents: 1_000, keptRatio: 3 },
        { line: "funDives", cents: 1_000, keptRatio: -1 },
        { line: "retail", cents: 1_000, keptRatio: Number.NaN },
      ]),
    ).toEqual([{ line: "gearBench", cents: 1_000 }]);
  });
});

describe("packageDiveValueCents", () => {
  it("is the price paid over the dives it bought", () => {
    expect(packageDiveValueCents({ unitAmountCents: 45_000, diveCount: 10 })).toBe(4_500);
    expect(packageDiveValueCents({ unitAmountCents: 10_000, diveCount: 3 })).toBe(3_333);
    expect(packageDiveValueCents({ unitAmountCents: 10_000, diveCount: 0 })).toBe(0);
  });
});
