import { and, desc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { createDivePackage } from "@/db/dive-packages";
import { bookings, orderLineItems, orders, people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { getShopStripeAccount } from "@/db/stripe-accounts";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/** Ten dives at $45 each, the card the package spec sells. */
const PACKAGE = { name: "Ten-dive card", diveCount: 10, priceCents: 45_000 } as const;
const SEAT_CENTS = 18_000;

/**
 * An open Stripe invoice for a diver's seat **and** a ten-dive package, so an
 * e2e spec can pay it the one way DiveDay learns an invoice was paid: a signed
 * `invoice.paid` posted to the real webhook (`e2e/helpers.ts`'s
 * `payInvoiceThroughWebhook`). Paying it settles the seat and grants the
 * dives, which is what "N package dives left" on `/ready` needs (issue #2306).
 * Nothing is marked paid here; the webhook does that.
 *
 * `?slug=` names a minted shop and `?email=` the diver, who must already hold
 * a booking there and whose shop must already be connected
 * (`/api/test/seed-stripe-account`): the invoice is raised on that account, so
 * the webhook's own account cross-check is what lets it through.
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
  const account = await getShopStripeAccount(db, shop.id);
  if (!account) return NextResponse.json({ error: "not_connected" }, { status: 409 });

  const [seat] = await db
    .select({ bookingId: bookings.id, personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, shop.id)))
    .where(
      and(eq(bookings.shopId, shop.id), eq(people.email, email), ne(bookings.status, "cancelled")),
    )
    .orderBy(desc(bookings.createdAt))
    .limit(1);
  const [owner] = await db
    .select({ personId: personRoles.personId })
    .from(personRoles)
    .innerJoin(people, and(eq(people.id, personRoles.personId), eq(people.shopId, shop.id)))
    .where(eq(personRoles.role, "owner"))
    .limit(1);
  if (!seat || !owner) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const pkg = await createDivePackage(db, {
    shopId: shop.id,
    name: PACKAGE.name,
    diveCount: PACKAGE.diveCount,
    priceCents: PACKAGE.priceCents,
    scope: "all",
    validUntil: null,
  });
  if (!pkg) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const totalCents = SEAT_CENTS + PACKAGE.priceCents;
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
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
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  await db.insert(orderLineItems).values([
    {
      shopId: shop.id,
      orderId: order.id,
      kind: "trip_fee",
      description: "Two-tank reef",
      quantity: 1,
      unitAmountCents: SEAT_CENTS,
    },
    {
      shopId: shop.id,
      orderId: order.id,
      kind: "dive_package",
      description: PACKAGE.name,
      quantity: 1,
      unitAmountCents: PACKAGE.priceCents,
      packageId: pkg.id,
    },
  ]);
  return NextResponse.json({
    invoiceId: order.stripeInvoiceId,
    stripeAccountId: account.stripeAccountId,
    amountCents: totalCents,
  });
}
