import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "@/content/course-templates";
import { nowDate } from "@/lib/clock";
import { courseSlug } from "@/lib/courses";
import { seededShopContext } from "@/test/db";
import { courseForms, courseFormVersions } from "./schema";
import { courseTemplateDisplayTitle } from "./seed-catalog";

/**
 * **A course's slug is its public URL, and the column it lives in is unique per
 * shop** (`courses_shop_slug_unique`). The seed publishes every template into
 * one catalog, so any two templates whose display titles normalise to the same
 * slug are a constraint violation at seed time — the demo shop simply fails to
 * build, and so does every e2e worker's database.
 *
 * Nothing caught that before SDI arrived, because until then only one pair of
 * templates shared a title at all. Nine do now.
 */
describe("course template display titles", () => {
  it("mint a distinct slug for every template", () => {
    const bySlug = new Map<string, string[]>();
    for (const template of COURSE_TEMPLATES) {
      const slug = courseSlug(courseTemplateDisplayTitle(template));
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), template.slug]);
    }
    const collisions = [...bySlug.entries()].filter(([, templates]) => templates.length > 1);
    expect(collisions).toEqual([]);
  });

  it("leaves the first claimant's title bare and qualifies the rest", () => {
    // PADI is first in the list, so it keeps the unqualified names it shipped
    // with; SSI's Open Water Diver has worn its agency since long before SDI,
    // and this is the case that used to be a hard-coded exception.
    const titleOf = (slug: string) => {
      const template = COURSE_TEMPLATES.find((entry) => entry.slug === slug);
      if (!template) throw new Error(`no template ${slug}`);
      return courseTemplateDisplayTitle(template);
    };
    expect(titleOf("open-water-diver")).toBe("Open Water Diver");
    expect(titleOf("ssi-open-water-diver")).toBe("SSI Open Water Diver");
    // Nine SDI titles collide with a PADI one; Rescue Diver is the first.
    expect(titleOf("rescue-diver")).toBe("Rescue Diver");
    expect(titleOf("sdi-rescue-diver")).toBe("SDI Rescue Diver");
    // And one that collides with nothing keeps its own name, agency or not.
    expect(titleOf("sdi-solo-diver")).toBe("Solo Diver");
  });

  it("keeps the two Search and Recovery courses apart", () => {
    // Raised in review on PR #1024 as a suspected collision: PADI's "Search and
    // Recovery Diver" against SDI's "Search & Recovery Diver". It is not one —
    // `courseSlug` collapses " & " to a single hyphen, so the ampersand drops
    // out rather than becoming "and" — but the pair is close enough to the edge
    // that it is worth a test saying so out loud.
    expect(courseSlug("Search and Recovery Diver")).toBe("search-and-recovery-diver");
    expect(courseSlug("Search & Recovery Diver")).toBe("search-recovery-diver");
  });
});

/**
 * **The course forms' dates come off the frozen clock** (issue #2297). The
 * waivers page prints each form's "version N · {date}" from its version row's
 * `created_at`, a `defaultNow()` column that Postgres stamps from the wall
 * clock, which `DIVEDAY_CLOCK` does not reach. So three visual captures of
 * that page changed every midnight; the seed pins the stamp instead.
 */
describe("seeded course forms", () => {
  it("are stamped with the app's clock, not the database's", async () => {
    const { db, shop } = await seededShopContext();
    const forms = await db
      .select({ created: courseForms.createdAt })
      .from(courseForms)
      .where(eq(courseForms.shopId, shop.id));
    const versions = await db
      .select({ created: courseFormVersions.createdAt })
      .from(courseFormVersions)
      .where(eq(courseFormVersions.shopId, shop.id));

    expect(versions.length).toBeGreaterThan(0);
    const now = nowDate().getTime();
    expect([...forms, ...versions].filter((row) => row.created.getTime() !== now)).toEqual([]);
  }, 60_000);
});
