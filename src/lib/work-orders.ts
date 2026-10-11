import type { CalendarDate } from "./calendar-date";
import { shiftCalendarDateMonths } from "./calendar-date";
import {
  GEAR_SERVICE_INTERVAL_MONTHS,
  GEAR_SERVICE_KINDS_FOR,
  type GearItemKind,
  type GearServiceKind,
  serviceConcernClearingKinds,
} from "./gear";

/**
 * Service work orders, framework-free (ADR 20261008-gear-work-orders): where a
 * ticket may go, what it adds up to, and when it is late.
 *
 * **No status move ever touches a clock.** A clock moves only from the
 * technician's explicit "Work done" record — which care was performed, whether
 * it passed, on what day, and the next due date they confirmed. What this
 * module offers is the *suggestion* that record's form is prefilled with, and
 * for a cylinder it suggests nothing at all: a tank's compliance dates are
 * typed by the person who did the inspection, every time.
 */

/**
 * Whose gear a ticket is about. A customer's ticket ends with the owner
 * collecting it; a shop unit's ends with the unit going back on the wall, so
 * it never waits in `ready` for somebody to come for it.
 */
export type WorkOrderSubject = "customer" | "unit";

/** Every status, in counter order. */
export const WORK_ORDER_STATUSES = [
  "received",
  "in_progress",
  "waiting_on_parts",
  "ready",
  "picked_up",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

/**
 * The statuses a shop still owes work or a phone call on. Everything but
 * `picked_up`: a ticket waiting on parts is as open as one on the bench, and a
 * ready one is open until the customer has it in their hands.
 */
export const OPEN_WORK_ORDER_STATUSES = [
  "received",
  "in_progress",
  "waiting_on_parts",
  "ready",
] as const satisfies readonly WorkOrderStatus[];

export function isWorkOrderStatus(value: string): value is WorkOrderStatus {
  return (WORK_ORDER_STATUSES as readonly string[]).includes(value);
}

export function isOpenWorkOrderStatus(status: WorkOrderStatus): boolean {
  return status !== "picked_up";
}

/** Board order: open statuses in counter order, collected last. */
export function workOrderStatusRank(status: WorkOrderStatus): number {
  return WORK_ORDER_STATUSES.indexOf(status);
}

/**
 * The statuses a ticket about this subject can ever be in. A shop unit's ticket
 * skips `ready`: nobody collects the shop's own regulator, so "ready for
 * pickup" would be a state it sits in for no one.
 */
export function workOrderStatusesFor(subject: WorkOrderSubject): readonly WorkOrderStatus[] {
  return subject === "unit"
    ? WORK_ORDER_STATUSES.filter((status) => status !== "ready")
    : WORK_ORDER_STATUSES;
}

/**
 * Whether a status move is one the surface may offer.
 *
 * Deliberately permissive among the open statuses, in both directions: bench
 * work goes backwards all the time (a regulator declared ready turns out to
 * leak, a part arrives and the ticket leaves `waiting_on_parts`), and a
 * workflow that refuses that teaches staff to delete the ticket and open
 * another one.
 *
 * The two rules that do hold: a ticket cannot move to the status it is already
 * on, and `picked_up` is the end — the gear is with its owner, so there is
 * nothing on the bench to move. A ticket handed back by mistake is a new
 * ticket, which is the honest record of what happened.
 */
export function canMoveWorkOrder(
  from: WorkOrderStatus,
  to: WorkOrderStatus,
  subject: WorkOrderSubject = "customer",
): boolean {
  if (from === to) return false;
  if (from === "picked_up") return false;
  return workOrderStatusesFor(subject).includes(to);
}

/** The statuses a ticket on `status` may be moved to, in counter order. */
export function workOrderStatusMoves(
  status: WorkOrderStatus,
  subject: WorkOrderSubject = "customer",
): readonly WorkOrderStatus[] {
  return WORK_ORDER_STATUSES.filter((candidate) => canMoveWorkOrder(status, candidate, subject));
}

/**
 * The step the bench takes next from each open status — the one move a ticket
 * page offers as its primary act. A part arriving puts the ticket back on the
 * bench rather than straight to ready, because somebody still has to fit it.
 * A shop unit's ticket goes from the bench straight off it.
 */
const FORWARD_MOVE: Record<WorkOrderSubject, Record<WorkOrderStatus, WorkOrderStatus | null>> = {
  customer: {
    received: "in_progress",
    in_progress: "ready",
    waiting_on_parts: "in_progress",
    ready: "picked_up",
    picked_up: null,
  },
  unit: {
    received: "in_progress",
    in_progress: "picked_up",
    waiting_on_parts: "in_progress",
    ready: "picked_up",
    picked_up: null,
  },
};

/**
 * The moves a ticket page offers, split the way it draws them: the forward
 * step, and every other allowed move in counter order. Backwards stays on
 * offer (`canMoveWorkOrder`), just never as the loudest button.
 */
export function workOrderMoves(
  status: WorkOrderStatus,
  subject: WorkOrderSubject = "customer",
): {
  forward: WorkOrderStatus | null;
  others: readonly WorkOrderStatus[];
} {
  const allowed = workOrderStatusMoves(status, subject);
  const forward = FORWARD_MOVE[subject][status];
  if (forward === null || !allowed.includes(forward)) return { forward: null, others: allowed };
  return { forward, others: allowed.filter((move) => move !== forward) };
}

/**
 * **Late**: the shop said a day and that day has gone, with the gear still
 * here. Measured on the shop's own calendar date, and only while the ticket is
 * open — a collected ticket is history, however late it ran.
 *
 * `ready` counts as late too, and that is the point of asking: the work is
 * done and nobody has told the customer, which is the failure a promised date
 * exists to catch.
 */
export function workOrderIsLate(input: {
  status: WorkOrderStatus;
  promisedOn: CalendarDate | null;
  todayLocal: CalendarDate;
}): boolean {
  if (!input.promisedOn) return false;
  if (!isOpenWorkOrderStatus(input.status)) return false;
  return input.promisedOn < input.todayLocal;
}

/** A quantity is stored times 100 (`work_order_lines.quantity_hundredths`). */
export const WORK_ORDER_QUANTITY_SCALE = 100;

/**
 * One line's total, in the shop's currency minor unit. Integer arithmetic
 * throughout — a quantity of 1.5 is `150`, so the division is the last step
 * and rounds half up, the way a counter does it on paper.
 */
export function workOrderLineTotalCents(line: {
  quantityHundredths: number;
  unitAmountCents: number;
}): number {
  return Math.round((line.quantityHundredths * line.unitAmountCents) / WORK_ORDER_QUANTITY_SCALE);
}

/** What the whole ticket comes to: every live line, parts and labor together. */
export function workOrderTotalCents(
  lines: readonly { quantityHundredths: number; unitAmountCents: number }[],
): number {
  return lines.reduce((sum, line) => sum + workOrderLineTotalCents(line), 0);
}

/**
 * A typed quantity ("2", "1.5", "0.75") as hundredths, or `null` when it is
 * not a quantity at all. Two decimal places is the resolution the column
 * holds, so a third is refused rather than quietly rounded — a staffer who
 * typed it meant it.
 */
export function parseWorkOrderQuantity(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(trimmed)) return null;
  const hundredths = Math.round(Number(trimmed) * WORK_ORDER_QUANTITY_SCALE);
  return hundredths > 0 ? hundredths : null;
}

/** The stored quantity back as digits for a form field ("150" → "1.5"). */
export function workOrderQuantityInput(hundredths: number): string {
  const whole = Math.trunc(hundredths / WORK_ORDER_QUANTITY_SCALE);
  const rest = hundredths % WORK_ORDER_QUANTITY_SCALE;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

// ---------------------------------------------------------------------------
// The "Work done" record
// ---------------------------------------------------------------------------

/** How a job ended. Only `done` carries care, and only care moves a clock. */
export const WORK_ORDER_OUTCOMES = ["done", "declined", "unserviceable", "condemned"] as const;

export type WorkOrderOutcome = (typeof WORK_ORDER_OUTCOMES)[number];

export function isWorkOrderOutcome(value: string): value is WorkOrderOutcome {
  return (WORK_ORDER_OUTCOMES as readonly string[]).includes(value);
}

/**
 * The two outcomes that must say why. "Unserviceable" and "condemned" are the
 * words a customer will ask about, and a condemned shop unit's reason becomes
 * its service note on the register.
 */
export function workOrderOutcomeNeedsNote(outcome: WorkOrderOutcome): boolean {
  return outcome === "unserviceable" || outcome === "condemned";
}

/**
 * The care a technician can record on a piece of this kind: the register's own
 * clocks for it, then `note` — "other work, no clock" — which every kind has.
 */
export function workOrderCareKinds(kind: GearItemKind): readonly GearServiceKind[] {
  const clocks = GEAR_SERVICE_KINDS_FOR[kind].filter((care) => care !== "note");
  return [...clocks, "note"];
}

/**
 * The kinds of a customer's own gear for which the shop suggests a next service
 * date: life support with a manufacturer service. A computer, a torch or
 * anything else gets no suggestion (staff may still set one), and a cylinder
 * never does — its dates are typed by whoever inspected it.
 */
const CUSTOMER_SERVICE_SUGGESTED: ReadonlySet<GearItemKind> = new Set(["regulator", "bcd"]);

/**
 * The next-due date a "Work done" row is prefilled with, counted from the day
 * the work was **performed** (never the day the gear was collected).
 *
 * A shop unit carries its own interval forward: the gap between its last
 * reading of this clock and that reading's due date, so a fleet that runs
 * 6-month regulator service keeps running it. With nothing to carry, a unit
 * borrows the register's convention — except a cylinder, which gets no default
 * clock, ever. A customer's piece gets a suggestion only where
 * `CUSTOMER_SERVICE_SUGGESTED` says so.
 *
 * Always a suggestion: the technician confirms or clears it, and what they
 * confirm is what is written.
 */
export function suggestCareDueOn(input: {
  subject: WorkOrderSubject;
  itemKind: GearItemKind;
  careKind: GearServiceKind;
  performedOn: CalendarDate;
  /** A unit's last reading of this clock, when it has one. */
  previous?: { servicedOn: CalendarDate; nextDueOn: CalendarDate | null } | null;
}): CalendarDate | null {
  if (input.careKind === "note") return null;
  if (input.subject === "unit" && input.previous?.nextDueOn) {
    const months = wholeMonthsBetween(input.previous.servicedOn, input.previous.nextDueOn);
    if (months !== null) return shiftCalendarDateMonths(input.performedOn, months);
  }
  if (input.itemKind === "tank") return null;
  if (input.subject === "customer") {
    if (input.careKind !== "service" || !CUSTOMER_SERVICE_SUGGESTED.has(input.itemKind)) {
      return null;
    }
  }
  const months = GEAR_SERVICE_INTERVAL_MONTHS[input.careKind];
  return months === null ? null : shiftCalendarDateMonths(input.performedOn, months);
}

/**
 * The whole number of months from one date to another, when the second is the
 * first moved by exactly that many months (`shiftCalendarDateMonths`); `null`
 * when the gap is not a whole-month interval, which is then not carried.
 */
export function wholeMonthsBetween(from: CalendarDate, to: CalendarDate): number | null {
  const [fromYear, fromMonth] = from.split("-").map(Number) as [number, number];
  const [toYear, toMonth] = to.split("-").map(Number) as [number, number];
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  if (months <= 0) return null;
  return shiftCalendarDateMonths(from, months) === to ? months : null;
}

/** Which of a customer piece's dates a passed care row sets. */
export type CustomerDueField = "serviceDueOn" | "inspectionDueOn" | "hydroDueOn";

/**
 * The date a passed care row on a customer's piece writes: a service sets the
 * service date, a cylinder's two checks set their own. An O2 clean and other
 * work keep no date on a customer's piece.
 */
export function customerDueField(careKind: GearServiceKind): CustomerDueField | null {
  if (careKind === "service") return "serviceDueOn";
  if (careKind === "visual_inspection") return "inspectionDueOn";
  if (careKind === "hydro_test") return "hydroDueOn";
  return null;
}

/**
 * The dates a customer's piece shows and edits. A cylinder has its two
 * compliance dates and no "service"; everything else has the one.
 */
export function customerDueFields(kind: GearItemKind): readonly CustomerDueField[] {
  return kind === "tank" ? ["inspectionDueOn", "hydroDueOn"] : ["serviceDueOn"];
}

/**
 * Whether a recorded job puts a shop unit back on the wall: every check passed,
 * and among them is the care that answers a service concern on that kind of
 * unit (`serviceConcernClearingKinds`) — a regulator's service, a tank's own
 * inspection, never a note on a regulator.
 */
export function workOrderReturnsUnitToService(
  unitKind: GearItemKind,
  care: readonly { kind: GearServiceKind; passed: boolean }[],
): boolean {
  if (care.length === 0) return false;
  if (care.some((row) => !row.passed)) return false;
  const clearing = serviceConcernClearingKinds(unitKind);
  return care.some((row) => clearing.includes(row.kind));
}

/** How long a staffer's words on a ticket may be, so a textarea and the column agree. */
export const WORK_ORDER_TEXT_LIMITS = {
  reportedProblem: 2000,
  outcomeNote: 1000,
  technicianNotes: 4000,
  workPerformed: 4000,
  lineDescription: 200,
  itemNote: 500,
  brandModel: 120,
  serialNumber: 80,
} as const;

/** The largest amount a line may carry, so a mistyped keypad cannot quote a million. */
export const WORK_ORDER_MAX_UNIT_AMOUNT_CENTS = 1_000_000;
