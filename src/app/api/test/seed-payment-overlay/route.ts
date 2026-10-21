import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/demo-shop";
import { createDiver } from "@/db/divers";
import { createOrder } from "@/db/orders";
import { ownerLogins } from "@/db/owner-logins";
import { shops } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { canAcceptPayments, getShopStripeAccount } from "@/db/stripe-accounts";
import { createBearerToken, hashBearerToken } from "@/lib/bearer-tokens";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import type { InvoicingProvider } from "@/lib/payments/invoicing";

const seedBody = z
  .object({
    shopSlug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
  })
  .strict();
const cleanupBody = z.object({ cleanupLease: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const cleanupLeases = new Map<string, { shopId: string; slug: string }>();

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
 * The real room-charge editor is hidden on demos. Seed one open invoice with
 * the production writer, then convert only a minted test fixture for the
 * read-only capture. The opaque lease is the sole way back: DELETE accepts no
 * tenant identifier and cannot turn an arbitrary real tenant into a demo.
 * The per-worker test server and database own the lease for this one capture.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const parsed = seedBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.shopSlug === DEMO_SHOP_SLUG) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, parsed.data.shopSlug);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });
  const [owner] = await ownerLogins(db, shop.id);
  const account = await getShopStripeAccount(db, shop.id);
  if (!owner || !canAcceptPayments(account)) {
    return NextResponse.json({ error: "fixture_not_ready" }, { status: 409 });
  }
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: "Nina Patel",
    email: "nina.payment.audit@example.com",
  });
  if (!diver) return NextResponse.json({ error: "already_seeded" }, { status: 409 });
  const cleanupLease = createBearerToken();
  const result = await createOrder(
    db,
    {
      shopId: shop.id,
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
    invoiceFixture(hashBearerToken(cleanupLease).slice(0, 16)),
  );
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 });
  const [converted] = await db
    .update(shops)
    .set({ isDemo: false })
    .where(and(eq(shops.id, shop.id), eq(shops.isDemo, true)))
    .returning({ id: shops.id });
  if (!converted) return NextResponse.json({ error: "fixture_changed" }, { status: 409 });
  cleanupLeases.set(hashBearerToken(cleanupLease), { shopId: shop.id, slug: shop.slug });
  return NextResponse.json({ orderId: result.order.id, cleanupLease });
}

export async function DELETE(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const parsed = cleanupBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const key = hashBearerToken(parsed.data.cleanupLease);
  const lease = cleanupLeases.get(key);
  if (!lease) return NextResponse.json({ error: "not_available" }, { status: 404 });
  // Reserve before any await so concurrent replays cannot both restore it.
  cleanupLeases.delete(key);
  try {
    const db = await getDb();
    await db
      .update(shops)
      .set({ isDemo: true })
      .where(and(eq(shops.id, lease.shopId), eq(shops.slug, lease.slug), eq(shops.isDemo, false)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A failed DB call did not use the lease; keep cleanup possible.
    cleanupLeases.set(key, lease);
    throw error;
  }
}
