/**
 * **What the departure itself still owes, as a fix-list row** (ADR
 * 20261117-trip-page-clock; issue #4685). Pure: the counts come from the boat's
 * work (`src/features/boat-work`), the words and the door from the Trip page.
 */

/** The phase a fix list is drawn for, as the Trip page names it. */
export type DepartureFixPhase = "filling" | "ready" | "checkin" | "listed";

/**
 * **Open orders for this departure** (Aaron, 2026-11-19): orders still awaiting
 * payment are desk work for the owner while the boat fills and for the front
 * desk the day before, so they are one row in Filling and in Getting ready,
 * opening those orders. At Check-in the desk takes each guest's money at their
 * own row, and once the boat has left the list is only a record. An order
 * never holds a guest up, so the row is worth a minute, never a blocker.
 */
export function openOrdersFix(
  openOrders: number,
  phase: DepartureFixPhase,
): { count: number } | null {
  if (openOrders <= 0) return null;
  return phase === "filling" || phase === "ready" ? { count: openOrders } : null;
}
