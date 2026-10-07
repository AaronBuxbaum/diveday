import { randomBytes } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import type { AppDb } from "./client";
import { mergeDiverRecords } from "./diver-merge";
import { people, personRoles, shops, userAccounts } from "./schema";

/**
 * Two staff merging the same pair in opposite directions at the same instant.
 *
 * Every other merge test runs on PGlite, which is single-connection, so the
 * `FOR UPDATE` on both people rows has never been contended there. Without it
 * both transactions read two live records, both merge, and each record ends
 * up pointing at the other: a cycle the record page would redirect around
 * forever, with every row of history moved twice.
 *
 * The gate holds the same two rows the merge locks, so both contenders are
 * parked inside their transactions before it drops. As `waitForLockWaiters`
 * says, the wait is setup; the assertion is the outcome: exactly one pointer.
 */
async function pair(db: AppDb) {
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await db
    .insert(shops)
    .values({ name: `Merge Race ${suffix}`, slug: `merge-race-${suffix}`, timezone: "UTC" })
    .returning({ id: shops.id });
  if (!shop) throw new Error("shop insert returned no row");
  const rows = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Owner Person" },
      { shopId: shop.id, fullName: "Maya Rivera" },
      { shopId: shop.id, fullName: "Maya Rivera" },
    ])
    .returning({ id: people.id });
  const [owner, a, b] = rows;
  if (!owner || !a || !b) throw new Error("people insert returned no rows");
  await db.insert(personRoles).values([
    { personId: owner.id, role: "owner" },
    { personId: a.id, role: "diver" },
    { personId: b.id, role: "diver" },
  ]);
  await db.insert(userAccounts).values({
    personId: owner.id,
    email: `owner-${suffix}@example.com`,
    hashedPassword: "x",
    status: "active",
  });
  return { shopId: shop.id, ownerId: owner.id, a: a.id, b: b.id };
}

describePostgres("mergeDiverRecords under real concurrency", () => {
  it("lets one of two opposite merges win and never leaves a cycle", async () => {
    const pg = await postgresTestDb();
    const { shopId, ownerId, a, b } = await pair(pg.db);

    const gate = await holdRowLock(
      pg,
      sql`select id from people where id in (${a}, ${b}) order by id for update`,
    );
    const contenders = [
      mergeDiverRecords({
        db: pg.connect(),
        shopId,
        personId: a,
        survivorId: b,
        actorPersonId: ownerId,
      }),
      mergeDiverRecords({
        db: pg.connect(),
        shopId,
        personId: b,
        survivorId: a,
        actorPersonId: ownerId,
      }),
    ];
    await waitForLockWaiters(pg.db, contenders.length);
    await gate.release();

    const outcomes = await Promise.all(contenders);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok)).toEqual([
      { ok: false, reason: "already_merged" },
    ]);
    const pointers = await pg.db
      .select({ id: people.id, into: people.mergedIntoPersonId })
      .from(people)
      .where(inArray(people.id, [a, b]));
    expect(pointers.filter((row) => row.into !== null)).toHaveLength(1);
  });
});
