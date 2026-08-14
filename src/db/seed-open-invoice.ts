import type { DbExecutor } from "./client";
import { type bookings, orderLineItems, orders, type people, type trips } from "./schema";
import { at } from "./seed-clock";

/**
 * One unpaid seat on today's reef boat.
 *
 * The trip Overview's pulse states "N orders are awaiting payment" whenever a
 * departure has open orders (`countOpenTripOrders`), and no seeded departure
 * ever had one — so that fact rendered nowhere. Not on screen for somebody
 * evaluating DiveDay, not in a screenshot, and not in a test that could click
 * it: `e2e/trips.spec.ts` had to reconstruct the link's URL because the fact
 * that produces it was not on the page.
 *
 * The seed had both halves and never crossed them. `seed-orders.ts` writes five
 * `open` orders and sets `bookingId: null` on every one, deliberately — read its
 * comment: a booking-linked *paid* or *refunded* order cascades onto that
 * booking's payment gate through `applyOrderUpdate`, and a seeded one would
 * contradict the `booking_payments` row the bookings scenario already wrote.
 * `seed-history.ts` writes booking-linked orders, and all of them are `paid` on
 * departures that already sailed.
 *
 * `open` is the state that is safe to cross the two: `applyOrderUpdate` cascades
 * on *settlement*, and an open invoice settles nothing. So this row is visible
 * to the pulse, to the Orders index, and to the diver's own payments section,
 * while changing no readiness count, no head count, and no payment gate.
 *
 * Exactly one row, on purpose. The pulse states a count, and one seat proves the
 * fact, the link, and the filtered index it opens. A pile of unpaid seats would
 * also change what the Today queue and the Orders index look like in every
 * screenshot that includes them — and the Orders index is already the surface
 * that taught this repo what an unbounded list costs.
 *
 * Its own module rather than a few lines inside `seed-orders.ts`, per ADR
 * 20260803-seed-scenario-modules: that file is the repo's top conflict magnet,
 * and the guarantee it makes about `bookingId` is exactly the kind of invariant
 * a wedged-in exception erodes.
 */
/**
 * The invoice's own description. Exported so the test that pins "this row must
 * not lead the Orders index" names the same row the seed writes, rather than a
 * copy of the string that can drift out from under it.
 */
export const OPEN_INVOICE_DESCRIPTION = "Two-tank charter — balance due";

export async function seedOpenInvoice(
  db: DbExecutor,
  shopId: string,
  ctx: {
    /** Today's reef departure — the boat a demo actually opens. */
    trip: typeof trips.$inferSelect;
    /** That departure's roster, in seating order. */
    roster: (typeof bookings.$inferSelect)[];
    divers: (typeof people.$inferSelect)[];
    /** Who raised the invoice, same as every other seeded order. */
    createdByPersonId: string;
  },
): Promise<void> {
  // The fourth seat rather than the first: the leading rows already carry the
  // desk trail's notes and the buddy teams, and stacking every seeded story on
  // one diver makes the roster read as though nothing happens to anybody else.
  const booking = ctx.roster.filter((row) => row.tripId === ctx.trip.id)[3];
  if (!booking) return;
  const diver = ctx.divers.find((person) => person.id === booking.personId);
  if (!diver) return;

  // Not today: "today at 10:00" is still in the future for anyone who opens the
  // demo before the boat leaves, and an invoice dated in the future reads as a
  // bug rather than as an unpaid seat.
  //
  // Three days back rather than one, and that is load-bearing rather than
  // arbitrary. `seed-orders.ts` already raises an order one day back, and the
  // Orders index sorts on `created_at`, which is **not unique** across the seed
  // (its own paging comment says so). Dated yesterday this row tied with that
  // one for the first row of the index — which is the row `e2e/visual.spec.ts`
  // clicks through to build the `order-detail` capture. So it silently took that
  // capture over, replacing a *paid* counter sale showing "Refund payment" with
  // this open one, and left which of the two won resting on a minute value in a
  // sibling module. `daysAgo: 3` is unoccupied by any existing plan, so this row
  // lands in the middle of the index where nothing is anchored to it.
  const raisedAt = at(-3, 14, 5);

  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      bookingId: booking.id,
      personId: diver.id,
      createdByPersonId: ctx.createdByPersonId,
      status: "open",
      currency: "usd",
      totalCents: 17_500,
      amountPaidCents: 0,
      description: OPEN_INVOICE_DESCRIPTION,
      stripeAccountId: "acct_demo",
      stripeCustomerId: `cus_demo_${shopId}_open_seat`,
      stripeInvoiceId: `in_demo_${shopId}_open_seat`,
      finalizedAt: raisedAt,
      paidAt: null,
      voidedAt: null,
      refundedAt: null,
      createdAt: raisedAt,
      updatedAt: raisedAt,
    })
    .returning({ id: orders.id });
  if (!order) return;

  await db.insert(orderLineItems).values([
    {
      shopId,
      orderId: order.id,
      kind: "trip_fee",
      description: "Two-tank reef charter",
      quantity: 1,
      unitAmountCents: 14_000,
    },
    {
      shopId,
      orderId: order.id,
      kind: "rental",
      description: "Full rental set",
      quantity: 1,
      unitAmountCents: 3_500,
    },
  ]);
}
