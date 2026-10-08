import { describe, expect, it } from "vitest";
import {
  canMoveWorkOrder,
  isOpenWorkOrderStatus,
  isWorkOrderStatus,
  OPEN_WORK_ORDER_STATUSES,
  parseWorkOrderQuantity,
  suggestCustomerServiceDueOn,
  WORK_ORDER_STATUSES,
  workOrderIsLate,
  workOrderLineTotalCents,
  workOrderQuantityInput,
  workOrderServiceClock,
  workOrderStatusMoves,
  workOrderStatusRank,
  workOrderSubtotalsCents,
  workOrderTotalCents,
} from "./work-orders";

describe("work order statuses", () => {
  it("counts every status but picked up as open", () => {
    expect(WORK_ORDER_STATUSES.filter(isOpenWorkOrderStatus)).toEqual([
      ...OPEN_WORK_ORDER_STATUSES,
    ]);
    expect(isOpenWorkOrderStatus("picked_up")).toBe(false);
  });

  it("reads a status from a form value and refuses anything else", () => {
    expect(isWorkOrderStatus("waiting_on_parts")).toBe(true);
    expect(isWorkOrderStatus("cancelled")).toBe(false);
    expect(isWorkOrderStatus("")).toBe(false);
  });

  it("ranks the board in counter order", () => {
    expect(workOrderStatusRank("received")).toBeLessThan(workOrderStatusRank("in_progress"));
    expect(workOrderStatusRank("ready")).toBeLessThan(workOrderStatusRank("picked_up"));
  });

  it("lets bench work move backwards among the open statuses", () => {
    // A regulator declared ready that turns out to leak goes back on the
    // bench; a workflow that refused would teach staff to open a second
    // ticket for one job.
    expect(canMoveWorkOrder("ready", "in_progress")).toBe(true);
    expect(canMoveWorkOrder("waiting_on_parts", "in_progress")).toBe(true);
    expect(canMoveWorkOrder("received", "ready")).toBe(true);
  });

  it("refuses a move to the status it is already on", () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(canMoveWorkOrder(status, status)).toBe(false);
      expect(workOrderStatusMoves(status)).not.toContain(status);
    }
  });

  it("treats picked up as the end of the ticket", () => {
    for (const status of WORK_ORDER_STATUSES) {
      expect(canMoveWorkOrder("picked_up", status)).toBe(false);
    }
    expect(workOrderStatusMoves("picked_up")).toEqual([]);
  });
});

describe("workOrderIsLate", () => {
  it("is late when the promised day has gone and the gear is still here", () => {
    expect(
      workOrderIsLate({
        status: "in_progress",
        promisedOn: "2026-10-07",
        todayLocal: "2026-10-08",
      }),
    ).toBe(true);
  });

  it("counts a ready ticket nobody has collected as late", () => {
    // The work is done and nobody has called: the failure a promised date is
    // kept for.
    expect(
      workOrderIsLate({ status: "ready", promisedOn: "2026-10-01", todayLocal: "2026-10-08" }),
    ).toBe(true);
  });

  it("is not late on the promised day itself", () => {
    expect(
      workOrderIsLate({ status: "received", promisedOn: "2026-10-08", todayLocal: "2026-10-08" }),
    ).toBe(false);
  });

  it("is never late without a promised day, or once collected", () => {
    expect(
      workOrderIsLate({ status: "received", promisedOn: null, todayLocal: "2026-10-08" }),
    ).toBe(false);
    expect(
      workOrderIsLate({ status: "picked_up", promisedOn: "2026-01-01", todayLocal: "2026-10-08" }),
    ).toBe(false);
  });
});

describe("totals", () => {
  it("multiplies a fractional quantity without floating point drift", () => {
    expect(workOrderLineTotalCents({ quantityHundredths: 150, unitAmountCents: 8500 })).toBe(12750);
    expect(workOrderLineTotalCents({ quantityHundredths: 100, unitAmountCents: 4299 })).toBe(4299);
    expect(workOrderLineTotalCents({ quantityHundredths: 300, unitAmountCents: 333 })).toBe(999);
  });

  it("rounds a half minor unit up, the way a counter does on paper", () => {
    expect(workOrderLineTotalCents({ quantityHundredths: 50, unitAmountCents: 101 })).toBe(51);
  });

  it("adds parts and labor into one total and keeps the two subtotals", () => {
    const lines = [
      { kind: "part" as const, quantityHundredths: 200, unitAmountCents: 1250 },
      { kind: "labor" as const, quantityHundredths: 150, unitAmountCents: 8000 },
    ];
    expect(workOrderTotalCents(lines)).toBe(2500 + 12000);
    expect(workOrderSubtotalsCents(lines)).toEqual({ parts: 2500, labor: 12000 });
  });

  it("totals an empty ticket at nothing", () => {
    expect(workOrderTotalCents([])).toBe(0);
  });

  it("carries a warranty part at no charge", () => {
    expect(workOrderLineTotalCents({ quantityHundredths: 100, unitAmountCents: 0 })).toBe(0);
  });
});

describe("quantities", () => {
  it("reads whole and fractional quantities", () => {
    expect(parseWorkOrderQuantity("2")).toBe(200);
    expect(parseWorkOrderQuantity("1.5")).toBe(150);
    expect(parseWorkOrderQuantity("0.75")).toBe(75);
    expect(parseWorkOrderQuantity(" 3 ")).toBe(300);
  });

  it("refuses nothing, zero, a negative and a third decimal place", () => {
    for (const value of ["", "abc", "0", "0.00", "-1", "1.005", "1e3"]) {
      expect(parseWorkOrderQuantity(value)).toBeNull();
    }
  });

  it("round-trips a stored quantity back into the form", () => {
    expect(workOrderQuantityInput(100)).toBe("1");
    expect(workOrderQuantityInput(150)).toBe("1.5");
    expect(workOrderQuantityInput(75)).toBe("0.75");
    expect(workOrderQuantityInput(225)).toBe("2.25");
  });
});

describe("the next service date a finished ticket suggests", () => {
  it("borrows the register's own interval for the piece's clock", () => {
    expect(workOrderServiceClock("regulator")).toBe("service");
    expect(suggestCustomerServiceDueOn("regulator", "2026-10-08")).toBe("2027-10-08");
  });

  it("uses a cylinder's visual inspection, the first clock with an interval", () => {
    expect(workOrderServiceClock("tank")).toBe("visual_inspection");
    expect(suggestCustomerServiceDueOn("tank", "2026-10-08")).toBe("2027-10-08");
  });

  it("suggests nothing for a piece that runs no clock", () => {
    // Nobody should be reminded about a wetsuit.
    expect(workOrderServiceClock("wetsuit")).toBeNull();
    expect(suggestCustomerServiceDueOn("wetsuit", "2026-10-08")).toBeNull();
  });
});
