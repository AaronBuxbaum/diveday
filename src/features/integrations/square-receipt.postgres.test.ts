import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { recordCounterOrder } from "@/db/orders";
import { collectionEntries, integrationSyncRecords, shops } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { nowMs } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { linkSquareReceipt } from "./square-store";
import { recordShopIntegration } from "./store";

afterEach(() => vi.unstubAllEnvs());

describePostgres("Square receipt concurrency", () => {
  it("racing matches of one manual receipt never append another fee-bearing collection", async () => {
    vi.stubEnv("SQUARE_CLIENT_ID", "test-client");
    vi.stubEnv("SQUARE_CLIENT_SECRET", "test-secret");
    vi.stubEnv("SQUARE_ENVIRONMENT", "sandbox");
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    await pg.db.update(shops).set({ isDemo: false }).where(eq(shops.id, shop.id));
    const personId = await seededStaffPersonId(pg.db, shop.id, SEEDED_OWNER_EMAIL);
    const order = await recordCounterOrder(pg.db, {
      shopId: shop.id,
      personId,
      createdByPersonId: personId,
      collection: "cash",
      lineItems: [
        { kind: "other", description: "Counter purchase", quantity: 1, unitAmountCents: 10000 },
      ],
    });
    if (!order.ok) throw new Error("order missing");
    const connection = await recordShopIntegration(pg.db, {
      shopId: shop.id,
      provider: "square",
      externalAccountId: "merchant",
      settings: { environment: "sandbox", squareLocationId: "location" },
      credentials: {
        merchantId: "merchant",
        accessToken: "test-access",
        refreshToken: "test-refresh",
        expiresAt: nowMs() + 3600000,
      },
    });
    const input = { shopId: shop.id, personId, orderId: order.order.id, paymentId: "payment" };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () =>
      Response.json({
        payment: {
          id: "payment",
          location_id: "location",
          status: "COMPLETED",
          total_money: { amount: 10000, currency: "USD" },
        },
      }),
    );
    const before = await pg.db
      .select()
      .from(collectionEntries)
      .where(eq(collectionEntries.sourceId, order.order.id));
    const gate = await holdRowLock(
      pg,
      sql`select id from shop_integrations where id = ${connection.id} for update`,
    );
    const first = linkSquareReceipt(pg.connect(), input, fetchImpl);
    const second = linkSquareReceipt(pg.connect(), input, fetchImpl);
    await waitForLockWaiters(pg.db, 2);
    await gate.release();
    expect(await Promise.all([first, second])).toEqual(["matched", "matched"]);
    expect(
      await pg.db
        .select()
        .from(collectionEntries)
        .where(eq(collectionEntries.sourceId, order.order.id)),
    ).toEqual(before);
    expect(
      await pg.db
        .select()
        .from(integrationSyncRecords)
        .where(eq(integrationSyncRecords.provider, "square")),
    ).toHaveLength(1);
  });
});
