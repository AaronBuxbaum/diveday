import type { DbExecutor } from "./client";
import { orderLineItems, orders, type people } from "./schema";
import { at } from "./seed-clock";

/**
 * The billing states past "paid".
 *
 * `seed-history.ts` already back-fills a trailing quarter of invoices — three
 * hundred of them — so the orders index is anything but empty. Every single one
 * is `paid`, though, and every one is a trip fee or a deposit against a
 * booking. That makes four of the five statuses in `orderStatus`, six of the
 * eight line-item kinds, and the whole idea of an order that isn't attached to
 * a seat unreachable from the demo: pick "Refunded" in the index's status
 * filter and a shop with three hundred invoices shows you an empty page.
 *
 * This scenario adds the missing shapes and nothing else — a dozen rows, not a
 * second pile of paid ones:
 *
 * - **open**, still owed, at three ages so the list isn't all one day;
 * - **open and part-paid**, where `amount_paid_cents` sits between zero and the
 *   total (the closest this data model comes to a partial refund — a refund is
 *   all-or-nothing here, see `refundOrder`);
 * - **refunded**, the state the refund flow leaves behind;
 * - **void**, an invoice raised and cancelled before it was ever paid;
 * - **uncollectible**, the one a shop eventually writes off;
 * - **paid retail**, standing in for the counter sales a dive shop actually
 *   rings up — a mask, a week of rental kit, nitrox fills, a replacement weight
 *   belt — which is where the `merchandise`, `rental`, `nitrox`, `course_fee`
 *   and `e_learning_fee` line kinds finally appear.
 *
 * **Every row here stands alone: `booking_id` is null.** That is deliberate and
 * load-bearing, not a shortcut. `applyOrderUpdate` cascades a paid or refunded
 * *booking-linked* order onto that booking's payment gate, so a seeded refunded
 * order hung off a seat would quietly contradict the `booking_payments` row the
 * bookings scenario wrote for it, and could move who may board today's wreck
 * charter. A standalone order is the honest shape for a retail sale anyway
 * (`orders.booking_id` is nullable precisely for it), and it still reaches
 * everything this is meant to fill: the index, its status filter, and the diver
 * record's payments section, which reads `listOrdersForPerson` by person.
 *
 * The Stripe ids are fabricated, the same convention `seed-history.ts` and the
 * seeded tips already use — the demo never connects an account, which is why
 * the order page disables Refresh/Void/Refund on a demo shop. They carry the
 * shop id so a fleet of minted demo shops can never collide on the global
 * `orders_stripe_invoice_unique` index.
 *
 * Dated inside `ORDER_DEFAULT_RANGE_DAYS` so every one of them is visible
 * without the index's "show all" escape hatch.
 */

type SeedOrderPlan = {
  /** Index into the seeded customer cast — whose order this is. */
  customer: number;
  status: "open" | "paid" | "void" | "uncollectible" | "refunded";
  totalCents: number;
  /** What has actually been collected. Below the total on a part-paid order. */
  paidCents: number;
  daysAgo: number;
  description: string;
  lines: {
    kind: "trip_fee" | "course_fee" | "e_learning_fee" | "rental" | "nitrox" | "merchandise";
    description: string;
    quantity: number;
    unitAmountCents: number;
  }[];
};

const ORDER_PLANS: SeedOrderPlan[] = [
  // Still owed. Three ages, so "open" is a list rather than a single row.
  {
    customer: 11,
    status: "open",
    totalCents: 34_000,
    paidCents: 0,
    daysAgo: 2,
    description: "Open Water course — remaining balance",
    lines: [
      { kind: "course_fee", description: "Open Water Diver", quantity: 1, unitAmountCents: 28_500 },
      {
        kind: "e_learning_fee",
        description: "Agency e-learning code",
        quantity: 1,
        unitAmountCents: 5_500,
      },
    ],
  },
  {
    customer: 14,
    status: "open",
    totalCents: 9_000,
    paidCents: 0,
    daysAgo: 9,
    description: "Weekend rental kit",
    lines: [
      { kind: "rental", description: "Full set, three days", quantity: 3, unitAmountCents: 3_000 },
    ],
  },
  {
    customer: 16,
    status: "open",
    totalCents: 4_800,
    paidCents: 0,
    daysAgo: 26,
    description: "Nitrox fills",
    lines: [{ kind: "nitrox", description: "EANx32 fill", quantity: 4, unitAmountCents: 1_200 }],
  },
  // Part-paid: a deposit landed, the balance has not.
  {
    customer: 12,
    status: "open",
    totalCents: 39_000,
    paidCents: 12_000,
    daysAgo: 5,
    description: "Advanced Open Water — deposit paid, balance due",
    lines: [
      {
        kind: "course_fee",
        description: "Advanced Open Water",
        quantity: 1,
        unitAmountCents: 33_000,
      },
      { kind: "rental", description: "Course kit hire", quantity: 1, unitAmountCents: 6_000 },
    ],
  },
  {
    customer: 17,
    status: "open",
    totalCents: 24_000,
    paidCents: 18_000,
    daysAgo: 17,
    description: "Two-tank charter — part settled at the desk",
    lines: [
      { kind: "trip_fee", description: "Two-tank charter", quantity: 2, unitAmountCents: 12_000 },
    ],
  },
  // Refunded — the state the refund flow leaves behind.
  {
    customer: 13,
    status: "refunded",
    totalCents: 12_000,
    paidCents: 12_000,
    daysAgo: 12,
    description: "Two-tank charter — refunded after a blown-out morning",
    lines: [
      { kind: "trip_fee", description: "Two-tank charter", quantity: 1, unitAmountCents: 12_000 },
    ],
  },
  {
    customer: 15,
    status: "refunded",
    totalCents: 19_500,
    paidCents: 19_500,
    daysAgo: 33,
    description: "Nitrox course — refunded, student rescheduled",
    lines: [
      {
        kind: "course_fee",
        description: "Enriched Air Diver",
        quantity: 1,
        unitAmountCents: 19_500,
      },
    ],
  },
  // Raised and cancelled before anyone paid it.
  {
    customer: 18,
    status: "void",
    totalCents: 7_500,
    paidCents: 0,
    daysAgo: 21,
    description: "Duplicate invoice, cancelled",
    lines: [
      {
        kind: "trip_fee",
        description: "Afternoon single tank",
        quantity: 1,
        unitAmountCents: 7_500,
      },
    ],
  },
  // Chased, then written off.
  {
    customer: 19,
    status: "uncollectible",
    totalCents: 6_000,
    paidCents: 0,
    daysAgo: 58,
    description: "Gear hire — written off after three reminders",
    lines: [
      { kind: "rental", description: "BCD and regulator", quantity: 2, unitAmountCents: 3_000 },
    ],
  },
  // Counter sales. Where the retail line kinds finally show up.
  {
    customer: 10,
    status: "paid",
    totalCents: 14_800,
    paidCents: 14_800,
    daysAgo: 1,
    description: "Counter sale",
    lines: [
      { kind: "merchandise", description: "Low-volume mask", quantity: 1, unitAmountCents: 8_900 },
      {
        kind: "merchandise",
        description: "Blue Mantis rash guard",
        quantity: 1,
        unitAmountCents: 5_900,
      },
    ],
  },
  {
    customer: 3,
    status: "paid",
    totalCents: 3_600,
    paidCents: 3_600,
    daysAgo: 4,
    description: "Nitrox fills",
    lines: [{ kind: "nitrox", description: "EANx32 fill", quantity: 3, unitAmountCents: 1_200 }],
  },
  {
    customer: 6,
    status: "paid",
    totalCents: 4_500,
    paidCents: 4_500,
    daysAgo: 8,
    description: "Replacement weight belt",
    lines: [
      {
        kind: "merchandise",
        description: "Weight belt and four kilos",
        quantity: 1,
        unitAmountCents: 4_500,
      },
    ],
  },
];

export async function seedOrders(
  db: DbExecutor,
  shopId: string,
  ctx: {
    customers: (typeof people.$inferSelect)[];
    /** Who raised them — the same staff member the history back-fill invoices under. */
    createdByPersonId: string;
  },
): Promise<void> {
  const rows = ORDER_PLANS.map((plan, index) => {
    const person = ctx.customers[plan.customer];
    if (!person) return null;
    const raisedAt = at(-plan.daysAgo, 10, (index * 7) % 60);
    const settledAt = new Date(raisedAt.getTime() + 45 * 60 * 1000);
    return {
      plan,
      row: {
        shopId,
        bookingId: null,
        personId: person.id,
        createdByPersonId: ctx.createdByPersonId,
        status: plan.status,
        currency: "usd",
        totalCents: plan.totalCents,
        amountPaidCents: plan.paidCents,
        description: plan.description,
        stripeAccountId: "acct_demo",
        stripeCustomerId: `cus_demo_${shopId}_state_${index}`,
        stripeInvoiceId: `in_demo_${shopId}_state_${index}`,
        finalizedAt: raisedAt,
        paidAt: plan.status === "paid" || plan.status === "refunded" ? settledAt : null,
        voidedAt: plan.status === "void" ? settledAt : null,
        refundedAt:
          plan.status === "refunded" ? new Date(settledAt.getTime() + 36 * 60 * 60 * 1000) : null,
        createdAt: raisedAt,
        updatedAt: settledAt,
      },
    };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (rows.length === 0) return;

  const inserted = await db
    .insert(orders)
    .values(rows.map(({ row }) => row))
    .returning({ id: orders.id });

  await db.insert(orderLineItems).values(
    inserted.flatMap((order, index) => {
      const plan = rows[index]?.plan;
      if (!plan) return [];
      return plan.lines.map((line) => ({
        shopId,
        orderId: order.id,
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unitAmountCents: line.unitAmountCents,
      }));
    }),
  );
}
