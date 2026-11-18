import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { anonymizeDiver } from "@/features/anonymize/store";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { tryLockBoardingEvidenceForReceipt } from "./boarding-certification-snapshot";
import type { AppDb } from "./client";
import { people } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

// These tests exercise only the proposed fence against the real erasure
// writer. They do not record receipts or prove device retention or reset safety.
describePostgres("receipt evidence fence and person erasure", () => {
  async function fixture() {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    if (!trip) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!seat || !owner) throw new Error("seat or owner missing");
    return { pg, shop, personId: seat.person.id, actorPersonId: owner.person.id };
  }

  it("keeps erasure behind an in-flight shared receipt fence", async () => {
    const { pg, shop, personId, actorPersonId } = await fixture();
    const held = await holdRowLock(
      pg,
      sql`select pg_advisory_xact_lock_shared(
      hashtext('boarding_certification_evidence'), hashtext(${shop.id}))`,
    );
    const erasure = anonymizeDiver(pg.connect(), { shopId: shop.id, personId, actorPersonId });
    void erasure.catch(() => undefined);
    onTestFinished(async () => {
      await held.release();
      await Promise.allSettled([erasure]);
    });
    try {
      const waiting = waitForLockWaiters(pg.db, 1);
      try {
        await Promise.race([
          waiting,
          erasure.then(() => {
            throw new Error("erasure finished without waiting");
          }),
        ]);
      } catch (error) {
        await held.release();
        await waiting.catch(() => undefined);
        throw error;
      }
      const blocked = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%pg_advisory_xact_lock(%boarding_certification_evidence%'`);
      expect(Number((blocked.rows[0] as { count: number }).count)).toBeGreaterThan(0);
      const [before] = await pg.db
        .select({ id: people.id, shopId: people.shopId, anonymizedAt: people.anonymizedAt })
        .from(people)
        .where(and(eq(people.id, personId), eq(people.shopId, shop.id)));
      expect(before).toMatchObject({ id: personId, shopId: shop.id, anonymizedAt: null });
    } finally {
      await held.release();
    }
    expect(await erasure).toMatchObject({ ok: true });
    const [after] = await pg.db
      .select({ id: people.id, shopId: people.shopId, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.shopId, shop.id)));
    expect(after).toMatchObject({ id: personId, shopId: shop.id });
    expect(after?.anonymizedAt).toBeInstanceOf(Date);
  });

  it("refuses the shared receipt fence while the real erasure is uncommitted", async () => {
    const { pg, shop, personId, actorPersonId } = await fixture();
    const [before] = await pg.db
      .select({ id: people.id, shopId: people.shopId, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(and(eq(people.id, personId), eq(people.shopId, shop.id)));
    expect(before).toMatchObject({ id: personId, shopId: shop.id, anonymizedAt: null });
    let release!: () => void;
    let ready!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const modified = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const connection = pg.connect();
    let firstTransaction = true;
    const delayed = new Proxy(connection, {
      get(targetDb, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) => {
            if (!firstTransaction) return targetDb.transaction(work);
            firstTransaction = false;
            return targetDb.transaction(async (tx) => {
              const result = await work(tx);
              ready();
              await hold;
              return result;
            });
          };
        }
        const value = Reflect.get(targetDb, property, receiver);
        return typeof value === "function" ? value.bind(targetDb) : value;
      },
    });
    const erasure = anonymizeDiver(delayed, { shopId: shop.id, personId, actorPersonId });
    void erasure.catch(() => undefined);
    onTestFinished(async () => {
      release();
      await Promise.allSettled([erasure]);
    });
    let acquired: boolean | undefined;
    try {
      await Promise.race([
        modified,
        erasure.then(() => {
          throw new Error("erasure ended before barrier");
        }),
      ]);
      acquired = await pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '1s'`);
        return tryLockBoardingEvidenceForReceipt(tx, shop.id);
      });
    } finally {
      release();
    }
    expect(await erasure).toMatchObject({ ok: true });
    const after = await pg.connect().transaction(async (tx) => {
      const acquired = await tryLockBoardingEvidenceForReceipt(tx, shop.id);
      const [person] = await tx
        .select({ id: people.id, shopId: people.shopId, anonymizedAt: people.anonymizedAt })
        .from(people)
        .where(and(eq(people.id, personId), eq(people.shopId, shop.id)));
      return { acquired, person };
    });
    expect(after.acquired).toBe(true);
    expect(after.person).toMatchObject({ id: personId, shopId: shop.id });
    expect(after.person?.anonymizedAt).toBeInstanceOf(Date);
    expect(acquired).toBe(false);
  });
});
