import { describe, expect, it } from "vitest";
import type { CalendarDate } from "./calendar-date";
import {
  billLinesForWorkOrder,
  customerGearDueDates,
  READY_UNCOLLECTED_DAYS,
  SERVICE_REMINDER_LEAD_DAYS,
  serviceReminderIsDue,
  shortenForText,
  workOrderBillAllowsAnother,
  workOrderIsPastPromise,
  workOrderIsUncollected,
} from "./work-order-follow-up";

const today = "2026-10-08" as CalendarDate;

describe("customerGearDueDates", () => {
  it("reads a regulator's one due date as its service clock", () => {
    expect(customerGearDueDates({ kind: "regulator", serviceDueOn: "2026-11-01" })).toEqual([
      { clock: "service", dueOn: "2026-11-01" },
    ]);
  });

  it("reads a cylinder's date as its visual inspection", () => {
    expect(customerGearDueDates({ kind: "tank", serviceDueOn: "2026-11-01" })).toEqual([
      { clock: "visual_inspection", dueOn: "2026-11-01" },
    ]);
  });

  it("still reminds about a date staff set by hand on a kind with no interval", () => {
    expect(customerGearDueDates({ kind: "wetsuit", serviceDueOn: "2026-11-01" })).toEqual([
      { clock: "service", dueOn: "2026-11-01" },
    ]);
  });

  it("has nothing to remind about without a date", () => {
    expect(customerGearDueDates({ kind: "regulator", serviceDueOn: null })).toEqual([]);
  });
});

describe("serviceReminderIsDue", () => {
  it("is due from a month ahead through the due date itself", () => {
    expect(SERVICE_REMINDER_LEAD_DAYS).toBe(30);
    expect(serviceReminderIsDue("2026-11-07" as CalendarDate, today)).toBe(true);
    expect(serviceReminderIsDue("2026-10-08" as CalendarDate, today)).toBe(true);
  });

  it("waits while the date is more than a month out", () => {
    expect(serviceReminderIsDue("2026-11-08" as CalendarDate, today)).toBe(false);
  });

  it("never reminds about a date already gone", () => {
    expect(serviceReminderIsDue("2026-10-07" as CalendarDate, today)).toBe(false);
  });
});

describe("workOrderIsPastPromise", () => {
  it("flags an open ticket still on the bench after its promised day", () => {
    for (const status of ["received", "in_progress", "waiting_on_parts"] as const) {
      expect(workOrderIsPastPromise({ status, promisedOn: "2026-10-07", todayLocal: today })).toBe(
        true,
      );
    }
  });

  it("does not flag the promised day itself", () => {
    expect(
      workOrderIsPastPromise({ status: "received", promisedOn: today, todayLocal: today }),
    ).toBe(false);
  });

  it("leaves a ready ticket to the uncollected row, and a collected one alone", () => {
    expect(
      workOrderIsPastPromise({ status: "ready", promisedOn: "2026-10-01", todayLocal: today }),
    ).toBe(false);
    expect(
      workOrderIsPastPromise({ status: "picked_up", promisedOn: "2026-10-01", todayLocal: today }),
    ).toBe(false);
  });

  it("has no promise to break without a date", () => {
    expect(
      workOrderIsPastPromise({ status: "received", promisedOn: null, todayLocal: today }),
    ).toBe(false);
  });
});

describe("workOrderIsUncollected", () => {
  it(`asks after a ticket ready for ${READY_UNCOLLECTED_DAYS} days or more`, () => {
    expect(
      workOrderIsUncollected({ status: "ready", readyOn: "2026-10-01", todayLocal: today }),
    ).toBe(true);
    expect(
      workOrderIsUncollected({ status: "ready", readyOn: "2026-10-02", todayLocal: today }),
    ).toBe(false);
  });

  it("only while it is still ready", () => {
    expect(
      workOrderIsUncollected({ status: "in_progress", readyOn: "2026-09-01", todayLocal: today }),
    ).toBe(false);
    expect(workOrderIsUncollected({ status: "ready", readyOn: null, todayLocal: today })).toBe(
      false,
    );
  });
});

describe("billLinesForWorkOrder", () => {
  it("carries a whole quantity straight across", () => {
    expect(
      billLinesForWorkOrder([
        { kind: "part", description: "O-ring kit", quantityHundredths: 200, unitAmountCents: 1250 },
      ]),
    ).toEqual([
      {
        kind: "other",
        description: "O-ring kit",
        quantity: 2,
        unitAmountCents: 1250,
        fractionalQuantityHundredths: null,
      },
    ]);
  });

  it("bills a fractional quantity as one line at its total, and says so", () => {
    expect(
      billLinesForWorkOrder([
        {
          kind: "labor",
          description: "Bench time",
          quantityHundredths: 150,
          unitAmountCents: 6000,
        },
      ]),
    ).toEqual([
      {
        kind: "other",
        description: "Bench time",
        quantity: 1,
        unitAmountCents: 9000,
        fractionalQuantityHundredths: 150,
      },
    ]);
  });

  it("rounds a fractional total half up, the way the ticket shows it", () => {
    const [line] = billLinesForWorkOrder([
      { kind: "labor", description: "Bench", quantityHundredths: 25, unitAmountCents: 1 },
    ]);
    expect(line?.unitAmountCents).toBe(0);
    const [other] = billLinesForWorkOrder([
      { kind: "labor", description: "Bench", quantityHundredths: 50, unitAmountCents: 1 },
    ]);
    expect(other?.unitAmountCents).toBe(1);
  });
});

describe("workOrderBillAllowsAnother", () => {
  it("allows a first bill", () => {
    expect(workOrderBillAllowsAnother(null)).toBe(true);
  });

  it("refuses while a bill is open or already settled", () => {
    for (const status of ["open", "paid", "partly_refunded", "refunded"] as const) {
      expect(workOrderBillAllowsAnother(status)).toBe(false);
    }
  });

  it("allows a new bill once the last one was voided or written off", () => {
    expect(workOrderBillAllowsAnother("void")).toBe(true);
    expect(workOrderBillAllowsAnother("uncollectible")).toBe(true);
  });
});

describe("shortenForText", () => {
  it("leaves short words alone", () => {
    expect(shortenForText("Serviced both stages.", 40)).toBe("Serviced both stages.");
  });

  it("cuts long prose at a word and marks the cut", () => {
    expect(shortenForText("Replaced the HP seat and every o-ring", 20)).toBe(
      "Replaced the HP seat…",
    );
  });

  it("folds line breaks into spaces for a text", () => {
    expect(shortenForText("First stage.\n\nSecond stage.", 80)).toBe("First stage. Second stage.");
  });
});
