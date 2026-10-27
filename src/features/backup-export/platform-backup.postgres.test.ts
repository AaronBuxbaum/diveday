import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { platformBackupProgress, shops } from "@/db/schema";
import { claimPlatformBackupShop, finishPlatformBackupShop } from "./platform-backup";

describePostgres("platform backup progress under real concurrency", () => {
  it("admits one overlapping invocation for a shop and records only its completion", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Platform backup lease", slug: `platform-backup-${randomUUID()}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert failed");

    const now = new Date("2026-10-26T05:00:00Z");
    const tokens = [randomUUID(), randomUUID()];
    const clients = [pg.db, pg.connect()];
    const claims = await Promise.all(
      tokens.map((token, index) => {
        const client = clients[index];
        if (!client) throw new Error("database connection missing");
        return claimPlatformBackupShop(client, {
          shopId: shop.id,
          token,
          now,
        });
      }),
    );

    expect(claims.filter(Boolean)).toHaveLength(1);
    const winner = tokens[claims[0] ? 0 : 1];
    if (!winner) throw new Error("winning lease token missing");
    expect(
      await finishPlatformBackupShop(pg.db, {
        shopId: shop.id,
        token: winner,
        succeeded: true,
        now: new Date(now.getTime() + 1_000),
      }),
    ).toBe(true);

    const [progress] = await pg.db
      .select()
      .from(platformBackupProgress)
      .where(eq(platformBackupProgress.shopId, shop.id));
    expect(progress).toMatchObject({
      shopId: shop.id,
      lastAttemptAt: now,
      lastSuccessAt: new Date(now.getTime() + 1_000),
      leaseToken: null,
      leaseUntil: null,
    });
  });
});
