import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  mergeDiverRecords,
  PERSON_COLUMNS_DELETED_ON_MERGE,
  PERSON_COLUMNS_DELIBERATELY_UNMOVED,
} from "./diver-merge";
import { notificationSendQueue, people, personRoles, trips } from "./schema";

const ctx = fileScopedShopContext();

describe("diver merge person-column coverage", () => {
  it("classifies prefixed person columns too", async () => {
    const { db } = ctx;
    const result = await db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and column_name like '%person_id'
        and column_name <> 'person_id'
      order by table_name, column_name
    `);
    const columns = result.rows.map((row) => {
      const { table_name, column_name } = row as { table_name: string; column_name: string };
      return `${table_name}.${column_name}`;
    });
    expect(columns.length).toBeGreaterThan(20);
    const classified = new Set([
      ...Object.keys(PERSON_COLUMNS_DELIBERATELY_UNMOVED),
      ...Object.keys(PERSON_COLUMNS_DELETED_ON_MERGE),
    ]);
    expect(columns.filter((pair) => !classified.has(pair))).toEqual([]);
    expect([...classified].filter((pair) => !columns.includes(pair)).sort()).toEqual([]);
  });
});

describe("diver merge and subject-bound notification retries", () => {
  it("discards source-bound sealed retries without touching the survivor's retries", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [source, survivor] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
        { shopId: shop.id, fullName: "Maya Rivera", email: "survivor-merge@example.com" },
      ])
      .returning();
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!owner || !source || !survivor || !trip) throw new Error("merge fixture missing");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const at = nowDate();
    const [sourceRetry] = await db
      .insert(notificationSendQueue)
      .values({
        shopId: shop.id,
        idempotencyKey: `merge-source-${source.id}`,
        payloadSealed: "sealed-source-payload",
        recipientPersonId: source.id,
        status: "queued",
        nextAttemptAt: at,
      })
      .returning({ id: notificationSendQueue.id });
    const [survivorRetry] = await db
      .insert(notificationSendQueue)
      .values({
        shopId: shop.id,
        idempotencyKey: `merge-survivor-${survivor.id}`,
        payloadSealed: "sealed-survivor-payload",
        recipientPersonId: survivor.id,
        status: "queued",
        nextAttemptAt: at,
      })
      .returning({ id: notificationSendQueue.id });
    if (!sourceRetry || !survivorRetry) throw new Error("expected queued retry rows");

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toMatchObject({ ok: true, mergedPersonId: source.id, survivorId: survivor.id });

    const rows = await db
      .select({ id: notificationSendQueue.id })
      .from(notificationSendQueue)
      .where(inArray(notificationSendQueue.id, [sourceRetry.id, survivorRetry.id]));
    expect(rows.map(({ id }) => id)).toEqual([survivorRetry.id]);
  });
});
