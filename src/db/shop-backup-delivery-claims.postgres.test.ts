import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { shopBackupDeliveries } from "./schema";
import { claimShopBackupDelivery, finishShopBackupDelivery } from "./shop-backup-delivery-claims";

describePostgres("shop backup delivery claims", () => {
  it("admits one simultaneous scheduled start per shop and ISO week", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db, "Backup claim race");
    const now = new Date("2035-04-02T04:00:00.000Z");
    const periodKey = "2035-W14";

    const results = await Promise.all(
      [pg.connect(), pg.connect()].map((db) =>
        claimShopBackupDelivery(db, {
          shopId: shop.id,
          periodKey,
          token: randomUUID(),
          now,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "in_progress")).toHaveLength(1);
    expect(results.find((result) => result.status === "claimed")).toMatchObject({
      attemptNumber: 1,
    });

    const otherShop = await raceShop(pg.db, "Backup claim other shop");
    await expect(
      claimShopBackupDelivery(pg.connect(), {
        shopId: otherShop.id,
        periodKey,
        token: randomUUID(),
        now,
      }),
    ).resolves.toMatchObject({ status: "claimed", attemptNumber: 1 });
  });

  it("reclaims an expired run and fences off its late completion", async () => {
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db, "Backup claim recovery");
    const periodKey = "2035-W14";
    const firstNow = new Date("2035-04-02T04:00:00.000Z");
    const firstToken = randomUUID();
    const firstClaim = await claimShopBackupDelivery(pg.connect(), {
      shopId: shop.id,
      periodKey,
      token: firstToken,
      now: firstNow,
    });
    expect(firstClaim).toMatchObject({ status: "claimed", attemptNumber: 1 });

    const [firstDelivery] = await pg.db
      .insert(shopBackupDeliveries)
      .values({ shopId: shop.id, periodKey, trigger: "scheduled", status: "started" })
      .returning();
    if (!firstDelivery) throw new Error("first backup delivery was not created");

    const secondNow = new Date(firstNow.getTime() + 11 * 60_000);
    const secondToken = randomUUID();
    const secondClaim = await claimShopBackupDelivery(pg.connect(), {
      shopId: shop.id,
      periodKey,
      token: secondToken,
      now: secondNow,
    });
    expect(secondClaim).toMatchObject({ status: "claimed", attemptNumber: 2 });

    await expect(
      finishShopBackupDelivery(pg.connect(), {
        shopId: shop.id,
        periodKey,
        token: firstToken,
        deliveryId: firstDelivery.id,
        objectKey: "diveday-backup-shop-2035-W14-attempt-1.zip",
        byteCount: 100,
        now: secondNow,
      }),
    ).resolves.toBe("superseded");

    const [secondDelivery] = await pg.db
      .insert(shopBackupDeliveries)
      .values({ shopId: shop.id, periodKey, trigger: "scheduled", status: "started" })
      .returning();
    if (!secondDelivery) throw new Error("second backup delivery was not created");
    await expect(
      finishShopBackupDelivery(pg.connect(), {
        shopId: shop.id,
        periodKey,
        token: secondToken,
        deliveryId: secondDelivery.id,
        objectKey: "diveday-backup-shop-2035-W14-attempt-2.zip",
        byteCount: 200,
        now: secondNow,
      }),
    ).resolves.toBe("succeeded");

    const rows = await pg.db
      .select()
      .from(shopBackupDeliveries)
      .where(
        and(
          eq(shopBackupDeliveries.shopId, shop.id),
          eq(shopBackupDeliveries.periodKey, periodKey),
        ),
      );
    expect(rows.map((row) => row.status).sort()).toEqual(["succeeded", "superseded"]);
    expect(rows.find((row) => row.status === "superseded")?.objectKey).toContain("attempt-1.zip");
    await expect(
      claimShopBackupDelivery(pg.connect(), {
        shopId: shop.id,
        periodKey,
        token: randomUUID(),
        now: new Date(secondNow.getTime() + 11 * 60_000),
      }),
    ).resolves.toEqual({ status: "already_delivered" });
  });
});
