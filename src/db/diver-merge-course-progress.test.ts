import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { mergeDiverRecords } from "./diver-merge";
import { courseSessionProgress, courses, people, personRoles } from "./schema";

const ctx = fileScopedShopContext();

describe("merging course session progress", () => {
  it("keeps one tick where both records ticked the same step", async () => {
    const { db, shop } = ctx;
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
      .limit(1);
    const [course] = await db.select({ id: courses.id }).from(courses).limit(1);
    if (!owner || !course) throw new Error("merge fixture needs the seeded owner and a course");
    const [source, survivor] = await db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
        { shopId: shop.id, fullName: "Maya Rivera", email: "maya@example.com" },
      ])
      .returning();
    if (!source || !survivor) throw new Error("fixture people insert failed");
    await db.insert(personRoles).values([
      { personId: source.id, role: "diver" },
      { personId: survivor.id, role: "diver" },
    ]);
    const tick = (personId: string, stepTitle: string) => ({
      shopId: shop.id,
      personId,
      courseId: course.id,
      stepTitle,
      doneByPersonId: owner.id,
    });
    await db
      .insert(courseSessionProgress)
      .values([
        tick(source.id, "Pool session 1"),
        tick(source.id, "OW dive 2"),
        tick(survivor.id, "Pool session 1"),
      ]);

    const result = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    expect(result.ok).toBe(true);
    const kept = await db
      .select({ step: courseSessionProgress.stepTitle })
      .from(courseSessionProgress)
      .where(eq(courseSessionProgress.personId, survivor.id));
    expect(kept.map((row) => row.step).sort()).toEqual(["OW dive 2", "Pool session 1"]);
  });
});
