import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  type CoursePathWithSteps,
  createCoursePath,
  deleteCoursePath,
  getCoursePathBySlug,
  listCoursePaths,
  listPathsContainingCourse,
  nextPathStep,
  setCoursePathVisibility,
  uniquePathSlug,
  updateCoursePath,
} from "./course-paths";
import { createCourse, setCourseVisibility } from "./courses";
import { coursePathSteps, courses, shops } from "./schema";

/** A second tenant in the same database, for the cross-shop isolation tests. */
async function secondShop(db: AppDb, slug: string) {
  const [row] = await db
    .insert(shops)
    .values({ name: "Other Shop", slug, timezone: "UTC" })
    .returning();
  if (!row) throw new Error("second shop insert failed");
  return row;
}

async function pathContext() {
  const { db, shop } = await seededShopContext();
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  const idOf = (title: string) => {
    const course = catalog.find((row) => row.title === title);
    if (!course) throw new Error(`seed: ${title} missing`);
    return course.id;
  };
  return { db, shop, catalog, idOf };
}

/** A path shaped like the builder posts it, for the pure `nextPathStep` tests. */
function fakePath(
  steps: Array<{ title: string; gate: string | null; active?: boolean }>,
): CoursePathWithSteps {
  return {
    id: "path",
    shopId: "shop",
    title: "Ladder",
    slug: "ladder",
    summary: null,
    isActive: true,
    createdAt: new Date(0),
    steps: steps.map((step, index) => ({
      id: `step-${index}`,
      position: index,
      note: null,
      course: {
        id: `course-${index}`,
        title: step.title,
        slug: step.title.toLowerCase().replace(/\W+/g, "-"),
        agency: "padi",
        isActive: step.active ?? true,
        minimumCertificationLevel: step.gate as never,
        summary: null,
        priceCents: null,
      },
    })),
  };
}

describe("course paths (in-memory PGlite)", () => {
  it("seeds the demo shop with paths whose rungs are dense and ordered", async () => {
    const { db, shop } = await pathContext();
    const paths = await listCoursePaths(db, shop.id);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const path of paths) {
      expect(path.steps.map((step) => step.position)).toEqual(path.steps.map((_, index) => index));
    }
    const ladder = paths.find((path) => path.title.startsWith("From first breath"));
    expect(ladder?.steps.map((step) => step.course.title)).toEqual([
      "Discover Scuba Diving",
      "Open Water Diver",
      "Advanced Open Water Diver",
      "Rescue Diver",
    ]);
  });

  it("rewrites the whole rung list on save, so reordering never collides on position", async () => {
    const { db, shop, idOf } = await pathContext();
    const path = await createCoursePath(db, {
      shopId: shop.id,
      title: "Reorder me",
      steps: [{ courseId: idOf("Open Water Diver") }, { courseId: idOf("Rescue Diver") }],
    });
    if (!path) throw new Error("path not created");

    const reversed = await updateCoursePath(db, shop.id, path.id, {
      title: "Reorder me",
      steps: [
        { courseId: idOf("Rescue Diver"), note: "  now first  " },
        { courseId: idOf("Open Water Diver") },
      ],
    });
    expect(reversed).toBe(true);

    const saved = await getCoursePathBySlug(db, shop.id, path.slug);
    expect(saved?.steps.map((step) => step.course.title)).toEqual([
      "Rescue Diver",
      "Open Water Diver",
    ]);
    expect(saved?.steps[0].note).toBe("now first");
    expect(saved?.steps[1].note).toBeNull();
  });

  it("collapses a duplicated course rather than violating the path/course unique index", async () => {
    const { db, shop, idOf } = await pathContext();
    const path = await createCoursePath(db, {
      shopId: shop.id,
      title: "Duplicated",
      steps: [
        { courseId: idOf("Open Water Diver") },
        { courseId: idOf("Open Water Diver") },
        { courseId: idOf("Rescue Diver") },
      ],
    });
    if (!path) throw new Error("path not created");
    const saved = await getCoursePathBySlug(db, shop.id, path.slug);
    expect(saved?.steps.map((step) => step.course.title)).toEqual([
      "Open Water Diver",
      "Rescue Diver",
    ]);
  });

  it("drops a step pointing at another shop's course instead of writing it", async () => {
    const { db, shop, idOf } = await pathContext();
    // A second shop's catalog row: the picker can only ever offer this shop's
    // courses, so reaching here means a forged or stale form post.
    const other = await secondShop(db, "other-shop-path-course");
    const foreign = await createCourse(db, {
      shopId: other.id,
      title: "Someone else's course",
    });
    if (!foreign) throw new Error("foreign course not created");

    const path = await createCoursePath(db, {
      shopId: shop.id,
      title: "Cross-tenant attempt",
      steps: [{ courseId: foreign.id }, { courseId: idOf("Rescue Diver") }],
    });
    if (!path) throw new Error("path not created");
    const saved = await getCoursePathBySlug(db, shop.id, path.slug);
    expect(saved?.steps.map((step) => step.course.title)).toEqual(["Rescue Diver"]);
  });

  it("refuses a second path with the same title in one shop", async () => {
    const { db, shop } = await pathContext();
    await createCoursePath(db, { shopId: shop.id, title: "Only once" });
    await expect(createCoursePath(db, { shopId: shop.id, title: "Only once" })).rejects.toThrow();
  });

  it("mints a non-colliding slug when two paths would share one", async () => {
    const { db, shop } = await pathContext();
    const first = await uniquePathSlug(db, shop.id, "Deep and dark");
    await createCoursePath(db, { shopId: shop.id, title: "Deep and dark", slug: first });
    const second = await uniquePathSlug(db, shop.id, "Deep and dark!");
    expect(second).not.toBe(first);
    await createCoursePath(db, { shopId: shop.id, title: "Deep and dark!", slug: second });
    const paths = await listCoursePaths(db, shop.id);
    const slugs = paths.map((path) => path.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("cascades a path's steps away when the path is deleted", async () => {
    const { db, shop, idOf } = await pathContext();
    const path = await createCoursePath(db, {
      shopId: shop.id,
      title: "Short lived",
      steps: [{ courseId: idOf("Rescue Diver") }],
    });
    if (!path) throw new Error("path not created");
    expect(await deleteCoursePath(db, shop.id, path.id)).toBe(true);
    const orphans = await db
      .select()
      .from(coursePathSteps)
      .where(eq(coursePathSteps.pathId, path.id));
    expect(orphans).toEqual([]);
  });

  it("refuses to delete or retitle another shop's path", async () => {
    const { db, shop } = await pathContext();
    const other = await secondShop(db, "other-shop-path-owner");
    const path = await createCoursePath(db, { shopId: shop.id, title: "Mine" });
    if (!path) throw new Error("path not created");
    expect(await deleteCoursePath(db, other.id, path.id)).toBe(false);
    expect(await updateCoursePath(db, other.id, path.id, { title: "Yours", steps: [] })).toBe(
      false,
    );
    expect((await getCoursePathBySlug(db, shop.id, path.slug))?.title).toBe("Mine");
  });

  it("keeps hidden paths out of the active-only list", async () => {
    const { db, shop } = await pathContext();
    const path = await createCoursePath(db, { shopId: shop.id, title: "Off season" });
    if (!path) throw new Error("path not created");
    await setCoursePathVisibility(db, shop.id, path.id, false);
    const active = await listCoursePaths(db, shop.id, { activeOnly: true });
    expect(active.some((row) => row.id === path.id)).toBe(false);
    const all = await listCoursePaths(db, shop.id);
    expect(all.some((row) => row.id === path.id)).toBe(true);
  });

  it("lists the active paths a course appears on", async () => {
    const { db, shop, idOf } = await pathContext();
    const rescueId = idOf("Rescue Diver");
    const containing = await listPathsContainingCourse(db, shop.id, rescueId);
    expect(containing.map((path) => path.title)).toContain("From first breath to Rescue Diver");
  });

  it("keeps a path's rung visible to staff after the course is hidden", async () => {
    const { db, shop, idOf } = await pathContext();
    const path = await createCoursePath(db, {
      shopId: shop.id,
      title: "Has a hidden rung",
      steps: [{ courseId: idOf("Night Diver") }],
    });
    if (!path) throw new Error("path not created");
    await setCourseVisibility(db, shop.id, idOf("Night Diver"), false);
    const saved = await getCoursePathBySlug(db, shop.id, path.slug);
    expect(saved?.steps).toHaveLength(1);
    expect(saved?.steps[0].course.isActive).toBe(false);
  });

  it("removes a path's rung when the course itself is deleted", async () => {
    const { db, shop, idOf } = await pathContext();
    // A course with no scheduled session behind it, so the delete is a clean
    // catalog removal rather than a foreign-key fight with the trip board.
    const disposable = await createCourse(db, { shopId: shop.id, title: "Briefly offered" });
    if (!disposable) throw new Error("course not created");
    const path = await createCoursePath(db, {
      shopId: shop.id,
      title: "Loses a rung",
      steps: [{ courseId: disposable.id }, { courseId: idOf("Rescue Diver") }],
    });
    if (!path) throw new Error("path not created");
    await db.delete(courses).where(and(eq(courses.id, disposable.id), eq(courses.shopId, shop.id)));
    const saved = await getCoursePathBySlug(db, shop.id, path.slug);
    expect(saved?.steps.map((step) => step.course.title)).toEqual(["Rescue Diver"]);
  });
});

describe("nextPathStep", () => {
  const ladder = fakePath([
    { title: "Open Water", gate: null },
    { title: "Advanced", gate: "open_water" },
    { title: "Rescue", gate: "advanced_open_water" },
  ]);

  it("sends an uncertified diver to the entry-level rung", () => {
    expect(nextPathStep([ladder], null)?.step.course.title).toBe("Open Water");
  });

  it("sends an Open Water diver to the rung their card unlocks", () => {
    expect(nextPathStep([ladder], "open_water")?.step.course.title).toBe("Advanced");
  });

  it("sends an Advanced diver past the rung they already cleared", () => {
    expect(nextPathStep([ladder], "advanced_open_water")?.step.course.title).toBe("Rescue");
  });

  it("suggests nothing to a diver who has outgrown every rung", () => {
    expect(nextPathStep([ladder], "instructor")).toBeNull();
  });

  it("suggests nothing when no path reaches an uncertified diver", () => {
    const continuingEducation = fakePath([{ title: "Advanced", gate: "open_water" }]);
    expect(nextPathStep([continuingEducation], null)).toBeNull();
  });

  it("skips a rung whose course the shop has hidden", () => {
    const withHidden = fakePath([
      { title: "Open Water", gate: null },
      { title: "Advanced", gate: "open_water", active: false },
    ]);
    expect(nextPathStep([withHidden], "open_water")).toBeNull();
  });

  it("says nothing rather than re-suggesting a rung the diver's card already cleared", () => {
    // Open Water, then a Rescue course this shop admits at Open Water. An
    // Advanced diver stands above every bar on this path. DiveDay cannot tell
    // whether they took Rescue last season, so it stays quiet instead of
    // selling them a course they may already hold.
    const shortcut = fakePath([
      { title: "Open Water", gate: null },
      { title: "Rescue", gate: "open_water" },
    ]);
    expect(nextPathStep([shortcut], "advanced_open_water")).toBeNull();
  });

  it("never offers an entry-level course to a diver who is already certified", () => {
    const withDsd = fakePath([
      { title: "Discover Scuba", gate: null },
      { title: "Advanced", gate: "open_water" },
    ]);
    expect(nextPathStep([withDsd], "open_water")?.step.course.title).toBe("Advanced");
  });

  it("prefers the first path the shop ordered when two offer the same depth", () => {
    const first = {
      ...fakePath([{ title: "Wreck", gate: "advanced_open_water" }]),
      title: "Wreck",
    };
    const second = { ...fakePath([{ title: "Deep", gate: "advanced_open_water" }]), title: "Deep" };
    expect(nextPathStep([first, second], "advanced_open_water")?.path.title).toBe("Wreck");
  });
});
