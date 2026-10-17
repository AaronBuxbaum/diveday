import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { mergeDiverRecords } from "./diver-merge";
import { people, personRoles } from "./schema";

const ctx = fileScopedShopContext();

/** Two records of one diver and the seeded owner who merges them. */
async function mergeFixtures() {
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

/** A staffer's "seen diving dry" (#2136) travels as a pair with its author. */
describe("merging drysuit experience seen", () => {
  it("carries the source's recording onto a survivor without one", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db
      .update(people)
      .set({
        drysuitExperienceSeenAt: new Date("2026-09-01T00:00:00.000Z"),
        drysuitExperienceSeenByPersonId: owner.id,
        drysuitExperienceSeenNote: "earliest",
      })
      .where(eq(people.id, source.id));

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.drysuitExperienceSeenAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(merged?.drysuitExperienceSeenByPersonId).toBe(owner.id);
    expect(merged?.drysuitExperienceSeenNote).toBe("earliest");
  });

  it("keeps the earlier recording with its own author, never mixing the halves", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db
      .update(people)
      .set({
        drysuitExperienceSeenAt: new Date("2026-09-10T00:00:00.000Z"),
        drysuitExperienceSeenByPersonId: survivor.id,
        drysuitExperienceSeenNote: "later",
      })
      .where(eq(people.id, survivor.id));
    await db
      .update(people)
      .set({
        drysuitExperienceSeenAt: new Date("2026-09-01T00:00:00.000Z"),
        drysuitExperienceSeenByPersonId: owner.id,
        drysuitExperienceSeenNote: "earliest",
      })
      .where(eq(people.id, source.id));

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.drysuitExperienceSeenAt).toEqual(new Date("2026-09-01T00:00:00.000Z"));
    expect(merged?.drysuitExperienceSeenByPersonId).toBe(owner.id);
    expect(merged?.drysuitExperienceSeenNote).toBe("earliest");
  });

  it("leaves neither half set when neither record has one", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.drysuitExperienceSeenAt).toBeNull();
    expect(merged?.drysuitExperienceSeenByPersonId).toBeNull();
  });
});
