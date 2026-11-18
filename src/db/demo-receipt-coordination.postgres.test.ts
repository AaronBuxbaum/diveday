import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  lockDemoResetEvidenceFirst,
  tryLockBoardingEvidenceForReceipt,
} from "./boarding-certification-snapshot";
import { people, personRoles, shops, userAccounts } from "./schema";

// Tests an uncalled ordering helper, not production reset, durable intake, or
// generation preservation. Existing destructive-reset regressions stay red.
describePostgres("proposed demo reset evidence-first gate", () => {
  async function fixture() {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Demo", slug: "demo-order-test", timezone: "UTC", isDemo: true })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Owner" })
      .returning();
    if (!owner) throw new Error("owner missing");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
    await pg.db.insert(userAccounts).values({ personId: owner.id, email: "owner@demo.invalid" });
    return { pg, shop, owner };
  }

  it("acquires the exclusive evidence fence before waiting on the shop identity row", async () => {
    const { pg, shop } = await fixture();
    const heldShop = await holdRowLock(
      pg,
      sql`select id from shops where id = ${shop.id} for no key update`,
    );
    const gate = pg.connect().transaction((tx) => lockDemoResetEvidenceFirst(tx, shop.id));
    void gate.catch(() => undefined);
    onTestFinished(async () => {
      await heldShop.release();
      await Promise.allSettled([gate]);
    });
    try {
      const waiting = waitForLockWaiters(pg.db, 1);
      try {
        await Promise.race([
          waiting,
          gate.then(() => {
            throw new Error("gate did not wait for shop");
          }),
        ]);
      } catch (error) {
        await heldShop.release();
        await waiting.catch(() => undefined);
        throw error;
      }
      const waitingShop =
        await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%from "shops"%for no key update%'`);
      expect(Number((waitingShop.rows[0] as { count: number }).count)).toBeGreaterThan(0);
      const acquired = await pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '1s'`);
        return tryLockBoardingEvidenceForReceipt(tx, shop.id);
      });
      expect(acquired).toBe(false);
    } finally {
      await heldShop.release();
    }
    expect(await gate).toBe(true);
  });

  it("waits behind a shared receipt fence and reuses the unchanged demo identity gate", async () => {
    const { pg, shop } = await fixture();
    const held = await holdRowLock(
      pg,
      sql`select pg_advisory_xact_lock_shared(
      hashtext('boarding_certification_evidence'), hashtext(${shop.id}))`,
    );
    const gate = pg.connect().transaction((tx) => lockDemoResetEvidenceFirst(tx, shop.id));
    void gate.catch(() => undefined);
    onTestFinished(async () => {
      await held.release();
      await Promise.allSettled([gate]);
    });
    try {
      const waiting = waitForLockWaiters(pg.db, 1);
      try {
        await Promise.race([
          waiting,
          gate.then(() => {
            throw new Error("gate did not wait for fence");
          }),
        ]);
      } catch (error) {
        await held.release();
        await waiting.catch(() => undefined);
        throw error;
      }
      const rows = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%pg_advisory_xact_lock(%boarding_certification_evidence%'`);
      expect(Number((rows.rows[0] as { count: number }).count)).toBeGreaterThan(0);
    } finally {
      await held.release();
    }
    expect(await gate).toBe(true);
  });

  it("refuses a non-demo shop and requires READ COMMITTED within a transaction", async () => {
    const { pg } = await fixture();
    const [other] = await pg.db
      .insert(shops)
      .values({ name: "Real", slug: "real-order-test", timezone: "UTC", isDemo: false })
      .returning();
    if (!other) throw new Error("shop missing");
    expect(await pg.connect().transaction((tx) => lockDemoResetEvidenceFirst(tx, other.id))).toBe(
      false,
    );
    await expect(lockDemoResetEvidenceFirst(pg.db, other.id)).rejects.toThrow(
      "requires a transaction",
    );
    await expect(
      pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read`);
        return lockDemoResetEvidenceFirst(tx, other.id);
      }),
    ).rejects.toThrow("READ COMMITTED");
  });

  it("inherits the demo identity gate for real emails, missing roles, and unknown shops", async () => {
    const { pg, shop, owner } = await fixture();
    await pg.db
      .update(userAccounts)
      .set({ email: "owner@example.com" })
      .where(eq(userAccounts.personId, owner.id));
    expect(await pg.connect().transaction((tx) => lockDemoResetEvidenceFirst(tx, shop.id))).toBe(
      false,
    );
    await pg.db.delete(personRoles).where(eq(personRoles.personId, owner.id));
    expect(await pg.connect().transaction((tx) => lockDemoResetEvidenceFirst(tx, shop.id))).toBe(
      false,
    );
    expect(
      await pg
        .connect()
        .transaction((tx) =>
          lockDemoResetEvidenceFirst(tx, "00000000-0000-0000-0000-000000000000"),
        ),
    ).toBe(false);
  });
});
