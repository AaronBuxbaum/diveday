import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { refreshCanonicalDemoSchedule } from "./demo-refresh";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import { executedDives, people, personRoles, shops, trips, userAccounts } from "./schema";
import { seedDemo } from "./seed";
import { AT_SEA_DAY_TITLE } from "./seed-boat-at-sea";

describePostgres("the canonical demo refresh identity lock", () => {
  it("keeps the refresh ahead of concurrent shop, role, and account identity edits", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, { history: false });
    const [shop] = await pg.db
      .select({ id: shops.id })
      .from(shops)
      .where(eq(shops.slug, DEMO_SHOP_SLUG))
      .limit(1);
    if (!shop) throw new Error("canonical demo shop missing");
    const [owner] = await pg.db
      .select({ personId: people.id, accountId: userAccounts.id, role: personRoles.role })
      .from(userAccounts)
      .innerJoin(people, eq(people.id, userAccounts.personId))
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("canonical demo owner account missing");

    const gate = await holdRowLock(
      pg,
      sql`select id from user_accounts where id = ${owner.accountId} for update`,
    );
    const refresh = refreshCanonicalDemoSchedule(pg.connect(), { minRunwayDays: 10_000 });
    await waitForLockWaiters(pg.db, 1);

    const suffix = randomBytes(4).toString("hex");
    const accountEdit = pg.db
      .update(userAccounts)
      .set({ email: `owner-${suffix}@real-shop.example` })
      .where(eq(userAccounts.id, owner.accountId))
      .then(() => undefined);
    const shopEdit = pg.db
      .update(shops)
      .set({ isDemo: false })
      .where(eq(shops.id, shop.id))
      .then(() => undefined);
    const roleEdit = pg.db
      .delete(personRoles)
      .where(and(eq(personRoles.personId, owner.personId), eq(personRoles.role, "owner")))
      .then(() => undefined);
    await waitForLockWaiters(pg.db, 4);
    await gate.release();

    await expect(refresh).resolves.toMatchObject({ found: true, refreshed: true });
    await Promise.all([accountEdit, shopEdit, roleEdit]);

    const boats = await pg.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), eq(trips.title, AT_SEA_DAY_TITLE)));
    expect(boats).toHaveLength(1);
    const [boat] = boats;
    const diveTwo = boat
      ? await pg.db
          .select({ id: executedDives.id })
          .from(executedDives)
          .where(and(eq(executedDives.tripId, boat.id), eq(executedDives.diveNumber, 2)))
      : [];
    expect(diveTwo).toHaveLength(0);
    const [updatedAccount] = await pg.db
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .where(eq(userAccounts.id, owner.accountId));
    expect(updatedAccount?.email).toBe(`owner-${suffix}@real-shop.example`);
    const [updatedShop] = await pg.db
      .select({ isDemo: shops.isDemo })
      .from(shops)
      .where(eq(shops.id, shop.id));
    expect(updatedShop?.isDemo).toBe(false);
    const ownerRoles = await pg.db
      .select({ personId: personRoles.personId })
      .from(personRoles)
      .where(and(eq(personRoles.personId, owner.personId), eq(personRoles.role, "owner")));
    expect(ownerRoles).toHaveLength(0);
  });
});
