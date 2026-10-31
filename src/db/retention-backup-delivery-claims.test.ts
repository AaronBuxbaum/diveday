import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { RETENTION_DAYS } from "@/lib/retention";
import { fileScopedShopContext } from "@/test/db";
import { pruneExpiredRecords } from "./retention";
import { shopBackupDeliveryClaims } from "./schema";

const context = fileScopedShopContext();
const NOW = new Date("2026-08-03T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

describe("backup delivery claim retention", () => {
  it("keeps active and recent completed claims, pruning old terminal timestamps", async () => {
    const { db, shop } = await context;
    const oldCompleted = "old-completed";
    const recentCompleted = "recent-completed";
    const oldExpired = "old-expired";
    const active = "active";
    await db.insert(shopBackupDeliveryClaims).values([
      {
        shopId: shop.id,
        periodKey: oldCompleted,
        attemptNumber: 1,
        completedAt: daysAgo(RETENTION_DAYS.shop_backup_delivery_claims + 1),
      },
      {
        shopId: shop.id,
        periodKey: recentCompleted,
        attemptNumber: 1,
        completedAt: daysAgo(RETENTION_DAYS.shop_backup_delivery_claims - 1),
      },
      {
        shopId: shop.id,
        periodKey: oldExpired,
        attemptNumber: 1,
        leaseToken: "00000000-0000-4000-8000-000000000002",
        leaseUntil: daysAgo(RETENTION_DAYS.shop_backup_delivery_claims + 1),
      },
      {
        shopId: shop.id,
        periodKey: active,
        attemptNumber: 1,
        leaseToken: "00000000-0000-4000-8000-000000000001",
        leaseUntil: new Date(NOW.getTime() + DAY_MS),
      },
    ]);

    const summary = await pruneExpiredRecords(db, { now: NOW });
    const remaining = await db
      .select({ periodKey: shopBackupDeliveryClaims.periodKey })
      .from(shopBackupDeliveryClaims)
      .where(eq(shopBackupDeliveryClaims.shopId, shop.id));

    expect(
      summary.outcomes.find((row) => row.table === "shop_backup_delivery_claims")?.deleted,
    ).toBe(2);
    expect(remaining.map((row) => row.periodKey).sort()).toEqual([active, recentCompleted].sort());
  });
});
