import { describe, expect, it } from "vitest";
import { loadShopExportBundleInput } from "@/db/export";
import { table } from "@/db/export-bundle-table.test-support";
import { fileScopedShopContext } from "@/test/db";
import { editCourse, getCourseBySlug } from "./store";

const ctx = fileScopedShopContext();
describe("course personal kit persistence", () => {
  it("persists bounded personal-kit inclusions only within the shop and preserves omitted edits", async () => {
    const { db, shop } = ctx;
    const course = await getCourseBySlug(db, shop.id, "open-water-diver");
    if (!course) throw new Error("seeded course missing");
    expect(course.includedPersonalGear).toEqual(["snorkel", "boots"]);
    const saved = await editCourse(db, shop.id, course.id, { includedPersonalGear: ["boots"] });
    expect(saved?.includedPersonalGear).toEqual(["boots"]);
    expect((await editCourse(db, shop.id, course.id, {}))?.includedPersonalGear).toEqual(["boots"]);
    expect(
      await editCourse(db, "00000000-0000-4000-8000-000000000000", course.id, {
        includedPersonalGear: [],
      }),
    ).toBeNull();
    expect((await getCourseBySlug(db, shop.id, "open-water-diver"))?.includedPersonalGear).toEqual([
      "boots",
    ]);
    expect(
      (await editCourse(db, shop.id, course.id, { includedPersonalGear: [] }))
        ?.includedPersonalGear,
    ).toEqual([]);
  });

  it("exports the course's explicit personal kit beside its rental inclusions", async () => {
    const { db, shop } = ctx;
    const input = await loadShopExportBundleInput(db, shop.id);
    if (!input) throw new Error("seeded shop failed to load");
    const exported = table(input, "courses.csv");
    const row = exported.rows.find(
      (r) => r[exported.header.indexOf("slug")] === "open-water-diver",
    );
    expect(row?.[exported.header.indexOf("included_personal_gear")]).toBe('["snorkel","boots"]');
  });
});
