import { and, asc, count, desc, eq, gte, ilike, inArray, lt } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { majorToMinor } from "@/lib/money";
import { type InvoicingProvider, invoicingProviderFromEnvironment } from "@/lib/payments/invoicing";
import { canPersonManageOrders } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage } from "./paging";
import {
  idempotencyKeyFor,
  recordPaymentOperationStripeObject,
  resolvePaymentOperation,
  startPaymentOperation,
} from "./payment-operations";
import { setBookingPayment, setBookingPaymentIfNotFinal } from "./payments";
import type { Order, OrderLineItemKind, OrderStatus } from "./schema";
import {
  bookings,
  courses,
  orderLineItemKind,
  orderLineItems,
  orders,
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
 * The most recent open, Stripe-invoiced order for a booking — what the Today
 * queue's payment row acts on in place. Null when the booking was never
 * invoiced through Stripe (paid at the counter, or invoicing wasn't
 * connected when the trip was booked), so the caller falls back to plain
 * roster navigation instead of rendering a control with nothing to do.
 */
export async function getOpenOrderForBooking(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(
      and(eq(orders.shopId, shopId), eq(orders.bookingId, bookingId), eq(orders.status, "open")),
    )
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return order ?? null;
}

/** Batched form of `getOpenOrderForBooking`, for enriching a page of Today rows in one query. */
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

export async function listOrders(db: DbExecutor, shopId: string) {
  return db
    .select({ order: orders, person: people })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .where(eq(orders.shopId, shopId))
    .orderBy(desc(orders.createdAt));
}

export type ShopOrderFilter = {
  status?: OrderStatus;
  /** Exact match — the roster/diver-record "view orders" links pass this. */
  personId?: string;
  /** Substring match against the diver's name — the index page's own filter box. */
  personQuery?: string;
  /** Inclusive lower bound on `created_at`. */
  from?: Date;
  /** Exclusive upper bound on `created_at`, so a whole day/month reads as `[from, to)`. */
  to?: Date;
};

/**
 * The shop-wide order index (task 158, UX persona lens 17): every invoice the
 * shop has ever sent, filterable by status, diver, and date range — the one
 * thing "reachable only through an individual diver's payments section"
 * (Reports revenue rows, the roster's payment cells, and the command palette
 * all link here) never had before.
 */
export const ORDER_PAGE_SIZE = 50;

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
  const conditions = [eq(orders.shopId, shopId)];
  if (filter.status) conditions.push(eq(orders.status, filter.status));
  if (filter.personId) conditions.push(eq(orders.personId, filter.personId));
  if (filter.personQuery) conditions.push(ilike(people.fullName, `%${filter.personQuery}%`));
  if (filter.from) conditions.push(gte(orders.createdAt, filter.from));
  if (filter.to) conditions.push(lt(orders.createdAt, filter.to));
  const where = and(...conditions);

  const paged = await offsetPage({
    page: page.page,
    pageSize: page.pageSize ?? ORDER_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db
        .select({ total: count() })
        .from(orders)
        .innerJoin(people, eq(people.id, orders.personId))
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
  paid: new Set<OrderStatus>(["paid", "refunded"]),
  void: new Set<OrderStatus>(["void"]),
  uncollectible: new Set<OrderStatus>(["uncollectible", "paid", "void"]),
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
    hostedInvoiceUrl?: string | null;
    invoicePdfUrl?: string | null;
  },
): Promise<Order | null> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
    if (!current) return null;

    if (!ALLOWED_ORDER_TRANSITIONS[current.status].has(patch.status)) {
      console.error("applyOrderUpdate: refused an illegal order status transition", {
        orderId: current.id,
        shopId: current.shopId,
        from: current.status,
        to: patch.status,
      });
      return current;
    }

    const now = nowDate();
    const [updated] = await tx
      .update(orders)
      .set({
        status: patch.status,
        amountPaidCents: patch.amountPaidCents ?? current.amountPaidCents,
        hostedInvoiceUrl: patch.hostedInvoiceUrl ?? current.hostedInvoiceUrl,
        invoicePdfUrl: patch.invoicePdfUrl ?? current.invoicePdfUrl,
        paidAt: patch.status === "paid" ? (current.paidAt ?? now) : current.paidAt,
        voidedAt: patch.status === "void" ? (current.voidedAt ?? now) : current.voidedAt,
        refundedAt: patch.status === "refunded" ? (current.refundedAt ?? now) : current.refundedAt,
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
      });
    } else if (updated.status === "refunded" && updated.bookingId) {
      await setBookingPayment(tx, {
        shopId: updated.shopId,
        bookingId: updated.bookingId,
        status: "refunded",
        amountCents: 0,
        currency: updated.currency,
        provider: "stripe",
        providerRef: updated.stripeInvoiceId,
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

/** Refund a paid Stripe invoice and reopen its booking payment gate. */
export async function refundOrder(
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
  if (order?.status !== "paid") return null;

  // Durable evidence before calling Stripe, and a deterministic idempotency
  // key so a retry of this same refund attempt converges on the one Stripe
  // refund already issued rather than refunding the diver twice (CR-005).
  const intent = await startPaymentOperation(db, {
    shopId,
    kind: "refund",
    orderId: order.id,
  });
  const result = await invoicing.refundInvoice(
    order.stripeAccountId,
    order.stripeInvoiceId,
    idempotencyKeyFor(intent.id),
  );
  if (result.status !== "refunded") {
    await resolvePaymentOperation(db, intent.id, { status: "failed", errorMessage: result.status });
    return null;
  }
  // Durable the moment Stripe confirms the refund exists — before the local
  // update below that could still fail (CR-005).
  if (result.refundId) await recordPaymentOperationStripeObject(db, intent.id, result.refundId);
  const updated = await applyOrderUpdate(db, order, { status: "refunded", amountPaidCents: 0 });
  await resolvePaymentOperation(db, intent.id, {
    status: "succeeded",
  });
  return updated;
}

export type ResendInvoiceOutcome =
  | { status: "sent" }
  | { status: "not_found" | "not_open" | "not_configured" | "failed" };

/**
 * Re-sends an already-created invoice's email — the Today queue's one-tap
 * "resend invoice" row. Never creates a new invoice: a booking with no order
 * yet (never invoiced) or one whose order already closed (paid, voided,
 * refunded) has nothing to resend, and the caller falls back to navigation
 * for those (`getOpenOrderForBooking`/`openOrdersForBookings` gate this
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
