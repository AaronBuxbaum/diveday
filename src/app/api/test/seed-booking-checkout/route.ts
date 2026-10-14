import { and, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { startBookingCheckout } from "@/db/checkouts";
import { getDb } from "@/db/client";
import { bookings, people } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { nowMs } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import type { CheckoutProvider } from "@/lib/payments/checkout";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * An open booking checkout for a diver's seat, the row the public booking
 * form writes when it sends a diver to Stripe (ADR
 * 20260721-checkout-at-booking), so an e2e spec can pay it the one way
 * DiveDay learns a card payment settled: a signed `checkout.session.completed`
 * posted to the real webhook. This fleet sets no `STRIPE_SECRET_KEY`, so the
 * booking form itself falls back to pay-later; this route stands in for the
 * one Stripe call the form would have made, through `startBookingCheckout`
 * itself, with a provider that mints a known session id instead. Nothing is
 * marked paid here; the webhook does that.
 *
 * `?slug=` names a minted shop and `?email=` the diver, who must already hold
 * a booking there and whose shop must already be connected
 * (`/api/test/seed-stripe-account`).
 *
 * Gated like every `/api/test/*` route (`e2eTestRouteAuthorized`), and a real
 * shop is refused whatever slug is passed (`isDemo`).
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !email) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, slug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const [seat] = await db
    .select({ bookingId: bookings.id, tripId: bookings.tripId })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shop.id)))
    .where(
      and(eq(bookings.shopId, shop.id), eq(people.email, email), ne(bookings.status, "cancelled")),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  if (!seat) return NextResponse.json({ error: "not_found" }, { status: 404 });

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
        expiresAt: checkout.expiresAt ?? new Date(nowMs() + DAY_MS),
      };
    },
    async retrieveCheckoutSession() {
      return { status: "failed" };
    },
    async refundCheckoutSession() {
      return { status: "failed" };
    },
  };
  const origin = url.origin;
  const outcome = await startBookingCheckout(
    db,
    {
      shopId: shop.id,
      tripId: seat.tripId,
      bookingIds: [seat.bookingId],
      customerEmail: email,
      successUrl: origin,
      cancelUrl: origin,
      describeLine: ({ tripTitle }) => tripTitle,
    },
    provider,
  );
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 409 });
  return NextResponse.json({
    sessionId: outcome.checkout.stripeSessionId,
    stripeAccountId: outcome.checkout.stripeAccountId,
    amountCents: outcome.checkout.totalCents,
  });
}
