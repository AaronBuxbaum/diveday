import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { readActiveStaffRoles } from "../../db/authz";
import { tryLockBoardingEvidenceForReceipt } from "../../db/boarding-receipt-fence";
import type { AppDb } from "../../db/client";
import { people, personRoles, shops, userAccounts } from "../../db/schema/index";
import { isStaff, type Role } from "../../lib/authz";
import { describePostgres, postgresTestDb } from "../../test/postgres";
import { setStaffRoles } from "./store";

/**
 * **Staff role saves under real concurrency** (issue #4595). `setStaffRoles` takes the shop row
 * lock before it reads anything, so the baseline comparison and the last-owner check both run
 * with the other writer already committed. PGlite runs one session and never blocks, so only a
 * real server exercises it. The assertions are on the outcome, never on who won.
 */
describePostgres("setStaffRoles under real concurrency", () => {
  async function shopWith(roles: Role[][]) {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Roles ${suffix}`, slug: `roles-${suffix}`, timezone: "UTC" })
      .returning();
    const staff = await pg.db
      .insert(people)
      .values(
        roles.map((_, index) => ({
          shopId: shop.id,
          fullName: `Staff ${index}`,
          email: `staff-${index}-${suffix}@example.com`,
        })),
      )
      .returning();
    await pg.db
      .insert(personRoles)
      .values(
        staff.flatMap((person, index) =>
          (roles[index] ?? []).map((role) => ({ personId: person.id, role })),
        ),
      );
    return { db: pg.db, pg, shop, staff };
  }

  it("lets exactly one of two saves from the same baseline win", async () => {
    const { db, shop, staff } = await shopWith([["owner"], ["crew"]]);
    const target = staff[1];
    const save = (roles: Role[]) =>
      setStaffRoles(db, { shopId: shop.id, personId: target.id, roles, baseline: ["crew"] });
    const results = await Promise.all([save(["captain"]), save(["divemaster"])]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: "roles_conflict" },
    ]);
  });

  it("never lets two simultaneous demotions remove the last owners", async () => {
    const { db, shop, staff } = await shopWith([["owner"], ["owner"]]);
    const demote = (personId: string) =>
      setStaffRoles(db, { shopId: shop.id, personId, roles: ["manager"] });
    const results = await Promise.all(staff.map((person) => demote(person.id)));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const owners = await db
      .select({ id: personRoles.personId })
      .from(personRoles)
      .where(eq(personRoles.role, "owner"));
    expect(owners.filter((row) => staff.some((person) => person.id === row.id))).toHaveLength(1);
  });

  it("orders a staff-role revocation after an in-flight receipt fence", async () => {
    const { pg, shop, staff } = await shopWith([["owner"], ["crew"]]);
    const target = staff[1];
    if (!target) throw new Error("staff fixture missing");
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const receipt = pg.connect().transaction(async (tx) => {
      expect(await tryLockBoardingEvidenceForReceipt(tx, shop.id)).toBe(true);
      ready();
      await gate;
    });
    void receipt.catch(() => undefined);
    let revoke: ReturnType<typeof setStaffRoles> | undefined;
    let stop = false;
    let observing: Promise<boolean> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    onTestFinished(async () => {
      stop = true;
      release();
      await Promise.allSettled([
        receipt,
        ...(revoke ? [revoke] : []),
        ...(observing ? [observing] : []),
      ]);
    });
    try {
      await Promise.race([
        locked,
        receipt.then(() => {
          throw new Error("receipt lock was not held");
        }),
      ]);
      revoke = setStaffRoles(pg.connect(), { shopId: shop.id, personId: target.id, roles: [] });
      void revoke.catch(() => undefined);
      observing = (async () => {
        while (!stop) {
          const rows = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and query like '%pg_advisory_xact_lock(%boarding_certification_evidence%'`);
          if (Number((rows.rows[0] as { count: number }).count) > 0) return true;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
      })();
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("revocation did not reach the fence")), 2_000);
      });
      const blocked = await Promise.race([observing, revoke.then(() => false), timedOut]);
      expect(
        blocked,
        "revocation committed before the receipt transaction released its fence",
      ).toBe(true);
      expect(
        await pg.db
          .select({ role: personRoles.role })
          .from(personRoles)
          .where(eq(personRoles.personId, target.id)),
      ).toEqual([{ role: "crew" }]);
    } finally {
      clearTimeout(deadline);
      stop = true;
      release();
      if (observing) await observing;
    }
    await receipt;
    expect(await revoke).toMatchObject({ ok: true });
    expect(
      await pg.db
        .select({ role: personRoles.role })
        .from(personRoles)
        .where(eq(personRoles.personId, target.id)),
    ).toEqual([]);
  });

  it("refuses the receipt fence while staff-role revocation is uncommitted", async () => {
    const { pg, shop, staff } = await shopWith([["owner"], ["crew"]]);
    const target = staff[1];
    if (!target) throw new Error("staff fixture missing");
    await pg.db
      .insert(userAccounts)
      .values({ personId: target.id, email: `crew-${target.id}@example.com` });
    expect(await readActiveStaffRoles(pg.db, shop.id, target.id)).toContain("crew");
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const modified = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const connection = pg.connect();
    const delayed = new Proxy(connection, {
      get(targetDb, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            targetDb.transaction(async (tx) => {
              const result = await work(tx);
              ready();
              await gate;
              return result;
            });
        }
        const value = Reflect.get(targetDb, property, receiver);
        return typeof value === "function" ? value.bind(targetDb) : value;
      },
    });
    const revoke = setStaffRoles(delayed, { shopId: shop.id, personId: target.id, roles: [] });
    void revoke.catch(() => undefined);
    onTestFinished(async () => {
      release();
      await Promise.allSettled([revoke]);
    });
    let during:
      | { acquired: boolean; roles: Awaited<ReturnType<typeof readActiveStaffRoles>> }
      | undefined;
    try {
      await Promise.race([
        modified,
        revoke.then(() => {
          throw new Error("revocation ended before barrier");
        }),
      ]);
      during = await pg.connect().transaction(async (tx) => {
        const acquired = await tryLockBoardingEvidenceForReceipt(tx, shop.id);
        return {
          acquired,
          roles: acquired ? await readActiveStaffRoles(tx, shop.id, target.id) : null,
        };
      });
    } finally {
      release();
    }
    expect(await revoke).toMatchObject({ ok: true });
    const after = await pg.connect().transaction(async (tx) => {
      const acquired = await tryLockBoardingEvidenceForReceipt(tx, shop.id);
      return { acquired, roles: await readActiveStaffRoles(tx, shop.id, target.id) };
    });
    expect(after.acquired).toBe(true);
    expect(after.roles).not.toBeNull();
    expect(isStaff(after.roles ?? [])).toBe(false);
    expect(during?.acquired, "receipt fence must refuse while role revocation is uncommitted").toBe(
      false,
    );
  });
});
