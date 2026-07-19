import { and, asc, desc, eq } from "drizzle-orm";
import { type InvoicingProvider, invoicingProviderFromEnvironment } from "@/lib/payments/invoicing";
import type { AppDb, DbExecutor } from "./client";
import { setBookingPayment } from "./payments";
import type { Order, OrderLineItemKind, OrderStatus } from "./schema";
import { bookings, orderLineItems, orders, people, trips } from "./schema";
import { canAcceptPayments, getShopStripeAccount } from "./stripe-accounts";

export type NewOrderLineItem = {
  kind: OrderLineItemKind;
  description: string;
  quantity: number;
  unitAmountCents: number;
};

export type NewOrderInput = {
  shopId: string;
  personId: string;
  createdByPersonId: string;
  bookingId?: string | null;
  description?: string | null;
  lineItems: NewOrderLineItem[];
};

export type CreateOrderOutcome =
  | { ok: true; order: Order }
  | { ok: false; reason: "not_connected" | "invalid" | "stripe_failed" };

function mapStripeStatus(stripeStatus: string): OrderStatus {
  if (stripeStatus === "paid" || stripeStatus === "void" || stripeStatus === "uncollectible") {
    return stripeStatus;
  }
  return "open";
}

/**
 * Build and send an order/invoice on the shop's connected Stripe account,
 * then persist the local order + line items. Fails closed: no connected,
 * charges-enabled account, no valid customer, or a Stripe error all stop
 * before any row is written (docs ADR 20260719-stripe-connect-orders).
 */
export async function createOrder(
  db: AppDb,
  input: NewOrderInput,
  invoicing: InvoicingProvider = invoicingProviderFromEnvironment(),
): Promise<CreateOrderOutcome> {
  if (input.lineItems.length === 0) return { ok: false, reason: "invalid" };
  for (const item of input.lineItems) {
    if (item.quantity < 1 || item.unitAmountCents < 0) return { ok: false, reason: "invalid" };
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
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1);
    if (!booking) return { ok: false, reason: "invalid" };
  }

  const currency = "usd";
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
  });
  if (result.status !== "created") return { ok: false, reason: "stripe_failed" };

  const status = mapStripeStatus(result.stripeStatus);
  const now = new Date();

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

    return created;
  });

  if (order.status === "paid" && order.bookingId) {
    await setBookingPayment(db, {
      shopId: input.shopId,
      bookingId: order.bookingId,
      status: "paid",
      amountCents: order.totalCents,
      currency: order.currency,
      provider: "stripe",
      providerRef: order.stripeInvoiceId,
    });
  }

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
  const [row] = await db
    .select({ booking: bookings, person: people, trip: trips })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId)))
    .limit(1);
  return row ?? null;
}

export async function listOrders(db: DbExecutor, shopId: string) {
  return db
    .select({ order: orders, person: people })
    .from(orders)
    .innerJoin(people, eq(people.id, orders.personId))
    .where(eq(orders.shopId, shopId))
    .orderBy(desc(orders.createdAt));
}

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
  return { ...row, lineItems };
}

/** Applies a status/amount change to an order and cascades a completed payment to its booking. */
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
  const now = new Date();
  const [updated] = await db
    .update(orders)
    .set({
      status: patch.status,
      amountPaidCents: patch.amountPaidCents ?? order.amountPaidCents,
      hostedInvoiceUrl: patch.hostedInvoiceUrl ?? order.hostedInvoiceUrl,
      invoicePdfUrl: patch.invoicePdfUrl ?? order.invoicePdfUrl,
      paidAt: patch.status === "paid" ? (order.paidAt ?? now) : order.paidAt,
      voidedAt: patch.status === "void" ? (order.voidedAt ?? now) : order.voidedAt,
      refundedAt: patch.status === "refunded" ? (order.refundedAt ?? now) : order.refundedAt,
      updatedAt: now,
    })
    .where(eq(orders.id, order.id))
    .returning();
  if (!updated) return null;

  if (updated.status === "paid" && order.status !== "paid" && updated.bookingId) {
    await setBookingPayment(db, {
      shopId: updated.shopId,
      bookingId: updated.bookingId,
      status: "paid",
      amountCents: updated.totalCents,
      currency: updated.currency,
      provider: "stripe",
      providerRef: updated.stripeInvoiceId,
    });
  } else if (updated.status === "refunded" && order.status !== "refunded" && updated.bookingId) {
    await setBookingPayment(db, {
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
}

/** Called from the Stripe webhook: marks the order that owns this invoice paid and cascades to its booking. */
export async function markOrderPaidByInvoiceId(
  db: AppDb,
  stripeInvoiceId: string,
  amountPaidCents: number,
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripeInvoiceId, stripeInvoiceId))
    .limit(1);
  if (!order) return null;
  return applyOrderUpdate(db, order, { status: "paid", amountPaidCents });
}

export async function markOrderVoidedByInvoiceId(
  db: AppDb,
  stripeInvoiceId: string,
): Promise<Order | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.stripeInvoiceId, stripeInvoiceId))
    .limit(1);
  if (!order) return null;
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
  const result = await invoicing.refundInvoice(order.stripeAccountId, order.stripeInvoiceId);
  if (result.status !== "refunded") return null;
  return applyOrderUpdate(db, order, { status: "refunded", amountPaidCents: 0 });
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
