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

function request(method: "POST" | "DELETE", body: unknown, authorized = true) {
  return new Request("http://localhost/api/test/seed-payment-overlay", {
    method,
    headers: {
      authorization: authorized ? `Bearer ${secret}` : "Bearer wrong",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function isDemo() {
  const [shop] = await ctx.db
    .select({ isDemo: shops.isDemo })
    .from(shops)
    .where(eq(shops.id, ctx.shop.id));
  return shop?.isDemo;
}

async function seed() {
  const response = await POST(request("POST", { shopSlug: slug }));
  expect(response.status).toBe(200);
  const result = await response.json();
  if (typeof result.orderId !== "string" || typeof result.cleanupLease !== "string") {
    throw new Error("Payment overlay fixture returned no order or cleanup lease");
  }
  return { orderId: result.orderId, cleanupLease: result.cleanupLease };
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

describe("the payment-overlay visual fixture", () => {
  it("refuses both handlers before the database when authorization is absent", async () => {
    expect((await POST(request("POST", { shopSlug: slug }, false))).status).toBe(404);
    expect((await DELETE(request("DELETE", { cleanupLease: "unknown" }, false))).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses malformed and canonical fixture requests before the database", async () => {
    for (const body of [
      { shopSlug: "blue-mantis" },
      { shopSlug: "../elsewhere" },
      { shopSlug: slug, personId: "caller-controlled" },
    ]) {
      expect((await POST(request("POST", body))).status).toBe(400);
    }
    expect((await DELETE(request("DELETE", { shopSlug: slug }))).status).toBe(400);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses missing and non-demo tenants before creating an invoice", async () => {
    const before = await ctx.db.select({ id: orders.id }).from(orders);
    expect((await POST(request("POST", { shopSlug: "missing-shop" }))).status).toBe(404);
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    expect((await POST(request("POST", { shopSlug: slug }))).status).toBe(404);
    expect(await ctx.db.select({ id: orders.id }).from(orders)).toEqual(before);
    expect(await isDemo()).toBe(false);
  });

  it("uses the real order writer and restores only its converted fixture through a one-use lease", async () => {
    const { orderId, cleanupLease } = await seed();
    try {
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
      // It cannot mint a second invoice after the fixture became non-demo.
      expect((await POST(request("POST", { shopSlug: slug }))).status).toBe(404);
    } finally {
      expect((await DELETE(request("DELETE", { cleanupLease }))).status).toBe(200);
    }
    expect(await isDemo()).toBe(true);
    vi.mocked(getDb).mockClear();
    expect((await DELETE(request("DELETE", { cleanupLease }))).status).toBe(404);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("cannot select or change a real tenant with an invalid or unknown cleanup lease", async () => {
    await ctx.db.update(shops).set({ isDemo: false }).where(eq(shops.id, ctx.shop.id));
    const [before] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    for (const body of [
      { cleanupLease: "not-a-lease" },
      { cleanupLease: "a".repeat(43) },
      { cleanupLease: "a".repeat(43), shopSlug: slug },
    ]) {
      expect((await DELETE(request("DELETE", body))).status).toBeGreaterThanOrEqual(400);
    }
    expect(getDb).not.toHaveBeenCalled();
    const [after] = await ctx.db.select().from(shops).where(eq(shops.id, ctx.shop.id));
    expect(after).toEqual(before);
  });
});
