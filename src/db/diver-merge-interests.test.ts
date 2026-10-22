import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { mergeDiverRecords } from "./diver-merge";
import { issueInterestUnsubscribeToken, resolveInterestUnsubscribeToken } from "./interests";
import { interests, people, personRoles } from "./schema";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

async function twoRecords() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("merge fixture needs the seeded owner");
  const [source, survivor] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
      { shopId: shop.id, fullName: "Maya Rivera", email: "maya@example.com" },
    ])
    .returning();
  if (!source || !survivor) throw new Error("merge fixture people insert failed");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  return { db, shop, owner, source, survivor };
}

// Security review of #2656, minor 5: one person, two records. An unsubscribe
// either record made is that person's, and an old mail's link still works.
describe("diver record merge and the last-minute list", () => {
  it("keeps the merged-away record's unsubscribe, and its links", async () => {
    const { db, shop, owner, source, survivor } = await twoRecords();
    const unsubscribedAt = new Date("2026-01-02T00:00:00Z");
    const [gone, kept] = await db
      .insert(interests)
      .values([
        {
          shopId: shop.id,
          scope: "anytime",
          askedBy: "diver",
          personId: source.id,
          closedAt: unsubscribedAt,
          closedAs: "unsubscribed",
        },
        { shopId: shop.id, scope: "anytime", askedBy: "diver", personId: survivor.id },
      ])
      .returning();
    if (!gone || !kept) throw new Error("setup: interests missing");
    const token = await issueInterestUnsubscribeToken(db, { shopId: shop.id, interestId: gone.id });

    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);
    const [after] = await db.select().from(interests).where(eq(interests.id, kept.id));
    expect(after).toMatchObject({ closedAs: "unsubscribed", closedAt: unsubscribedAt });
    expect(await resolveInterestUnsubscribeToken(db, token)).toMatchObject({
      interestId: kept.id,
      alreadyUnsubscribed: true,
    });
  });
});
