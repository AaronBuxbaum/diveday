import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "@/content/course-templates";
import { nowDate } from "@/lib/clock";
import { courseSlug } from "@/lib/courses";
import { CORE_RENTAL_KINDS } from "@/lib/rentals";
import { seededShopContext } from "@/test/db";
import { courseForms, courseFormVersions, courses } from "./schema";
import { courseTemplateDisplayTitle } from "./seed-catalog";
import { SEED_COURSE_ILLUSTRATIONS } from "./seed-course-illustrations";

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

describe("seeded Open Water water skills", () => {
  it("publishes the swim time limit and float duration in every demo course field", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await db.select().from(courses).where(eq(courses.shopId, shop.id));
    const openWater = rows.find((row) => row.sourceTemplateSlug === "open-water-diver");
    expect(openWater).toBeDefined();
    for (const copy of [
      openWater?.overview,
      openWater?.scheduleDays[0].items.find((item) => /swim/i.test(item)),
      openWater?.faqs.find((faq) => /swimmer/.test(faq.question))?.answer,
    ]) {
      expect(copy).toMatch(/swim[^.!]*no time limit/i);
      expect(copy).toMatch(/10-minute float/);
      expect(copy).not.toMatch(/neither.*timed|swim and float assessment \(not timed\)/i);
    }
    expect(openWater?.sourceTemplateVersion).toBeGreaterThan(4);
  }, 60_000);
});

describe("seeded gear-included courses", () => {
  it("includes the complete core set whenever the course promises complete rental gear", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await db.select().from(courses).where(eq(courses.shopId, shop.id));
    const completeGear = rows.filter((row) =>
      row.includes.some((item) => /complete rental gear/i.test(item)),
    );
    expect(completeGear.map((row) => row.slug).sort()).toEqual([
      "discover-scuba-diving",
      "open-water-diver",
      "scuba-refresher",
    ]);
    for (const course of completeGear) {
      expect(course.includedRentalKinds, course.slug).toEqual([...CORE_RENTAL_KINDS]);
      expect(course.includedPersonalGear, course.slug).toEqual(["snorkel", "boots"]);
    }
    expect(
      rows.filter((row) => !completeGear.includes(row) && row.includedRentalKinds.length),
    ).toEqual([]);
  }, 60_000);
});

describe("demo course illustrations", () => {
  it.each([false, true])(
    "assigns one distinct illustration to every course (history: %s)",
    async (history) => {
      const { db, shop } = await seededShopContext({ history });
      const rows = await db.select().from(courses).where(eq(courses.shopId, shop.id));
      expect(rows).toHaveLength(COURSE_TEMPLATES.length + 1);
      const urls = rows.map((row) => row.heroImageUrl);
      expect(new Set(urls).size).toBe(rows.length);
      for (const row of rows) {
        const key =
          row.sourceTemplateSlug ??
          (row.agency === "ssi" && row.title === "Nitrox 40" ? "ssi-nitrox-40" : "");
        expect(SEED_COURSE_ILLUSTRATIONS[key], row.title).toEqual({
          url: row.heroImageUrl,
          alt: row.heroImageAlt,
        });
      }
    },
    60_000,
  );

  it("covers each template and the additional SSI course with distinct valid assets", async () => {
    expect(Object.keys(SEED_COURSE_ILLUSTRATIONS).sort()).toEqual(
      [...COURSE_TEMPLATES.map((template) => template.slug), "ssi-nitrox-40"].sort(),
    );
    const digests = new Set<string>();
    for (const { url, alt } of Object.values(SEED_COURSE_ILLUSTRATIONS)) {
      expect(url).toMatch(/^\/course-illustrations\/[a-z0-9-]+\.webp$/);
      expect(alt).toMatch(/^Illustration: .+\.$/);
      const bytes = await readFile(join(process.cwd(), "public", url));
      expect(bytes.length).toBeLessThan(500_000);
      const metadata = await sharp(bytes).metadata();
      expect(metadata).toMatchObject({ format: "webp", width: 1536, height: 1024 });
      digests.add(createHash("sha256").update(bytes).digest("hex"));
    }
    expect(digests.size).toBe(COURSE_TEMPLATES.length + 1);
  });
});
