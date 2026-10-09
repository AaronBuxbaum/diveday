import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { orders, paymentDisputes, people } = await import("@/db/schema");
const { OrderDisputeBanner, OrderMeta } = await import("./OrderMeta");

/** A seeded paid order with an undecided dispute on it. */
async function disputedOrder() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
  if (!person) throw new Error("seeded person missing");
  const [order] = await db
    .insert(orders)
    .values({
      shopId: shop.id,
      personId: person.id,
      createdByPersonId: person.id,
      status: "paid",
      currency: "usd",
      totalCents: 5_000,
      amountPaidCents: 5_000,
      stripeAccountId: "acct_demo",
      stripeCustomerId: "cus_banner",
      stripeInvoiceId: "in_banner",
    })
    .returning();
  if (!order) throw new Error("order insert failed");
  const now = new Date("2026-10-09T12:00:00Z");
  await db.insert(paymentDisputes).values({
    shopId: shop.id,
    stripeAccountId: "acct_demo",
    stripeDisputeId: "dp_banner",
    stripePaymentIntentId: "pi_banner",
    orderId: order.id,
    amountCents: 5_000,
    currency: "usd",
    status: "needs_response",
    evidenceDueBy: new Date("2026-10-17T12:00:00Z"),
    openedAt: now,
    lastEventAt: now,
  });
  return { db, shop, order };
}

describe("OrderDisputeBanner", () => {
  it("shows the dispute to someone who may read the shop's money", async () => {
    const { db, shop, order } = await disputedOrder();
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    const banner = await OrderDisputeBanner({
      shop,
      orderId: order.id,
      session: { user: { personId: owner } },
      locale: "en-US",
    });
    expect(banner).not.toBeNull();
  });

  it("shows nothing to crew, the same gate Today's dispute row keeps", async () => {
    const { db, shop, order } = await disputedOrder();
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    const banner = await OrderDisputeBanner({
      shop,
      orderId: order.id,
      session: { user: { personId: captain } },
      locale: "en-US",
    });
    expect(banner).toBeNull();
  });
});

describe("OrderMeta", () => {
  async function metaText(createdBy: { name: string | null; online: boolean }) {
    const { order, shop } = await disputedOrder();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { staffTranslator } = await import("@/i18n/staff-messages");
    const element = await OrderMeta({
      order,
      personId: order.personId,
      createdBy,
      shopSlug: shop.slug,
      locale: "en-US",
      timezone: "UTC",
      t: staffTranslator("en-US"),
    });
    return renderToStaticMarkup(element);
  }

  it("says a diver's own purchase was bought online, never that they raised it", async () => {
    const html = await metaText({ name: "Ola Online", online: true });
    expect(html).toContain("bought online");
    expect(html).not.toContain("by Ola Online");
  });

  it("names the staffer who raised an order", async () => {
    expect(await metaText({ name: "Dana Desk", online: false })).toContain("by Dana Desk");
  });
});
