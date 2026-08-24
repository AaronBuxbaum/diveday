import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { majorToMinor } from "@/lib/money";
import { type InvoicingProvider, invoicingProviderFromEnvironment } from "@/lib/payments/invoicing";
import { canPersonManageOrders } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  STALE_AFTER_MS,
  startPaymentOperation,
} from "./payment-operations";
import { setBookingPayment, setBookingPaymentIfNotFinal } from "./payments";
import type { Order, OrderLineItemKind, OrderStatus, PaymentOperationIntent } from "./schema";
import {
  bookings,
  courses,
  orderLineItemKind,
  orderLineItems,
  orders,
  paymentOperationIntents,
  people,
  trips,
} from "./schema";
import { canAcceptPayments, getShopCurrency, getShopStripeAccount } from "./stripe-accounts";

export type NewOrderLineItem = {
  kind: OrderLineItemKind;
  /**
   * The words that go on the invoice, composed by the caller from its own
   * message bundle (docs ADR 20260731-domain-layer-copy-leaks) — this layer
   * never writes a sentence.
   *
   * Persisted verbatim into `order_line_items.description` and sent to Stripe.
   * That is deliberate and permanent: once the invoice is finalized, Stripe's
   * hosted page and PDF carry this exact wording forever, so the stored string
   * is a **frozen record of what was billed**, not a label to re-translate
   * later. Re-rendering it in a different language after the fact would make
   * DiveDay's copy of the invoice disagree with the diver's.
   */
  description: string;
  quantity: number;
  /** An integer count of the shop currency's minor unit — never a major-unit float. */
  unitAmountCents: number;
};

export type NewOrderInput = {
  shopId: string;
  personId: string;
  /**
   * The staff member raising this invoice — provenance on the order row *and*
   * the actor `createOrder` authorizes, so it is never a stand-in id.
   */
  createdByPersonId: string;
  bookingId?: string | null;
  description?: string | null;
  lineItems: NewOrderLineItem[];
};

export type CreateOrderOutcome =
  | { ok: true; order: Order }
  | { ok: false; reason: "not_authorized" | "not_connected" | "invalid" | "stripe_failed" };

// Defense-in-depth bounds (CR-016) matching the action-layer zod schema in
// src/app/shop/[shopSlug]/orders/new/actions.ts, so a caller that bypasses that
// form (a direct createOrder call, a future admin tool) can't persist an
// out-of-bounds line item either.
const MAX_LINE_ITEM_QUANTITY = 100;
/** In *major* units, so the ceiling means the same thing in every currency. */
export const MAX_LINE_ITEM_UNIT_AMOUNT_MAJOR = 100_000;
const MAX_LINE_ITEM_DESCRIPTION_LENGTH = 200;
const MAX_LINE_ITEMS_PER_ORDER = 20;
// Same bound the action's zod schema enforces; the two layers must agree
// (CR-016 pattern, like the per-line description bound below).
const MAX_ORDER_DESCRIPTION_LENGTH = 200;
const orderLineItemKindValues = new Set<string>(orderLineItemKind.enumValues);

/**
 * The line-item ceiling in the shop currency's own minor units. Derived from a
 * major-unit constant rather than a literal `100_000 * 100`, so a zero-decimal
 * currency gets the same ¥100,000 ceiling a two-decimal one gets at $100,000
 * — not a hundred times looser (docs ADR 20260731-shop-currency).
 */
export function maxLineItemUnitAmountCents(currency: string): number {
  return majorToMinor(MAX_LINE_ITEM_UNIT_AMOUNT_MAJOR, currency);
}

function lineItemIsValid(item: NewOrderLineItem, maxUnitAmountCents: number): boolean {
  return (
    orderLineItemKindValues.has(item.kind) &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= MAX_LINE_ITEM_QUANTITY &&
    Number.isInteger(item.unitAmountCents) &&
    item.unitAmountCents >= 0 &&
    item.unitAmountCents <= maxUnitAmountCents &&
    item.description.trim().length > 0 &&
    item.description.length <= MAX_LINE_ITEM_DESCRIPTION_LENGTH
  );
}

function mapStripeStatus(stripeStatus: string): OrderStatus {
  if (stripeStatus === "paid" || stripeStatus === "void" || stripeStatus === "uncollectible") {
    return stripeStatus;
  }
  return "open";
}

/**
 * Build and send an order/invoice on the shop's connected Stripe account,
 * then persist the local order + line items. Fails closed: an unauthorized
 * creator, no connected charges-enabled account, no valid customer, or a Stripe
 * error all stop before any row is written (docs ADR 20260719-stripe-connect-orders).
 */
export async function createOrder(
  db: AppDb,
  input: NewOrderInput,
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
): Promise<CreateOrderOutcome> {
  // Answered before anything else, and re-read from `person_roles` rather than
  // taken from the caller: billing a diver is owner/manager work (H-14, ADR
  // 20260724-role-authorization), and an invoice that has left for a real
  // customer on the shop's own Stripe account is not something a later apology
  // recalls. Same fail-closed second layer `anonymizeDiver` keeps under the
  // erasure gate — the route above is expected to check too, but "the route
  // forgot" must not be enough.
  if (!(await canPersonManageOrders(db, input.shopId, input.createdByPersonId))) {
    return { ok: false, reason: "not_authorized" };
  }
  if (input.lineItems.length === 0 || input.lineItems.length > MAX_LINE_ITEMS_PER_ORDER) {
    return { ok: false, reason: "invalid" };
  }
  if ((input.description?.length ?? 0) > MAX_ORDER_DESCRIPTION_LENGTH) {
    return { ok: false, reason: "invalid" };
  }
  // The shop's declared currency (docs ADR 20260731-shop-currency), not the
  // connected account's and not a hardcoded "usd". Read once and used for the
  // amount bounds, the Stripe invoice, and the local order row, so the three
  // can never disagree — and snapshotted onto the order, which is evidence of
  // what was billed and must survive a later change to the shop setting.
  const currency = await getShopCurrency(db, input.shopId);
  const maxUnitAmountCents = maxLineItemUnitAmountCents(currency);
  if (!input.lineItems.every((item) => lineItemIsValid(item, maxUnitAmountCents))) {
    return { ok: false, reason: "invalid" };
  }

  const account = await getShopStripeAccount(db, input.shopId);
  if (!canAcceptPayments(account)) return { ok: false, reason: "not_connected" };
  const stripeAccountId = (account as NonNullable<typeof account>).stripeAccountId;

  const [customer] = await db
    .select({ id: people.id, fullName: people.fullName, email: people.email })
    .from(people)
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  if (!customer?.email) return { ok: false, reason: "invalid" };

  if (input.bookingId) {
    // Bound to the invoiced person, not just the shop: when Stripe later
    // reports the invoice paid, setBookingPaymentIfNotFinal marks THIS
    // booking paid — linking diver A's order to diver B's booking would mark
    // B's seat paid off A's money.
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.personId, input.personId),
        ),
      )
      .limit(1);
    if (!booking) return { ok: false, reason: "invalid" };
  }

  // Durable evidence this attempt exists, written and committed before
  // Stripe is ever called (CR-005) — a crash mid-attempt (e.g. after
  // finalize but before the local order row below) still leaves this row
  // for reconciliation instead of a Stripe invoice with no local trace.
  const intent = await startPaymentOperation(db, {
    shopId: input.shopId,
    kind: "invoice",
    bookingId: input.bookingId ?? undefined,
  });

  const result = await invoicing.createInvoice({
    stripeAccountId,
    customerEmail: customer.email,
    customerName: customer.fullName,
    currency,
    lineItems: input.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitAmountCents: item.unitAmountCents,
    })),
    // Deterministic per-attempt key: a retry of this same intent converges
    // on the customer/items/invoice Stripe already created (CR-005).
    idempotencyKey: idempotencyKeyFor(intent.id),
  });
  if (result.status !== "created") {
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: result.status });
    return { ok: false, reason: "stripe_failed" };
  }
  // Durable the moment Stripe confirms the invoice exists — before the local
  // insert below that could still fail (CR-005).
  await recordPaymentOperationStripeObject(db, intent.id, result.stripeInvoiceId);

  const status = mapStripeStatus(result.stripeStatus);
  const now = nowDate();

  const order = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(orders)
      .values({
        shopId: input.shopId,
        bookingId: input.bookingId ?? null,
        personId: customer.id,
        createdByPersonId: input.createdByPersonId,
        status,
        currency,
        totalCents: result.totalCents,
        amountPaidCents: status === "paid" ? result.totalCents : 0,
        description: input.description ?? null,
        stripeAccountId,
        stripeCustomerId: result.stripeCustomerId,
        stripeInvoiceId: result.stripeInvoiceId,
        hostedInvoiceUrl: result.hostedInvoiceUrl,
        invoicePdfUrl: result.invoicePdfUrl,
        finalizedAt: now,
        paidAt: status === "paid" ? now : null,
      })
      .returning();
    if (!created) throw new Error("createOrder: insert returned no row");

    await tx.insert(orderLineItems).values(
      input.lineItems.map((item) => ({
        shopId: input.shopId,
        orderId: created.id,
        kind: item.kind,
        description: item.description,
        quantity: item.quantity,
        unitAmountCents: item.unitAmountCents,
      })),
    );

    // Same transaction as the order/line-item insert above, not a separate
    // write after commit — Stripe already reports this invoice paid, so a
    // crash here must not leave a "paid" order with an unpaid booking (CR-004).
    if (created.status === "paid" && created.bookingId) {
      await setBookingPaymentIfNotFinal(tx, {
        shopId: input.shopId,
        bookingId: created.bookingId,
        status: "paid",
        amountCents: created.totalCents,
        currency: created.currency,
        provider: "stripe",
        providerRef: created.stripeInvoiceId,
        operation: "order_settled",
      });
    }

    return created;
  });
  await resolvePaymentOperation(db, intent.id, { status: "succeeded" });

  return { ok: true, order };
}

/** Every person at the shop, for the new-order customer picker. */
export async function listOrderableCustomers(db: DbExecutor, shopId: string) {
  return db
    .select({ id: people.id, fullName: people.fullName, email: people.email })
    .from(people)
    .where(eq(people.shopId, shopId))
    .orderBy(asc(people.fullName));
}

/** Trip/person context for a booking, so an order started from a roster shows what it's linked to. */
export async function getBookingContext(db: DbExecutor, shopId: string, bookingId: string) {
  // The course comes along so a course session can be invoiced as its two
  // catalog lines (instruction + e-learning) instead of one trip fee.
  const [row] = await db
    .select({ booking: bookings, person: people, trip: trips, course: courses })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .leftJoin(courses, eq(courses.id, trips.courseId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

/**
 * The most recent open, Stripe-invoiced order per booking — what the Today
 * queue's payment rows act on in place. A booking is absent from the map when
 * it was never invoiced through Stripe (paid at the counter, or invoicing
 * wasn't connected when the trip was booked), so the caller falls back to
 * plain roster navigation instead of rendering a control with nothing to do.
 * Batched so a page of Today rows enriches in one query.
 */
export async function openOrdersForBookings(
  db: DbExecutor,
  shopId: string,
  bookingIds: string[],
): Promise<Map<string, Order>> {
  const byBooking = new Map<string, Order>();
  if (bookingIds.length === 0) return byBooking;
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.shopId, shopId),
        eq(orders.status, "open"),
        inArray(orders.bookingId, bookingIds),
      ),
    )
    .orderBy(desc(orders.createdAt));
  // Newest first, so the first row seen per booking is the one still open.
  for (const row of rows) {
    if (row.bookingId && !byBooking.has(row.bookingId)) byBooking.set(row.bookingId, row);
  }
  return byBooking;
}

export type ShopOrderFilter = {
  status?: OrderStatus;
  /** Exact match — the roster/diver-record "view orders" links pass this. */
  personId?: string;
  /** Substring match against the diver's name — the index page's own filter box. */
  personQuery?: string;
  /**
   * Orders raised against a booking on one departure — the trip pulse's
   * awaiting-payment fact and the index link it points at.
   *
   * Matched through the order's booking, never a column on `orders`: an order
   * belongs to a diver and, optionally, to the booking that occasioned it, and
   * the booking is what names a trip. An order with no booking (a shop-wide
   * invoice, a gear sale) is therefore on no trip and never matches.
   */
  tripId?: string;
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Exclusive upper bound on `created_at`, so a whole day/month reads as `[from, to)`. */
  to?: Date;
};

/**
 * The one `where` every read of the order index is built from — the paged
 * list, its total, and the per-trip count the trip pulse states.
 *
 * Shared rather than repeated so a count can never disagree with the list it
 * links to: the pulse says "2 orders are awaiting payment" and the Orders
 * index it opens has to show those same two rows, which only holds while both
 * ask the database the same question.
 */
function shopOrderWhere(shopId: string, filter: ShopOrderFilter) {
  const conditions = [eq(orders.shopId, shopId)];
  if (filter.status) conditions.push(eq(orders.status, filter.status));
  if (filter.personId) conditions.push(eq(orders.personId, filter.personId));
  if (filter.personQuery) conditions.push(ilike(people.fullName, `%${filter.personQuery}%`));
  if (filter.tripId) conditions.push(eq(bookings.tripId, filter.tripId));
  if (filter.from) conditions.push(gte(orders.createdAt, filter.from));
  if (filter.to) conditions.push(lt(orders.createdAt, filter.to));
  return and(...conditions);
}

/**
 * The shop-wide order index (task 158, UX persona lens 17): every invoice the
 * shop has ever sent, filterable by status, diver, and date range — the one
 * thing "reachable only through an individual diver's payments section"
 * (Reports revenue rows, the roster's payment cells, and the command palette
 * all link here) never had before.
 */
export const ORDER_PAGE_SIZE = PAGE_SIZE.list;

/**
 * One page of the order index, newest first, plus the unfiltered-by-page total.
 *
 * Bounded for the same reason the diver roster is (`DIVER_PAGE_SIZE`): a shop
 * that has been trading for a season has thousands of invoices, and rendering
 * every one of them costs the whole table on every visit. The demo shop alone
 * seeds 323, which made this page ~17,700px tall — nobody scrolls that, and it
 * is the same query cost whether they do or not.
 *
 * Offset rather than keyset, deliberately. The sort key here is `created_at`,
 * which is not unique — the seed writes several orders in the same second — so
 * a keyset cursor on it would skip or repeat rows at every page boundary. A
 * tie-broken keyset would work, but this list is filtered and date-ranged far
 * more than it is paged past the first screen, and offset keeps "page 4 of 7"
 * honest. It is the shape every paged staff list now shares
 * (ADR 20260803-one-pagination-model). Revisit if a shop's index ever gets deep
 * enough for the offset scan to matter.
 */
export async function listShopOrders(
  db: DbExecutor,
  shopId: string,
  filter: ShopOrderFilter = {},
  page: { page?: number; pageSize?: number } = {},
) {
  const where = shopOrderWhere(shopId, filter);

  const paged = await offsetPage({
    page: page.page,
    pageSize: page.pageSize ?? ORDER_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(orders)
        // The same joins the row query makes, so the count shares the row
        // query's exact scope (ADR 20260803-one-pagination-model): a `tripId`
        // filter reads through `bookings`, and a pager whose total was
        // computed without that join would promise pages that render nothing.
        // `orders.booking_id` is a foreign key, so the left join can only ever
        // add one row per order — it never inflates the count.
        .innerJoin(people, eq(people.id, orders.personId))
        .leftJoin(bookings, eq(bookings.id, orders.bookingId))
        .where(where);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({ order: orders, person: people, trip: trips })
        .from(orders)
        .innerJoin(people, eq(people.id, orders.personId))
        .leftJoin(bookings, eq(bookings.id, orders.bookingId))
        .leftJoin(trips, eq(trips.id, bookings.tripId))
        .where(where)
        // `orders.id` breaks ties on the non-unique timestamp, so a row can
        // never land on two pages (or on none) just because it shares a second
        // with its neighbour.
        .orderBy(desc(orders.createdAt), desc(orders.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    rows: paged.rows,
    total: paged.total,
    page: paged.page,
    pageSize: paged.pageSize,
    pageCount: paged.pageCount,
  };
}

/**
 * How many of one departure's orders are still awaiting payment — the trip
 * pulse's money fact ("2 orders are awaiting payment ›").
 *
 * A count rather than the rows: the pulse states a number and hands the work
 * to the Orders index, which is where an order is chased. It is deliberately
 * the *same* question that index answers under `?tripId=…&status=open` — one
 * `shopOrderWhere`, one set of joins — so the strip can never claim work the
 * page it opens does not show.
 *
 * `open` and nothing else. Stripe's `open` is precisely "invoiced, not yet
 * paid"; `void`/`uncollectible` are settled decisions and `refunded` money
 * already moved. Counting those would put a number on the pulse that no one
 * can act on, which is the one thing a fact here must never do.
 *
 * Unwindowed, unlike the index's default 90 days — a seat sold well in
 * advance can be invoiced long before the boat sails, and a fact that quietly
 * dropped those orders would read as an all clear. The link the pulse builds
 * says `range=all` for the same reason.
 */
export async function countOpenTripOrders(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const [counted] = await db
    .select({ total: count() })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .leftJoin(bookings, eq(bookings.id, orders.bookingId))
    .where(shopOrderWhere(shopId, { status: "open", tripId }));
  return counted?.total ?? 0;
}

/**
 * How far back the index looks when nobody has said otherwise.
 *
 * The index used to load every invoice the shop had ever raised — the demo's
 * 323 across nine months, and a real shop's several thousand — for a screen
 * whose whole job is "what has been billed lately". A window is not a
 * truncation as long as it is *stated* and there is a door out of it, which is
 * what `?range=all` is (see the Orders index page). Setting `?from=`/`?to=`
 * replaces the window rather than nesting inside it.
 */
export const ORDER_DEFAULT_RANGE_DAYS = 90;

/** Payment records for one diver, used by the person-first diver workspace. */
export async function listOrdersForPerson(db: DbExecutor, shopId: string, personId: string) {
  return db
    .select({ order: orders, trip: trips })
    .from(orders)
    .leftJoin(bookings, eq(bookings.id, orders.bookingId))
    .leftJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(orders.shopId, shopId), eq(orders.personId, personId)))
    .orderBy(desc(orders.createdAt));
}

export async function getOrder(db: DbExecutor, shopId: string, orderId: string) {
  const [row] = await db
    .select({ order: orders, person: people })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  const lineItems = await db
    .select()
    .from(orderLineItems)
    .where(eq(orderLineItems.orderId, orderId));
  // Who raised it. A second lookup rather than a second join onto `people`,
  // which would need a table alias to sit alongside the diver join above; the
  // detail page reads one order, so the extra round trip buys clarity cheaply.
  // Shop-scoped as well as id-matched: `created_by_person_id` is a foreign key,
  // not a claim, but this query is never the place to widen a tenant boundary.
  const [createdBy] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(and(eq(people.id, row.order.createdByPersonId), eq(people.shopId, shopId)))
    .limit(1);
  return { ...row, lineItems, createdBy: createdBy ?? null };
}

/**
 * Every status transition a caller of `applyOrderUpdate` is allowed to write,
 * keyed by the order's current status. A status is always allowed to repeat
 * itself (an idempotent no-op for a duplicate delivery of the same webhook
 * event); anything not listed here is refused rather than written (security
 * review finding: a replayed or out-of-order `invoice.voided`/`invoice.paid`
 * event must never flip a `paid`/`refunded` order back, the same way
 * `voidOrder` already requires `status === "open"` for a staff-initiated void).
 * `uncollectible` is reachable only through `refreshOrderStatus`'s direct
 * Stripe read today (no webhook event drives it), but is listed here so that
 * manual refresh path stays honest about what Stripe's own invoice lifecycle
 * allows: open can still resolve to paid after being marked uncollectible.
 */
const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, ReadonlySet<OrderStatus>> = {
  open: new Set<OrderStatus>(["open", "paid", "void", "uncollectible"]),
  paid: new Set<OrderStatus>(["paid", "partly_refunded", "refunded"]),
  void: new Set<OrderStatus>(["void"]),
  uncollectible: new Set<OrderStatus>(["uncollectible", "paid", "void"]),
  // A part-refunded order still holds money, so it can be refunded again —
  // down to zero (`refunded`) or by another slice (`partly_refunded`). It can
  // never go back to plain `paid`: money left the account (issue #699).
  partly_refunded: new Set<OrderStatus>(["partly_refunded", "refunded"]),
  refunded: new Set<OrderStatus>(["refunded"]),
};

/**
 * Applies a status/amount change to an order and cascades a completed
 * payment to its booking, both in one transaction so a crash between the
 * two writes can never leave the order "paid" with its booking still
 * unpaid. Re-reads the order fresh inside the transaction — under a
 * `FOR UPDATE` lock, so two concurrent callers (a replayed webhook racing
 * the original delivery) always serialize rather than both reading the same
 * stale `current` row — rather than trusting the possibly-stale `order` the
 * caller looked up. Refuses (and logs a refusal code rather than writing)
 * any transition not in {@link ALLOWED_ORDER_TRANSITIONS}, so a replayed or
 * out-of-order webhook can never move an order backward (security review
 * finding). Always re-applies the booking cascade for a "paid"/"refunded"
 * target status (not just on a transition into it) so a replay is
 * self-healing — idempotent and able to repair a booking-payment write that
 * failed after an earlier run's status update already committed (CR-004). A
 * booking already refunded or waived is never regressed back to paid by a
 * duplicate or out-of-order webhook.
 */
async function applyOrderUpdate(
  db: AppDb,
  order: Order,
  patch: {
    status: OrderStatus;
    amountPaidCents?: number;
    /**
     * Minor units coming back on **this** refund, applied as a delta against
     * the row this transaction locks — never a figure computed from a snapshot
     * the caller read earlier.
     *
     * `refundOrder` has to commit its claim before calling Stripe, so by the
     * time it knows what Stripe reversed, the snapshot it captured under the
     * claim's lock is arbitrarily old. Writing `snapshot.refundedCents + n` as
     * an absolute would make the lock here decorative: two refunds either side
     * of the five-minute stale horizon would each write from their own
     * snapshot, and the later write would erase the earlier refund from the
     * ledger — leaving `refunded_cents` understating what actually left and
     * the local over-refund check permitting more against phantom balance
     * (issue #699 security review). Given this, the status is derived here too:
     * only the locked row knows whether anything is left.
     */
    reverseCents?: number;
    /** Absolute new running total, not a delta — see `orders.refunded_cents`. */
    refundedCents?: number;
    hostedInvoiceUrl?: string | null;
    invoicePdfUrl?: string | null;
  },
): Promise<Order | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if (!current) return null;

    // Resolved against `current`, inside the lock. Clamped so a provider
    // reporting more than the order still holds cannot drive
    // `amount_paid_cents` through its non-negative check constraint.
    const reversedCents =
      patch.reverseCents === undefined
        ? null
        : Math.min(patch.reverseCents, current.amountPaidCents);
    const remainingCents =
      reversedCents === null ? current.amountPaidCents : current.amountPaidCents - reversedCents;
    const status: OrderStatus =
      reversedCents === null ? patch.status : remainingCents > 0 ? "partly_refunded" : "refunded";

    if (!ALLOWED_ORDER_TRANSITIONS[current.status].has(status)) {
      console.error("applyOrderUpdate: refused an illegal order status transition", {
        orderId: current.id,
        shopId: current.shopId,
        from: current.status,
        to: status,
      });
      return current;
    }

    const now = nowDate();
    const [updated] = await tx
      .update(orders)
      .set({
        status,
        amountPaidCents:
          reversedCents === null
            ? (patch.amountPaidCents ?? current.amountPaidCents)
            : remainingCents,
        refundedCents:
          reversedCents === null
            ? (patch.refundedCents ?? current.refundedCents)
            : current.refundedCents + reversedCents,
        hostedInvoiceUrl: patch.hostedInvoiceUrl ?? current.hostedInvoiceUrl,
        invoicePdfUrl: patch.invoicePdfUrl ?? current.invoicePdfUrl,
        paidAt: status === "paid" ? (current.paidAt ?? now) : current.paidAt,
        voidedAt: status === "void" ? (current.voidedAt ?? now) : current.voidedAt,
        // Stamped on the *first* money to come back, whether or not it was all
        // of it — the question this column answers is "when did this order
        // start being reversed", and a partly-refunded order with a null
        // `refunded_at` would read as untouched.
        refundedAt:
          status === "refunded" || status === "partly_refunded"
            ? (current.refundedAt ?? now)
            : current.refundedAt,
        updatedAt: now,
      })
      .where(eq(orders.id, current.id))
      .returning();
    if (!updated) return null;

    if (updated.status === "paid" && updated.bookingId) {
      await setBookingPaymentIfNotFinal(tx, {
        shopId: updated.shopId,
        bookingId: updated.bookingId,
        status: "paid",
        amountCents: updated.totalCents,
        currency: updated.currency,
        provider: "stripe",
        providerRef: updated.stripeInvoiceId,
        operation: "order_settled",
      });
    } else if (
      (updated.status === "refunded" || updated.status === "partly_refunded") &&
      updated.bookingId
    ) {
      // `amountCents` is what the shop still holds, which is the basis a full
      // refund already wrote (zero) and the basis the revenue query sums. A
      // partial leaves the remainder there and marks the seat
      // `partly_refunded` — a state that still clears the boarding gate
      // (`PAYMENT_CLEARED`, src/lib/readiness.ts), because a diver who got
      // half their money back has still paid (issue #699).
      await setBookingPayment(tx, {
        shopId: updated.shopId,
        bookingId: updated.bookingId,
        status: updated.status === "refunded" ? "refunded" : "partly_refunded",
        amountCents: updated.amountPaidCents,
        currency: updated.currency,
        provider: "stripe",
        providerRef: updated.stripeInvoiceId,
        operation: "order_refunded",
      });
    }
    return updated;
  });
}

/**
 * True unless `expectedAccountId` is given and disagrees with the row's own
 * `stripeAccountId` — a webhook event's top-level `account` field crossed
 * against the connected account the matched row actually belongs to. Belt
 * and suspenders (security review finding): `stripeInvoiceId`/session ids
 * are already globally unique across every connected account, so this
 * should never actually disagree, but the mark functions otherwise trust a
 * matched-by-id row without ever checking which account the event claims to
 * be from. `undefined` passes — a caller (tests, a fixture-less internal
 * call) that doesn't supply an expected account opts out of the check
 * rather than being refused by it.
 */
function accountMatches(expectedAccountId: string | undefined, rowAccountId: string): boolean {
  return expectedAccountId === undefined || expectedAccountId === rowAccountId;
}

/** Called from the Stripe webhook: marks the order that owns this invoice paid and cascades to its booking. */
export async function markOrderPaidByInvoiceId(
  db: AppDb,
  stripeInvoiceId: string,
  amountPaidCents: number,
  expectedAccountId?: string,
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripeInvoiceId, stripeInvoiceId))
    .limit(1);
  if (!order) return null;
  if (!accountMatches(expectedAccountId, order.stripeAccountId)) {
    console.error("markOrderPaidByInvoiceId: refused an account mismatch", {
      orderId: order.id,
      shopId: order.shopId,
      expectedAccountId,
      orderAccountId: order.stripeAccountId,
    });
    return null;
  }
  return applyOrderUpdate(db, order, { status: "paid", amountPaidCents });
}

export async function markOrderVoidedByInvoiceId(
  db: AppDb,
  stripeInvoiceId: string,
  expectedAccountId?: string,
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripeInvoiceId, stripeInvoiceId))
    .limit(1);
  if (!order) return null;
  if (!accountMatches(expectedAccountId, order.stripeAccountId)) {
    console.error("markOrderVoidedByInvoiceId: refused an account mismatch", {
      orderId: order.id,
      shopId: order.shopId,
      expectedAccountId,
      orderAccountId: order.stripeAccountId,
    });
    return null;
  }
  return applyOrderUpdate(db, order, { status: "void" });
}

export async function voidOrder(
  db: AppDb,
  shopId: string,
  orderId: string,
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (order?.status !== "open") return null;
  const result = await invoicing.voidInvoice(order.stripeAccountId, order.stripeInvoiceId);
  if (result.status !== "voided") return null;
  return applyOrderUpdate(db, order, { status: "void" });
}

/**
 * Why a refund attempt did not move money — a code, never a sentence; the UI
 * picks the words (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * - `not_found` — no such order in this shop.
 * - `not_paid` — nothing captured to reverse (open, void, already refunded).
 * - `in_progress` — another refund of this same order is already at Stripe;
 *   refused *locally* rather than sent as a second reversal (PAY-L3).
 * - `invalid_amount` — a partial refund was asked for that is not a positive
 *   whole number of minor units, or is more than this order still holds. Its
 *   own code rather than `failed` because nothing was attempted and nothing
 *   is wrong at Stripe: the staffer typed a number and needs to see which
 *   number is wrong (ADR 20260806 — new failure modes get new codes).
 * - `failed` — Stripe refused the reversal, or the local write after it did.
 */
export type RefundOrderOutcome =
  | { status: "refunded"; order: Order }
  | {
      status:
        | "not_found"
        | "not_paid"
        | "in_progress"
        | "invalid_amount"
        | "needs_reconciliation"
        | "failed";
    };

type OrderRefundClaim =
  | { status: "claimed"; order: Order; intent: PaymentOperationIntent }
  | {
      status: "not_found" | "not_paid" | "in_progress" | "invalid_amount" | "needs_reconciliation";
    };

/**
 * Whether a requested partial refund is a real amount of money this order can
 * still give back.
 *
 * Three refusals in one predicate, and each is a thing a form can produce: a
 * non-integer (`12.5` cents does not exist), a non-positive number (a refund
 * of zero moves nothing and a negative one is a *charge*), and more than the
 * order still holds. `Number.isSafeInteger` covers `NaN` and `Infinity` at the
 * same time, which is what an unparseable field arrives as.
 */
function isRefundableAmount(amountCents: number, remainingCents: number): boolean {
  return Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= remainingCents;
}

/**
 * Claim the sole in-flight refund of one order, under that order row's own
 * lock (PAY-L3).
 *
 * Before this, `refundOrder`'s only gate was a plain `SELECT` of
 * `orders.status`. Two staff taps (two tabs, a double-submitted form, a retry
 * after a slow response) both read `paid`, both minted their own intent — and
 * therefore their own distinct `Idempotency-Key`, which is deliberate and must
 * stay that way, since one payment intent covers a whole party and two genuine
 * refunds must not collapse into one (PAY-C1) — and both reached Stripe. The
 * only thing stopping the second reversal was Stripe rejecting an over-refund:
 * correct, but a network round trip's worth of trust in a refusal we can make
 * here.
 *
 * The shape is the house pattern from `createBookingRecord` (src/db/bookings.ts)
 * and `applyOrderUpdate` above: `SELECT … FOR UPDATE` on the always-existing
 * order row, then read-check-write entirely inside that lock. Two callers
 * serialize on the row, so the loser re-reads *after* the winner's intent has
 * committed and sees it.
 *
 * The transaction is deliberately short and commits **before** Stripe is
 * called, never around it: it exists to order two local decisions, not to hold
 * a database lock across a network round trip. That also keeps
 * `startPaymentOperation`'s durability contract intact (CR-005) — the intent is
 * committed on its own, ahead of the Stripe call it describes, so a crash
 * mid-call still leaves it for `listStuckPaymentOperations` to surface.
 *
 * A claim is a guard for the duration of one Stripe round trip, never a
 * permanent lock: an intent still `started` past `STALE_AFTER_MS` belonged to a
 * process that died and is ignored, exactly as `claimBookingsForCheckout`
 * treats an abandoned checkout claim. Past that horizon Stripe's own
 * over-refund rejection is the gate again — this lock is a second gate in
 * front of it, never a replacement for it.
 *
 * **PGlite caveat.** The repo's default test database is single-connection, so
 * `FOR UPDATE` never actually blocks there and a PGlite test cannot exhibit two
 * transactions genuinely inside this critical section at once — deleting the
 * `.for("update")` below would leave the whole PGlite suite green. What those
 * tests pin is the ordering and the refusal code; the lock's *presence* is
 * asserted under real contention in `src/db/refunds.postgres.test.ts`, which
 * runs only when `DIVEDAY_TEST_POSTGRES_URL` names a server (`src/test/postgres.ts`).
 *
 * `staleBefore` exists for the same reason `claimBookingsForCheckout`'s does:
 * `payment_operation_intents.started_at` is stamped by the *database's* clock
 * (`defaultNow()`), which `DIVEDAY_CLOCK` does not freeze, so a test that wants
 * to age an intent past the horizon has to express the bound against that same
 * clock (`dbNow`, src/test/db.ts). Production passes nothing and gets
 * `nowDate() - STALE_AFTER_MS`, where app and database clocks agree to well
 * inside the five-minute window.
 */
async function claimOrderRefund(
  db: AppDb,
  shopId: string,
  orderId: string,
  staleBefore: Date = new Date(nowDate().getTime() - STALE_AFTER_MS),
  amountCents?: number,
): Promise<OrderRefundClaim> {
  return db.transaction(async (tx): Promise<OrderRefundClaim> => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
      .for("update");
    if (!order) return { status: "not_found" };
    // A part-refunded order still holds money, so it is still refundable.
    if (order.status !== "paid" && order.status !== "partly_refunded") {
      return { status: "not_paid" };
    }
    if (order.amountPaidCents <= 0) return { status: "not_paid" };
    // The bound is read *inside* the lock and against the row, never against
    // anything the caller sent, so two part-refunds that would together
    // overdraw the order cannot both pass: the second serializes behind the
    // first and sees the reduced figure. Stripe's own over-refund rejection
    // is still the authority behind this (ADR 20260806); this is the gate in
    // front of it, so the common typo never costs a network round trip.
    if (amountCents !== undefined && !isRefundableAmount(amountCents, order.amountPaidCents)) {
      return { status: "invalid_amount" };
    }

    const [live] = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(
        and(
          eq(paymentOperationIntents.shopId, shopId),
          eq(paymentOperationIntents.orderId, order.id),
          eq(paymentOperationIntents.kind, "refund"),
          eq(paymentOperationIntents.status, "started"),
          gte(paymentOperationIntents.startedAt, staleBefore),
        ),
      )
      .limit(1);
    if (live) return { status: "in_progress" };

    // A *stale* started refund is ordinarily abandoned work and is ignored, so
    // the button keeps working after a crash. One carrying a `stripeObjectId`
    // is not: that column is written the moment Stripe confirms a refund
    // exists, so it is durable evidence money already moved and only the local
    // write after it failed. Minting a fresh intent for it would mint a fresh
    // idempotency key (deliberately, PAY-C1) and Stripe would accept a second
    // reversal against the balance still on the charge.
    //
    // For a full refund this could not happen — Stripe's own over-refund
    // rejection caught it. A partial leaves refundable balance behind, which
    // removes that backstop and is what makes this check load-bearing rather
    // than belt-and-braces (issue #699 security review). It belongs on the
    // stuck-payment-operations panel, where a human reconciles it against the
    // Stripe dashboard, never behind a button that reverses more money.
    const [settledByStripe] = await tx
      .select({ id: paymentOperationIntents.id })
      .from(paymentOperationIntents)
      .where(
        and(
          eq(paymentOperationIntents.shopId, shopId),
          eq(paymentOperationIntents.orderId, order.id),
          eq(paymentOperationIntents.kind, "refund"),
          eq(paymentOperationIntents.status, "started"),
          isNotNull(paymentOperationIntents.stripeObjectId),
        ),
      )
      .limit(1);
    if (settledByStripe) return { status: "needs_reconciliation" };

    const intent = await startPaymentOperation(tx, {
      shopId,
      kind: "refund",
      orderId: order.id,
    });
    return { status: "claimed", order, intent };
  });
}

/**
 * Refund a paid Stripe invoice — all of it, or part — and reopen its booking
 * payment gate.
 *
 * `options.amountCents` omitted reverses everything the order still holds, the
 * only behaviour there used to be. Given, it reverses that much and leaves the
 * rest: the four things a dive shop routinely does with money it is holding —
 * a policy step rather than a cliff, returning the fare and keeping the
 * non-refundable fee, releasing one diver out of a party that booked on one
 * shared checkout, and the goodwill half-refund when weather cuts a boat short
 * — were each impossible while every refund was total (issue #699).
 *
 * **What is recorded is what Stripe says it reversed**, never what was asked
 * for. `refunded_cents` rises by `result.amountCents` and `amount_paid_cents`
 * falls by the same figure, so a Stripe-side disagreement (a rounding rule, a
 * reversal somebody made in the dashboard) lands in the ledger as the truth
 * rather than as a silent drift between two systems.
 */
export async function refundOrder(
  db: AppDb,
  shopId: string,
  orderId: string,
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
  options: {
    /** Part of the held amount, in minor units. Omitted refunds all of it. */
    amountCents?: number;
    /** See {@link claimOrderRefund} — the abandoned-attempt horizon, for tests. */
    staleBefore?: Date;
  } = {},
): Promise<RefundOrderOutcome> {
  // Durable evidence before calling Stripe, and a deterministic idempotency
  // key so a retry of this same refund attempt converges on the one Stripe
  // refund already issued rather than refunding the diver twice (CR-005) —
  // now written under the order row's lock, so a *second* attempt is refused
  // locally instead of racing this one to Stripe (PAY-L3).
  const claim = await claimOrderRefund(
    db,
    shopId,
    orderId,
    options.staleBefore,
    options.amountCents,
  );
  if (claim.status !== "claimed") return { status: claim.status };
  const { order, intent } = claim;

  const result = await invoicing.refundInvoice(
    order.stripeAccountId,
    order.stripeInvoiceId,
    idempotencyKeyFor(intent.id),
    options.amountCents,
  );
  if (result.status !== "refunded") {
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: result.status });
    return { status: "failed" };
  }
  // Durable the moment Stripe confirms the refund exists — before the local
  // update below that could still fail (CR-005).
  if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
  // Stripe's figure first, the requested one only as a fallback for a provider
  // that reports no amount, and the whole held balance when neither says
  // otherwise — which is the pre-existing full-refund case, unchanged.
  //
  // Handed over as a **delta**: `order` is the snapshot `claimOrderRefund` read
  // before the Stripe round trip, and that claim's lock was released when its
  // transaction committed. `applyOrderUpdate` applies this against the row it
  // locks itself, and derives the resulting status from what is left there —
  // so two refunds that straddle the stale horizon add up instead of the later
  // one erasing the earlier (issue #699 security review). The clamp lives
  // there too, against the figure that is actually current.
  const reversedCents = result.amountCents ?? options.amountCents ?? order.amountPaidCents;
  const updated = await applyOrderUpdate(db, order, {
    // Overridden inside the lock once `reverseCents` is resolved; named here
    // so the patch stays a legal `OrderStatus` shape.
    status: "refunded",
    reverseCents: reversedCents,
  });
  await resolvePaymentOperation(db, intent.id, {
    status: "succeeded",
  });
  // Stripe reversed the charge; only the local write after it can have failed.
  // `failed` is the honest answer for staff (retry, then reconcile) — the
  // intent above carries the Stripe refund id for exactly that.
  return updated ? { status: "refunded", order: updated } : { status: "failed" };
}

export type ResendInvoiceOutcome =
  | { status: "sent" }
  | { status: "not_found" | "not_open" | "not_configured" | "failed" };

/**
 * Re-sends an already-created invoice's email — the Today queue's one-tap
 * "resend invoice" row. Never creates a new invoice: a booking with no order
 * yet (never invoiced) or one whose order already closed (paid, voided,
 * refunded) has nothing to resend, and the caller falls back to navigation
 * for those (`openOrdersForBookings` gates this
 * before the control is even rendered), but this still re-checks status
 * itself so a stale page can't resend a closed invoice.
 */
export async function resendOrderInvoice(
  db: AppDb,
  shopId: string,
  orderId: string,
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
): Promise<ResendInvoiceOutcome> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (!order) return { status: "not_found" };
  if (order.status !== "open") return { status: "not_open" };
  const result = await invoicing.resendInvoice(order.stripeAccountId, order.stripeInvoiceId);
  return result.status === "sent" ? { status: "sent" } : { status: result.status };
}

/** Manual fallback for shops without the webhook configured yet: pull current status straight from Stripe. */
export async function refreshOrderStatus(
  db: AppDb,
  shopId: string,
  orderId: string,
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, orderId), eq(orders.shopId, shopId)))
    .limit(1);
  if (!order) return null;
  const result = await invoicing.retrieveInvoice(order.stripeAccountId, order.stripeInvoiceId);
  if (result.status !== "ok") return null;
  return applyOrderUpdate(db, order, {
    status: mapStripeStatus(result.invoice.status),
    amountPaidCents: result.invoice.amountPaidCents,
    hostedInvoiceUrl: result.invoice.hostedInvoiceUrl,
    invoicePdfUrl: result.invoice.invoicePdfUrl,
  });
}
