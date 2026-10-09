/**
 * **Where a month's money came from, line by line** (owner decision
 * 2026-10-09, the Reports brief). Pure: the db layer
 * (`src/db/report-lines.ts`) hands up each paid order line and each completed
 * booking checkout's per-seat amounts with the share the shop kept, and every
 * rule about which line a charge belongs on and how a refund nets out lives
 * here.
 *
 * The basis is **money paid in the calendar month**, not the departures the
 * headline revenue is anchored to: a gear-bench job, a retail sale and a
 * package have no departure, and a line that could only ever read zero would
 * be the wrong answer to "what earns this shop its money?". A refund comes off
 * the same line it was paid on, pro rata, because a refund is recorded against
 * the whole order or checkout, not against one of its lines.
 */

/** The lines, in the order the page reads them. */
export const REVENUE_LINES = [
  "courses",
  "funDives",
  "rentals",
  "gearBench",
  "packages",
  "retail",
] as const;
export type RevenueLine = (typeof REVENUE_LINES)[number];

/** An order line's kind, as `order_line_items.kind` stores it. */
export type OrderLineKind =
  | "trip_fee"
  | "course_fee"
  | "e_learning_fee"
  | "rental"
  | "nitrox"
  | "deposit"
  | "dive_package"
  | "pass_through_fee"
  | "merchandise"
  | "other";

/**
 * Which line one invoice line lands on, or null for money that is not the
 * shop's (a pass-through fee collected for a park or a marine reserve).
 *
 * An invoice raised to bill a gear-bench job is the gear bench's whole, so its
 * parts and labour do not read as retail. A trip fee, its nitrox and its
 * deposit follow the departure: on a course's session they are course money.
 */
export function revenueLineForOrderItem(
  kind: OrderLineKind,
  context: { workOrder: boolean; courseTrip: boolean },
): RevenueLine | null {
  if (kind === "pass_through_fee") return null;
  if (context.workOrder) return "gearBench";
  switch (kind) {
    case "course_fee":
    case "e_learning_fee":
      return "courses";
    case "trip_fee":
    case "nitrox":
    case "deposit":
      return context.courseTrip ? "courses" : "funDives";
    case "rental":
      return "rentals";
    case "dive_package":
      return "packages";
    case "merchandise":
    case "other":
      return "retail";
  }
}

/** One charge's pre-tax amount, and the share of it the shop kept. */
export type RevenueLinePart = {
  line: RevenueLine;
  /** Pre-tax minor units, as billed. */
  cents: number;
  /** In [0, 1]: what is left after refunds (and, on a checkout, any discount). */
  keptRatio: number;
};

const clampRatio = (ratio: number): number =>
  Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;

/**
 * What an invoice kept of each line. `amount_paid_cents` is already net of
 * refunds and `total_cents` carries the tax on the same lines, so their ratio
 * scales a pre-tax line to its kept pre-tax share.
 */
export function orderKeptRatio(order: { amountPaidCents: number; totalCents: number }): number {
  return order.totalCents > 0 ? clampRatio(order.amountPaidCents / order.totalCents) : 0;
}

/**
 * What a completed booking checkout kept of each seat's amounts.
 *
 * The seat amounts are the pre-tax ask; what Stripe settled, less the tax it
 * reported, is what was actually charged for them once a promotion came off;
 * and a refund recorded against the session comes off in proportion. With no
 * settled figure the ask stands, so an older row contributes what it asked.
 */
export function checkoutKeptRatio(checkout: {
  totalCents: number;
  settledTotalCents: number | null;
  taxCents: number | null;
  refundedCents: number;
}): number {
  if (checkout.totalCents <= 0) return 0;
  const settled = checkout.settledTotalCents ?? checkout.totalCents;
  if (settled <= 0) return 0;
  const charged = (settled - (checkout.taxCents ?? 0)) / checkout.totalCents;
  const kept = 1 - checkout.refundedCents / settled;
  return clampRatio(charged) * clampRatio(kept);
}

/**
 * The month's money by line, in `REVENUE_LINES` order, with every line that
 * came to nothing left out: a shop that sells no packages has no Packages line
 * reading $0, which would be a line about something that did not happen.
 */
export function revenueByLine(
  parts: readonly RevenueLinePart[],
): Array<{ line: RevenueLine; cents: number }> {
  const totals = new Map<RevenueLine, number>();
  for (const part of parts) {
    const kept = Math.round(part.cents * clampRatio(part.keptRatio));
    totals.set(part.line, (totals.get(part.line) ?? 0) + kept);
  }
  return REVENUE_LINES.flatMap((line) => {
    const cents = totals.get(line) ?? 0;
    return cents > 0 ? [{ line, cents }] : [];
  });
}

/**
 * What one unused package dive is worth: the package's price over its dives.
 * The order line's price, not today's price list, because that is what the
 * diver paid; a shop that raises its price next season does not owe last
 * season's buyers more.
 */
export function packageDiveValueCents(line: {
  unitAmountCents: number;
  diveCount: number;
}): number {
  return line.diveCount > 0 ? Math.round(line.unitAmountCents / line.diveCount) : 0;
}
