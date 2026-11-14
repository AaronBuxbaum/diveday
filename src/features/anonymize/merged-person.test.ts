import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { mergeDiverRecords } from "../../db/diver-merge";
import { people, personRoles } from "../../db/schema/index";
import { fileScopedShopContext } from "../../test/db";
import { anonymizeDiver } from "./store";

const fileCtx = fileScopedShopContext({ history: true });

async function erasureFixtures() {
  const { db, shop } = fileCtx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return { db, shop, owner };
}

it("clears a directly erased person's staff portrait path", async () => {
  const { db, shop, owner } = await erasureFixtures();
  const [person] = await db
    .insert(people)
    .values({
      shopId: shop.id,
      fullName: "Portrait subject",
      staffPhotoPath: "/demo-staff/dana-reyes.webp",
    })
    .returning();
  await db.insert(personRoles).values({ personId: person.id, role: "diver" });
  expect(
    (await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: owner.id }))
      .ok,
  ).toBe(true);
  const [after] = await db.select().from(people).where(eq(people.id, person.id));
  expect(after.staffPhotoPath).toBeNull();
});

describe("anonymizeDiver — a merged-away record (issue #1014)", () => {
  /**
   * After a merge the source keeps every identifying column, and contact fields
   * only move onto the survivor where the survivor's own was null — so the
   * source's distinct email and phone live on that shell and nowhere else. The
   * shell is unreachable by hand (the diver page redirects a merged id to the
   * survivor before rendering, and that page holds the only erase form), so if
   * erasure does not follow the pointer nothing ever can.
   */
  it("erases the shell a merge left behind", async () => {
    const { db, shop, owner } = await erasureFixtures();
    const [source, survivor] = await db
      .insert(people)
      .values([
        {
          shopId: shop.id,
          fullName: "Adaeze Nwosu",
          email: "adaeze@old.example",
          staffPhotoPath: "/demo-staff/dana-reyes.webp",
          phone: "+1 (305) 555-0142",
          dateOfBirth: "1990-04-02",
          emergencyContactName: "Ngozi Nwosu",
          emergencyContactPhone: "+1 (305) 555-0143",
        },
        // The same date on both: a name and a date agree, so the merge needs
        // no "two people" acknowledgement (`assessMerge`).
        {
          shopId: shop.id,
          fullName: "Adaeze Nwosu",
          email: "adaeze@new.example",
          dateOfBirth: "1990-04-02",
        },
      ])
      .returning();
    if (!source || !survivor) throw new Error("fixture insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);

    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(erased.ok).toBe(true);

    const rows = await db
      .select()
      .from(people)
      .where(inArray(people.id, [source.id, survivor.id]));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.fullName).not.toBe("Adaeze Nwosu");
      expect(row.staffPhotoPath).toBeNull();
      expect(row.email).toBeNull();
      expect(row.phone).toBeNull();
      expect(row.dateOfBirth).toBeNull();
      expect(row.emergencyContactName).toBeNull();
      expect(row.emergencyContactPhone).toBeNull();
      expect(row.anonymizedAt).not.toBeNull();
    }
    // The pointer and its stamps survive: what goes is the identity, not the row.
    const shell = rows.find((row) => row.id === source.id);
    expect(shell?.mergedIntoPersonId).toBe(survivor.id);
    expect(shell?.mergedAt).not.toBeNull();
  });
});
