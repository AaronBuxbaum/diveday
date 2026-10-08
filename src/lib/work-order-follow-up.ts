import { type CalendarDate, calendarDaysBetween, shiftCalendarDate } from "./calendar-date";
import type { GearItemKind, GearServiceKind } from "./gear";
import {
  type CustomerDueField,
  customerDueFields,
  WORK_ORDER_QUANTITY_SCALE,
  type WorkOrderStatus,
  workOrderLineTotalCents,
} from "./work-orders";

/**
 * What the bench owes a customer once the work is done, framework-free (ADR
 * 20261008-work-order-follow-up): when a service reminder is due, when a
 * ticket has gone past its promise or sat ready too long, and how parts and
 * labor become an order's lines.
 */

/** How far ahead of a due date a customer hears about it (owner decision 2026-10-08: about a month). */
export const SERVICE_REMINDER_LEAD_DAYS = 30;

/**
 * Days a ticket may sit ready before Today asks whether anybody told the
 * customer. A week: long enough that an ordinary "I'll come Saturday" never
 * raises it, short enough that a regulator forgotten on the shelf is asked
 * about while the customer still remembers leaving it.
 */
export const READY_UNCOLLECTED_DAYS = 7;

/** One date a customer's piece is due on, and which of its clocks that is. */
export type CustomerGearDueDate = { clock: GearServiceKind; dueOn: CalendarDate };

/** The clock each of a customer piece's dates is, in the words a reminder uses. */
const DUE_FIELD_CLOCK: Record<CustomerDueField, GearServiceKind> = {
  serviceDueOn: "service",
  inspectionDueOn: "visual_inspection",
  hydroDueOn: "hydro_test",
};

/**
 * **Every due date a customer's piece carries, the one place that reads them.**
 *
 * A reminder is sent per entry this returns, keyed by its clock: a cylinder's
 * visual inspection and hydro test are two dates and two reminders, every
 * other kind its one service date. Which dates a kind has is layer 1's rule
 * (`customerDueFields`); a date on a field the kind does not have is ignored.
 */
export function customerGearDueDates(piece: {
  kind: GearItemKind;
  serviceDueOn: string | null;
  inspectionDueOn: string | null;
  hydroDueOn: string | null;
}): CustomerGearDueDate[] {
  return customerDueFields(piece.kind).flatMap((field) => {
    const dueOn = piece[field];
    return dueOn ? [{ clock: DUE_FIELD_CLOCK[field], dueOn: dueOn as CalendarDate }] : [];
  });
}

/**
 * Whether a reminder about `dueOn` belongs in today's pass: from
 * {@link SERVICE_REMINDER_LEAD_DAYS} ahead up to the day itself. A date
 * already gone is never reminded about — "your regulator was due last week"
 * is a different message, and a stale date somebody forgot to clear is not a
 * reason to text a customer.
 */
export function serviceReminderIsDue(dueOn: CalendarDate, todayLocal: CalendarDate): boolean {
  if (dueOn < todayLocal) return false;
  return dueOn <= shiftCalendarDate(todayLocal, SERVICE_REMINDER_LEAD_DAYS);
}

/**
 * A ticket still on the bench after the day the shop promised it. Ready is
 * deliberately not counted: the work is done, and whether the customer knows
 * is {@link workOrderIsUncollected}'s question, asked on its own clock.
 */
export function workOrderIsPastPromise(input: {
  status: WorkOrderStatus;
  promisedOn: string | null;
  todayLocal: CalendarDate;
}): boolean {
  if (!input.promisedOn) return false;
  if (input.status === "ready" || input.status === "picked_up") return false;
  return input.promisedOn < input.todayLocal;
}

/** A ticket ready for {@link READY_UNCOLLECTED_DAYS} days or more and still not collected. */
export function workOrderIsUncollected(input: {
  status: WorkOrderStatus;
  readyOn: CalendarDate | null;
  todayLocal: CalendarDate;
}): boolean {
  if (input.status !== "ready" || !input.readyOn) return false;
  return calendarDaysBetween(input.readyOn, input.todayLocal) >= READY_UNCOLLECTED_DAYS;
}

/**
 * One order line from one ticket line. Orders count whole units
 * (`order_line_items.quantity` is an integer), so a whole quantity crosses as
 * it is and a fractional one — an hour and a half at the bench — becomes one
 * line at the total the ticket already shows, with the quantity handed back so
 * the caller can say it in the description.
 *
 * Every line is `other`: there is no order kind for a part or bench time, and
 * a fitted part is not `merchandise` (retail stays a non-goal).
 */
export type WorkOrderBillLine = {
  kind: "other";
  description: string;
  quantity: number;
  unitAmountCents: number;
  /** The ticket's quantity when it was not whole, for the description; null otherwise. */
  fractionalQuantityHundredths: number | null;
};

export function billLinesForWorkOrder(
  lines: readonly {
    kind: "part" | "labor";
    description: string;
    quantityHundredths: number;
    unitAmountCents: number;
  }[],
): WorkOrderBillLine[] {
  return lines.map((line) => {
    const whole = line.quantityHundredths % WORK_ORDER_QUANTITY_SCALE === 0;
    return whole
      ? {
          kind: "other",
          description: line.description,
          quantity: line.quantityHundredths / WORK_ORDER_QUANTITY_SCALE,
          unitAmountCents: line.unitAmountCents,
          fractionalQuantityHundredths: null,
        }
      : {
          kind: "other",
          description: line.description,
          quantity: 1,
          unitAmountCents: workOrderLineTotalCents(line),
          fractionalQuantityHundredths: line.quantityHundredths,
        };
  });
}

/** The order statuses `orders.status` takes, as far as a ticket's bill cares. */
export type WorkOrderBillStatus =
  | "open"
  | "paid"
  | "void"
  | "uncollectible"
  | "partly_refunded"
  | "refunded";

/**
 * Whether a ticket may be billed again, given its newest bill's status. Once
 * a bill is open or settled the answer is no — a second invoice for the same
 * regulator is how a customer gets charged twice. A voided or written-off
 * bill is no bill, and the shop may send a corrected one.
 */
export function workOrderBillAllowsAnother(status: WorkOrderBillStatus | null): boolean {
  return status === null || status === "void" || status === "uncollectible";
}

/**
 * A staffer's prose made fit for a text: one line, and cut at a word with a
 * mark when it runs long. The email carries the whole of it.
 */
export function shortenForText(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max + 1);
  const cut = head.lastIndexOf(" ");
  return `${(cut > 0 ? head.slice(0, cut) : flat.slice(0, max)).trimEnd()}…`;
}
