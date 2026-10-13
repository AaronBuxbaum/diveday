import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { createCourseForm, listCourseForms } from "./course-forms";
import { courseForms } from "./schema";
import { listStaff } from "./trips";

const fileCtx = fileScopedShopContext();

/**
 * **The course-forms list reads in one order** (issue #2512). The seed stamps
 * every form with the same instant and a form's id is random, so a list that
 * broke ties on the id alone reordered on every reseed: the staff waivers
 * captures moved between two CI runs of the same code.
 */
describe("listCourseForms order (in-memory PGlite)", () => {
  it("breaks a tie on the creation time by title, then by id", async () => {
    const { db, shop } = fileCtx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const make = (title: string) =>
      createCourseForm(db, { shopId: shop.id, title, body: "", actorPersonId: staff.person.id });
    // Created out of order, and two sharing one title.
    const ids = [
      (await make("Tie order E")).id,
      (await make("Tie order C")).id,
      (await make("Tie order D")).id,
      (await make("Tie order A")).id,
      (await make("Tie order B")).id,
      (await make("Tie order B")).id,
    ];
    // Older than anything the seed made, and all the same instant.
    await db
      .update(courseForms)
      .set({ createdAt: new Date("2001-02-03T04:05:06Z") })
      .where(inArray(courseForms.id, ids));

    const listed = (await listCourseForms(db, shop.id)).slice(0, ids.length);
    const sameTitle = ids.slice(4).sort();
    expect(listed.map((form) => form.title)).toEqual([
      "Tie order A",
      "Tie order B",
      "Tie order B",
      "Tie order C",
      "Tie order D",
      "Tie order E",
    ]);
    expect(listed.slice(1, 3).map((form) => form.id)).toEqual(sameTitle);
  });

  it("still lists the older form first when the times differ", async () => {
    const { db, shop } = fileCtx;
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const later = await createCourseForm(db, {
      shopId: shop.id,
      title: "AAA first by title, last by time",
      body: "",
      actorPersonId: staff.person.id,
    });
    await db
      .update(courseForms)
      .set({ createdAt: new Date("2099-01-01T00:00:00Z") })
      .where(eq(courseForms.id, later.id));
    const listed = await listCourseForms(db, shop.id);
    expect(listed.at(-1)?.id).toBe(later.id);
  });
});
