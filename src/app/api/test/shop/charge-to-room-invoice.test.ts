import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getOrder } from "@/db/orders";
import { orders, shops } from "@/db/schema";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "@/db/stripe-accounts";
import { fileScopedShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { DELETE, POST } = await import("./route");
const ctx = fileScopedShopContext();
const slug = "payment-overlay-private";
const secret = "payment-overlay-test-secret";

function seedRequest(shopSlug: string, authorized = true) {
  return new Request("http://localhost/api/test/shop", {
    method: "POST",
    headers: {
      authorization: authorized ? `Bearer ${secret}` : "Bearer wrong",
      "content-type": "application/json",
    },
    body: JSON.stringify({ slug: shopSlug, facts: ["chargeToRoomInvoice"] }),
  });
}

function teardown(shopSlug: string) {
  return new Request(`http://localhost/api/test/shop?slug=${shopSlug}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${secret}` },
  });
}

async function isDemo() {
  const [shop] = await ctx.db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, ctx.shop.id));
  return shop?.isDemo;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DIVEDAY_E2E_SECRET", secret);
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  await ctx.db.update(shops).set({ slug }).where(eq(shops.id, ctx.shop.id));
  const account = await upsertShopStripeAccount(ctx.db, ctx.shop.id, "acct_overlay_fixture");
  await setShopStripeAccountStatus(ctx.db, account.stripeAccountId, {
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("the chargeToRoomInvoice fact", () => {
  it("refuses before the database when authorization is absent", async () => {
    expect((await POST(seedRequest(slug, false))).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses missing and non-demo tenants before creating an invoice", async () => {
    const before = await ctx.db.select({ id: orders.id }).from(orders);
    expect((await POST(seedRequest("missing-shop"))).status).toBe(404);
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    expect((await POST(seedRequest(slug))).status).toBe(404);
    expect(await ctx.db.select({ id: orders.id }).from(orders)).toEqual(before);
    expect(await isDemo()).toBe(false);
  });

  it("uses the real order writer, and only this server's teardown takes the shop back", async () => {
    const response = await POST(seedRequest(slug));
    expect(response.status).toBe(200);
    const { orderId } = (await response.json()).values.chargeToRoomInvoice as { orderId: string };
    const order = await getOrder(ctx.db, ctx.shop.id, orderId);
    expect(order?.order).toMatchObject({
      shopId: ctx.shop.id,
      status: "open",
      collection: "stripe_invoice",
      amountPaidCents: 0,
      totalCents: 18_000,
    });
    expect(order?.lineItems).toHaveLength(1);
    expect(await isDemo()).toBe(false);
    // No second fact reaches it once it is real-shaped.
    expect((await POST(seedRequest(slug))).status).toBe(404);

    expect(await (await DELETE(teardown(slug))).json()).toEqual({ ok: true, dropped: true });
    const [gone] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(gone).toBeUndefined();
  });

  it("leaves a real tenant this server never converted where it is", async () => {
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    const [before] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(await (await DELETE(teardown(slug))).json()).toEqual({ ok: true, dropped: false });
    const [after] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(after).toEqual(before);
  });
});
