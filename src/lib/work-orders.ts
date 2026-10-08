import type { CalendarDate } from "./calendar-date";
import { shiftCalendarDateMonths } from "./calendar-date";
import {
  GEAR_SERVICE_INTERVAL_MONTHS,
  GEAR_SERVICE_KINDS_FOR,
  type GearItemKind,
  type GearServiceKind,
} from "./gear";

/**
 * Service work orders, framework-free (ADR 20261008-gear-work-orders): where a
 * ticket may go, what it adds up to, and when it is late.
 *
 * Everything about *care intervals* is borrowed rather than restated — a
 * finished ticket's next deadline comes from the register's own
 * `GEAR_SERVICE_INTERVAL_MONTHS`, so a shop reads one convention whether the
 * regulator is theirs or a customer's.
 */

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
export function canMoveWorkOrder(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  if (from === to) return false;
  if (from === "picked_up") return false;
  return true;
}

/** The statuses a ticket on `status` may be moved to, in counter order. */
export function workOrderStatusMoves(status: WorkOrderStatus): readonly WorkOrderStatus[] {
  return WORK_ORDER_STATUSES.filter((candidate) => canMoveWorkOrder(status, candidate));
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

/** Parts and labor subtotals, for a ticket that wants to show its working. */
export function workOrderSubtotalsCents(
  lines: readonly { kind: "part" | "labor"; quantityHundredths: number; unitAmountCents: number }[],
): { parts: number; labor: number } {
  return {
    parts: workOrderTotalCents(lines.filter((line) => line.kind === "part")),
    labor: workOrderTotalCents(lines.filter((line) => line.kind === "labor")),
  };
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

/**
 * Which of the register's service clocks a piece of this kind runs, when it
 * runs one with an interval. A regulator's `service`, a cylinder's visual
 * inspection; soft goods run none, so a finished ticket on a wetsuit sets no
 * next date and nobody is reminded about a wetsuit.
 */
export function workOrderServiceClock(kind: GearItemKind): GearServiceKind | null {
  for (const clock of GEAR_SERVICE_KINDS_FOR[kind]) {
    if (GEAR_SERVICE_INTERVAL_MONTHS[clock] !== null) return clock;
  }
  return null;
}

/**
 * The next-service date a finished ticket suggests for a customer's piece —
 * the register's own interval for that kind of clock, counted from the day the
 * work was done. A suggestion, like the fleet's: staff own the date, and may
 * edit or clear it (`src/lib/gear.ts`, `suggestNextDueOn`).
 */
export function suggestCustomerServiceDueOn(
  kind: GearItemKind,
  finishedOn: CalendarDate,
): CalendarDate | null {
  const clock = workOrderServiceClock(kind);
  if (!clock) return null;
  const months = GEAR_SERVICE_INTERVAL_MONTHS[clock];
  if (months === null) return null;
  return shiftCalendarDateMonths(finishedOn, months);
}

/** How long a staffer's words on a ticket may be, so a textarea and the column agree. */
export const WORK_ORDER_TEXT_LIMITS = {
  reportedProblem: 2000,
  technicianNotes: 4000,
  workPerformed: 4000,
  lineDescription: 200,
  itemNote: 500,
  brandModel: 120,
  serialNumber: 80,
} as const;

/** The largest amount a line may carry, so a mistyped keypad cannot quote a million. */
export const WORK_ORDER_MAX_UNIT_AMOUNT_CENTS = 1_000_000;
