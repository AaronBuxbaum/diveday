import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { startBookingCheckout } from "@/db/checkouts";
import type { AppDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { createDivePackage } from "@/db/dive-packages";
import { createDiver } from "@/db/divers";
import { createOrder } from "@/db/orders";
import { ownerLogins } from "@/db/owner-logins";
import { bookings, orderLineItems, orders, people, personRoles, shops } from "@/db/schema";
import {
  canAcceptPayments,
  getShopStripeAccount,
  setShopStripeAccountStatus,
  upsertShopStripeAccount,
} from "@/db/stripe-accounts";
import { seatNotCancelled } from "@/db/trips-queries";
import { DAY_MS } from "@/lib/clock";
import { holdNonDemoFixture } from "@/lib/e2e-test-routes";
import type { CheckoutProvider, InvoicingProvider } from "@/lib/payments";
import { FactRefused } from "./refusal";

/**
 * **A shop that takes payments, without Stripe.** The fleet sets no
 * `STRIPE_SECRET_KEY`, so every checkout button resolves to the disabled
 * provider; these facts write only the rows a real connection and a real
 * Stripe call would have left, so the surfaces behind them can be reached and
 * paid the one way DiveDay learns a payment settled: a signed webhook posted to
 * the real handler (`e2e/helpers.ts`). Nothing here marks anything paid.
 */

/**
 * **Connected and charges-enabled** (`stripeAccount`): `canAcceptPayments`,
 * and everything gated on it (pay at booking, tips, invoicing), is a pure
 * database check on `shop_stripe_accounts`. The account id is unique across
 * shops, so the canonical demo keeps the literal it has always had (the
 * `troublePanels` erasures name it too) and every other shop derives one from
 * its own id.
 */
export async function connectStripe(db: AppDb, shop: { id: string; slug: string }) {
  const stripeAccountId = shop.slug === DEMO_SHOP_SLUG ? "acct_e2e_test" : `acct_e2e_${shop.id}`;
  const account = await upsertShopStripeAccount(db, shop.id, stripeAccountId);
  await setShopStripeAccountStatus(db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
}

export const diverEmailArgs = z.object({ email: z.string().trim().email() }).strict();

async function latestSeatOf(db: AppDb, shopId: string, email: string) {
  const [seat] = await db
    .select({ bookingId: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shopId)))
    .where(
      and(eq(bookings.shopId, shopId), eq(people.email, email.toLowerCase()), seatNotCancelled),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  if (!seat) throw new FactRefused("not_found", 404);
  return seat;
}

/**
 * **An open booking checkout for the diver's latest seat** (`bookingCheckout`,
 * ADR 20260721-checkout-at-booking): the row the public booking form writes
 * when it sends a diver to Stripe, through `startBookingCheckout` itself with a
 * provider that mints a known session id. The shop must be connected first
 * (`stripeAccount`, earlier in the registry).
 */
export async function openABookingCheckout(
  db: AppDb,
  shopId: string,
  { email }: z.output<typeof diverEmailArgs>,
  origin: string,
  now: Date,
) {
  const seat = await latestSeatOf(db, shopId, email);
  const sessionId = `cs_e2e_${seat.bookingId}`;
  const provider: CheckoutProvider = {
    async createCheckoutSession(checkout) {
      return {
        status: "created",
        stripeSessionId: sessionId,
        stripeStatus: "open",
        paymentStatus: "unpaid",
        checkoutUrl: `https://checkout.stripe.com/c/pay/${sessionId}`,
        amountTotalCents: checkout.lineItems.reduce(
          (sum, line) => sum + line.unitAmountCents * line.quantity,
          0,
        ),
        taxAmountCents: null,
        stripeCustomerId: null,
        expiresAt: checkout.expiresAt ?? new Date(now.getTime() + DAY_MS),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return { status: "failed" };
    },
  };
  const outcome = await startBookingCheckout(
    db,
    {
      shopId,
      tripId: seat.tripId,
      bookingIds: [seat.bookingId],
      customerEmail: email.toLowerCase(),
      successUrl: origin,
      cancelUrl: origin,
      describeLine: ({ tripTitle }) => tripTitle,
    },
    provider,
  );
  if (!outcome.ok) throw new FactRefused(outcome.reason);
  return {
    sessionId: outcome.checkout.stripeSessionId,
    stripeAccountId: outcome.checkout.stripeAccountId,
    amountCents: outcome.checkout.totalCents,
  };
}

/** Ten dives at $45 each, the card the package spec sells. */
const PACKAGE = { name: "Ten-dive card", diveCount: 10, priceCents: 45_000 } as const;
const SEAT_CENTS = 18_000;

/**
 * **An open Stripe invoice for the diver's seat and a ten-dive package**
 * (`openPackageInvoice`, issue #2306): paying it through `invoice.paid` settles
 * the seat and grants the dives "N package dives left" on `/ready` counts. It is
 * raised on the shop's connected account (`stripeAccount`, earlier in the
 * registry), so the webhook's own account cross-check is what lets it through.
 */
export async function openAPackageInvoice(
  db: AppDb,
  shopId: string,
  { email }: z.output<typeof diverEmailArgs>,
) {
  const account = await getShopStripeAccount(db, shopId);
  if (!account) throw new FactRefused("not_connected");
  const seat = await latestSeatOf(db, shopId, email);
  const [owner] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, and(eq(people.id, personRoles.personId), eq(people.shopId, shopId)))
    .where(eq(personRoles.role, "owner"))
    .limit(1);
  if (!owner) throw new FactRefused("not_found", 404);
  const pkg = await createDivePackage(db, {
    shopId,
    name: PACKAGE.name,
    diveCount: PACKAGE.diveCount,
    priceCents: PACKAGE.priceCents,
    scope: "all",
    validUntil: null,
  });
  if (!pkg) throw new FactRefused("not_found", 404);
  const totalCents = SEAT_CENTS + PACKAGE.priceCents;
  const [order] = await db
    .insert(orders)
    .values({
      shopId,
      bookingId: seat.bookingId,
      personId: seat.personId,
      createdByPersonId: owner.personId,
      status: "open",
      currency: "usd",
      totalCents,
      amountPaidCents: 0,
      stripeAccountId: account.stripeAccountId,
      stripeCustomerId: `cus_e2e_${seat.personId}`,
      stripeInvoiceId: `in_e2e_${seat.bookingId}`,
    })
    .returning({ id: orders.id, stripeInvoiceId: orders.stripeInvoiceId });
  if (!order) throw new FactRefused("not_found", 404);
  await db.insert(orderLineItems).values([
    {
      shopId,
      orderId: order.id,
      kind: "trip_fee",
      description: "Two-tank reef",
      quantity: 1,
      unitAmountCents: SEAT_CENTS,
    },
    {
      shopId,
      orderId: order.id,
      kind: "dive_package",
      description: PACKAGE.name,
      quantity: 1,
      unitAmountCents: PACKAGE.priceCents,
      packageId: pkg.id,
    },
  ]);
  return {
    invoiceId: order.stripeInvoiceId,
    stripeAccountId: account.stripeAccountId,
    amountCents: totalCents,
  };
}

/** No provider method in this fixture performs HTTP or sends an email. */
function invoiceFixture(suffix: string): InvoicingProvider {
  return {
    async createInvoice(request) {
      return {
        status: "created",
        stripeCustomerId: `cus_visual_${suffix}`,
        stripeInvoiceId: `in_visual_${suffix}`,
        stripeStatus: "open",
        hostedInvoiceUrl: null,
        invoicePdfUrl: null,
        totalCents: request.lineItems.reduce(
          (total, item) => total + item.quantity * item.unitAmountCents,
          0,
        ),
        taxCents: 0,
      };
    },
    async voidInvoice() {
      return { status: "not_configured" };
    },
    async markInvoicePaidOutOfBand() {
      return { status: "not_configured" };
    },
    async resendInvoice() {
      return { status: "not_configured" };
    },
    async refundInvoice() {
      return { status: "not_configured" };
    },
    async retrieveInvoice() {
      return { status: "not_configured" };
    },
  };
}

/**
 * **An open invoice on a shop that is no longer a demo** (`chargeToRoomInvoice`):
 * the real Charge to room editor is hidden on demos, so this seeds one open
 * invoice through the production writer and then clears the minted shop's demo
 * flag for the capture. The shop is held as this server's own non-demo fixture
 * (`holdNonDemoFixture`), so the door's teardown still drops it, and no other
 * fact can be written to it once it is real-shaped. A private shop's fact, on a
 * connected shop (`stripeAccount`, earlier in the registry).
 */
export async function raiseAnInvoiceOnARealShapedShop(db: AppDb, shopId: string) {
  const [owner] = await ownerLogins(db, shopId);
  const account = await getShopStripeAccount(db, shopId);
  if (!owner || !canAcceptPayments(account)) throw new FactRefused("fixture_not_ready");
  const diver = await createDiver(db, {
    shopId,
    fullName: "Nina Patel",
    email: "nina.payment.audit@example.com",
  });
  if (!diver) throw new FactRefused("already_seeded");
  const result = await createOrder(
    db,
    {
      shopId,
      personId: diver.id,
      createdByPersonId: owner.personId,
      description: "Two-tank reef trip",
      customerAddress: {
        line1: "1 Dock Way",
        city: "Key Largo",
        state: "FL",
        postalCode: "33037",
        country: "US",
      },
      lineItems: [
        {
          kind: "trip_fee",
          description: "Two-tank reef trip",
          quantity: 1,
          unitAmountCents: 18_000,
        },
      ],
    },
    invoiceFixture(diver.id.replaceAll("-", "").slice(0, 16)),
  );
  if (!result.ok) throw new FactRefused(result.reason);
  const [converted] = await db
    .update(shops)
    .set({ isDemo: false })
    .where(and(eq(shops.id, shopId), eq(shops.isDemo, true)))
    .returning({ id: shops.id });
  if (!converted) throw new FactRefused("fixture_changed");
  holdNonDemoFixture(shopId);
  return { orderId: result.order.id };
}
