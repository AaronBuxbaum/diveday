import { describe, expect, it } from "vitest";
import {
  canMoveWorkOrder,
  customerDueField,
  customerDueFields,
  isOpenWorkOrderStatus,
  isWorkOrderOutcome,
  isWorkOrderStatus,
  OPEN_WORK_ORDER_STATUSES,
  parseWorkOrderQuantity,
  suggestCareDueOn,
  WORK_ORDER_STATUSES,
  wholeMonthsBetween,
  workOrderCareKinds,
  workOrderIsLate,
  workOrderLineTotalCents,
  workOrderMoves,
  workOrderOutcomeNeedsNote,
  workOrderQuantityInput,
  workOrderReturnsUnitToService,
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

describe("workOrderMoves: the one step forward, and the rest", () => {
  it("names the step the bench takes next from every open status", () => {
    expect(workOrderMoves("received").forward).toBe("in_progress");
    expect(workOrderMoves("in_progress").forward).toBe("ready");
    // A part arriving puts the ticket back on the bench, not straight to ready.
    expect(workOrderMoves("waiting_on_parts").forward).toBe("in_progress");
    expect(workOrderMoves("ready").forward).toBe("picked_up");
  });

  it("offers every other allowed move once, in counter order, after the forward one", () => {
    for (const status of OPEN_WORK_ORDER_STATUSES) {
      const { forward, others } = workOrderMoves(status);
      expect([forward, ...others].sort()).toEqual([...workOrderStatusMoves(status)].sort());
      expect(others).not.toContain(forward);
      expect(others).toEqual(
        [...others].sort((a, b) => workOrderStatusRank(a) - workOrderStatusRank(b)),
      );
    }
    // Backwards stays possible: a ready regulator that leaks goes back on the bench.
    expect(workOrderMoves("ready").others).toContain("in_progress");
  });

  it("offers nothing on a collected ticket", () => {
    expect(workOrderMoves("picked_up")).toEqual({ forward: null, others: [] });
  });

  it("takes a shop unit's ticket from the bench straight off it, never through ready", () => {
    // Nobody collects the shop's own regulator: "ready for pickup" is a state
    // it would sit in for no one.
    expect(workOrderMoves("in_progress", "unit").forward).toBe("picked_up");
    for (const status of OPEN_WORK_ORDER_STATUSES) {
      expect(workOrderStatusMoves(status, "unit")).not.toContain("ready");
      expect(canMoveWorkOrder(status, "ready", "unit")).toBe(false);
    }
  });
});

describe("the Work done record", () => {
  it("reads an outcome from a form value and refuses anything else", () => {
    expect(isWorkOrderOutcome("condemned")).toBe(true);
    expect(isWorkOrderOutcome("cancelled")).toBe(false);
  });

  it("asks why only of the outcomes a customer will ask about", () => {
    expect(workOrderOutcomeNeedsNote("unserviceable")).toBe(true);
    expect(workOrderOutcomeNeedsNote("condemned")).toBe(true);
    expect(workOrderOutcomeNeedsNote("done")).toBe(false);
    expect(workOrderOutcomeNeedsNote("declined")).toBe(false);
  });

  it("offers a piece's own clocks, then other work with no clock", () => {
    expect(workOrderCareKinds("regulator")).toEqual(["service", "note"]);
    expect(workOrderCareKinds("tank")).toEqual([
      "visual_inspection",
      "hydro_test",
      "o2_clean",
      "note",
    ]);
    expect(workOrderCareKinds("wetsuit")).toEqual(["note"]);
  });
});

describe("the next-due date a Work done row is prefilled with", () => {
  const performedOn = "2026-10-08";

  it("counts from the day the work was performed", () => {
    expect(
      suggestCareDueOn({
        subject: "customer",
        itemKind: "regulator",
        careKind: "service",
        performedOn: "2026-09-01",
      }),
    ).toBe("2027-09-01");
  });

  it("never suggests a date for a cylinder, customer's or the shop's", () => {
    for (const careKind of ["visual_inspection", "hydro_test", "o2_clean"] as const) {
      for (const subject of ["customer", "unit"] as const) {
        expect(suggestCareDueOn({ subject, itemKind: "tank", careKind, performedOn })).toBeNull();
      }
    }
  });

  it("carries a shop unit's own interval forward, a tank's included", () => {
    expect(
      suggestCareDueOn({
        subject: "unit",
        itemKind: "regulator",
        careKind: "service",
        performedOn,
        previous: { servicedOn: "2026-01-15", nextDueOn: "2026-07-15" },
      }),
    ).toBe("2027-04-08");
    // A tank's interval is the tank's own, typed by whoever inspected it last.
    expect(
      suggestCareDueOn({
        subject: "unit",
        itemKind: "tank",
        careKind: "hydro_test",
        performedOn,
        previous: { servicedOn: "2021-10-08", nextDueOn: "2026-10-08" },
      }),
    ).toBe("2031-10-08");
  });

  it("suggests nothing for a customer's computer, torch or other piece", () => {
    for (const itemKind of ["dive_computer", "torch", "other"] as const) {
      expect(
        suggestCareDueOn({ subject: "customer", itemKind, careKind: "service", performedOn }),
      ).toBeNull();
    }
  });

  it("suggests nothing for other work", () => {
    expect(
      suggestCareDueOn({ subject: "unit", itemKind: "regulator", careKind: "note", performedOn }),
    ).toBeNull();
  });

  it("carries only whole-month intervals", () => {
    expect(wholeMonthsBetween("2026-01-15", "2027-01-15")).toBe(12);
    expect(wholeMonthsBetween("2026-01-15", "2026-03-02")).toBeNull();
    expect(wholeMonthsBetween("2026-03-02", "2026-01-15")).toBeNull();
  });
});

describe("a customer's piece's dates", () => {
  it("gives a cylinder its two compliance dates and no service date", () => {
    expect(customerDueFields("tank")).toEqual(["inspectionDueOn", "hydroDueOn"]);
    expect(customerDueFields("regulator")).toEqual(["serviceDueOn"]);
  });

  it("sets the date matching the care performed", () => {
    expect(customerDueField("service")).toBe("serviceDueOn");
    expect(customerDueField("visual_inspection")).toBe("inspectionDueOn");
    expect(customerDueField("hydro_test")).toBe("hydroDueOn");
    expect(customerDueField("o2_clean")).toBeNull();
    expect(customerDueField("note")).toBeNull();
  });
});

describe("workOrderReturnsUnitToService", () => {
  it("returns a unit only when every check passed and one of them answers its concern", () => {
    expect(workOrderReturnsUnitToService("regulator", [{ kind: "service", passed: true }])).toBe(
      true,
    );
    expect(
      workOrderReturnsUnitToService("tank", [
        { kind: "visual_inspection", passed: true },
        { kind: "hydro_test", passed: false },
      ]),
    ).toBe(false);
    // A note on a regulator is not a service.
    expect(workOrderReturnsUnitToService("regulator", [{ kind: "note", passed: true }])).toBe(
      false,
    );
    expect(workOrderReturnsUnitToService("regulator", [])).toBe(false);
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
