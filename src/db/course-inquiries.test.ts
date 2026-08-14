import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  DATE_REQUESTS_PAGE_SIZE,
  listDateRequestsForStaff,
  recordCourseInquiry,
} from "./course-inquiries";
import { getCourseBySlug } from "./courses";
import { createDiver } from "./divers";
import { courseInquiries, people, shops } from "./schema";

async function inquiryContext() {
  const { db, shop } = await seededShopContext();
  const course = await getCourseBySlug(db, shop.id, "open-water-diver");
  if (!course) throw new Error("demo Open Water Diver course missing");
  return { db, shop, course };
}

/** The newest inquiry row for one course, read straight off the table. */
async function latestInquiryForCourse(db: AppDb, shopId: string, courseId: string) {
  const [row] = await db
    .select()
    .from(courseInquiries)
    .where(and(eq(courseInquiries.shopId, shopId), eq(courseInquiries.courseId, courseId)))
    .orderBy(desc(courseInquiries.createdAt))
    .limit(1);
  return row;
}

describe("recordCourseInquiry", () => {
  it("records every optional field a diver filled in", async () => {
    const { db, shop, course } = await inquiryContext();
    const record = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      name: "  Priya Sharma  ",
      email: "  Priya@Example.com ",
      phone: " +1 305 555 0134 ",
      experienceLevel: "tried",
      timing: " The week of 12 August ",
      divers: 2,
      message: " Excited to start! ",
    });

    expect(record.id).toBeTruthy();
    const row = await latestInquiryForCourse(db, shop.id, course.id);
    expect(row).toMatchObject({
      id: record.id,
      courseId: course.id,
      name: "Priya Sharma",
      email: "priya@example.com",
      phone: "+1 305 555 0134",
      experienceLevel: "tried",
      timing: "The week of 12 August",
      divers: 2,
      message: "Excited to start!",
    });
  });

  it("records a minimal submission — every field but the required experience level left blank", async () => {
    const { db, shop, course } = await inquiryContext();
    const record = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
    });

    const row = await latestInquiryForCourse(db, shop.id, course.id);
    expect(row.id).toBe(record.id);
    expect(row.name).toBeNull();
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.timing).toBeNull();
    expect(row.divers).toBeNull();
    expect(row.message).toBeNull();
    expect(row.experienceLevel).toBe("never");
  });

  it("normalizes a whitespace-only optional field to null rather than storing blank text", async () => {
    const { db, shop, course } = await inquiryContext();
    const record = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      name: "   ",
      experienceLevel: "certified",
    });
    const row = await latestInquiryForCourse(db, shop.id, course.id);
    expect(row.id).toBe(record.id);
    expect(row.name).toBeNull();
  });

  it("rejects a course id that does not exist (FK constraint, not a silent orphan row)", async () => {
    const { db, shop } = await inquiryContext();
    await expect(
      recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: crypto.randomUUID(),
        experienceLevel: "lapsed",
      }),
    ).rejects.toThrow();
  });

  it("rejects an experience level outside the four codes the column allows", async () => {
    const { db, shop, course } = await inquiryContext();
    await expect(
      recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: course.id,
        experienceLevel: "curious" as CourseInquiryExperience,
      }),
    ).rejects.toThrow();
  });

  /**
   * The `person_id` snapshot exists for erasure: once a diver changes their
   * email, the address on this row is the sweep's only other handle and it no
   * longer matches (ADR 20260802-diver-data-erasure). Every assertion here is
   * about *not* over-linking — a wrong link erases a bystander's lead.
   */
  describe("the person link", () => {
    async function inquiryRow(db: AppDb, shopId: string, id: string) {
      const [row] = await db
        .select()
        .from(courseInquiries)
        .where(and(eq(courseInquiries.shopId, shopId), eq(courseInquiries.id, id)));
      return row;
    }

    it("links a lead to the live diver holding that exact address, case-insensitively", async () => {
      const { db, shop, course } = await inquiryContext();
      const diver = await createDiver(db, {
        shopId: shop.id,
        fullName: "Linked Lina",
        email: "lina@example.com",
      });
      if (!diver) throw new Error("diver insert failed");

      const record = await recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "  LINA@Example.com ",
        experienceLevel: "certified",
      });
      expect((await inquiryRow(db, shop.id, record.id))?.personId).toBe(diver.id);
    });

    it("leaves the link null when the address belongs to nobody here", async () => {
      const { db, shop, course } = await inquiryContext();
      const record = await recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "stranger@example.com",
        experienceLevel: "never",
      });
      expect((await inquiryRow(db, shop.id, record.id))?.personId).toBeNull();
    });

    it("leaves the link null when the writer gave no address at all", async () => {
      const { db, shop, course } = await inquiryContext();
      const record = await recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: course.id,
        phone: "+1 305 555 0134",
        experienceLevel: "tried",
      });
      // A phone number is never a link: a household number is genuinely shared,
      // and linking on one would aim a future erasure at a partner's lead.
      expect((await inquiryRow(db, shop.id, record.id))?.personId).toBeNull();
    });

    it("never links to a removed diver, even when their address still matches", async () => {
      const { db, shop, course } = await inquiryContext();
      const diver = await createDiver(db, {
        shopId: shop.id,
        fullName: "Removed Rhea",
        email: "rhea@example.com",
      });
      if (!diver) throw new Error("diver insert failed");
      await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, diver.id));

      const record = await recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "rhea@example.com",
        experienceLevel: "lapsed",
      });
      expect((await inquiryRow(db, shop.id, record.id))?.personId).toBeNull();
    });

    it("never links across shops", async () => {
      const { db, shop, course } = await inquiryContext();
      const [rival] = await db
        .insert(shops)
        .values({ name: "Rival Reef", slug: "rival-reef-inquiry-capture", timezone: "UTC" })
        .returning();
      if (!rival) throw new Error("rival shop insert failed");
      const theirDiver = await createDiver(db, {
        shopId: rival.id,
        fullName: "Rival Rae",
        email: "rae@example.com",
      });
      if (!theirDiver) throw new Error("rival diver insert failed");

      const record = await recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: course.id,
        email: "rae@example.com",
        experienceLevel: "certified",
      });
      expect((await inquiryRow(db, shop.id, record.id))?.personId).toBeNull();
    });
  });
});

/**
 * The half of the table that names no course: a diver asking for an ordinary
 * dive from the shop's schedule page. One table, one erasure path, one export
 * column set — and one rule keeping "no course" from meaning "about nothing".
 */
describe("recordCourseInquiry — a dive request, with dates", () => {
  it("records a request that names an interest instead of a course", async () => {
    const { db, shop } = await inquiryContext();
    const record = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: null,
      interest: "  A two-tank on the wrecks  ",
      email: "tomas@example.com",
      experienceLevel: "certified",
      preferredDate: "2026-09-12",
      alternateDate: "2026-09-19",
      dateFlexible: true,
    });

    const [row] = await db
      .select()
      .from(courseInquiries)
      .where(and(eq(courseInquiries.shopId, shop.id), eq(courseInquiries.id, record.id)));
    expect(row).toMatchObject({
      courseId: null,
      interest: "A two-tank on the wrecks",
      preferredDate: "2026-09-12",
      alternateDate: "2026-09-19",
      dateFlexible: true,
    });
  });

  it("defaults the dates to nothing at all rather than to today", async () => {
    const { db, shop, course } = await inquiryContext();
    const record = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
    });
    const row = await latestInquiryForCourse(db, shop.id, course.id);
    expect(row.id).toBe(record.id);
    expect(row.preferredDate).toBeNull();
    expect(row.alternateDate).toBeNull();
    expect(row.dateFlexible).toBe(false);
  });

  it("refuses a request that is about nothing — no course and no interest", async () => {
    const { db, shop } = await inquiryContext();
    await expect(
      recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: null,
        experienceLevel: "never",
        email: "nobody@example.com",
      }),
    ).rejects.toThrow();
  });

  it("refuses a whitespace-only interest, which is the same as none", async () => {
    const { db, shop } = await inquiryContext();
    await expect(
      recordCourseInquiry(db, {
        shopId: shop.id,
        courseId: null,
        interest: "   ",
        experienceLevel: "never",
      }),
    ).rejects.toThrow();
  });

  it("refuses an about-nothing row written straight at the table (the check constraint)", async () => {
    const { db, shop } = await inquiryContext();
    await expect(
      db.insert(courseInquiries).values({
        shopId: shop.id,
        courseId: null,
        interest: null,
        experienceLevel: "never",
      }),
    ).rejects.toThrow();
  });
});

describe("listDateRequestsForStaff", () => {
  /** A request written straight at the table, so a test can place its dates. */
  async function addRequest(
    db: AppDb,
    shopId: string,
    fields: {
      interest: string;
      preferredDate?: string | null;
      alternateDate?: string | null;
      dateFlexible?: boolean;
    },
  ) {
    const [row] = await db
      .insert(courseInquiries)
      .values({
        shopId,
        courseId: null,
        interest: fields.interest,
        experienceLevel: "certified",
        preferredDate: fields.preferredDate ?? null,
        alternateDate: fields.alternateDate ?? null,
        dateFlexible: fields.dateFlexible ?? false,
      })
      .returning({ id: courseInquiries.id });
    return row;
  }

  /** A shop with nothing seeded into this table, so ordering is only ours. */
  async function emptyRequestShop() {
    const { db, shop } = await inquiryContext();
    await db.delete(courseInquiries).where(eq(courseInquiries.shopId, shop.id));
    return { db, shop };
  }

  it("reads the soonest date first and leaves the dateless ones at the end", async () => {
    const { db, shop } = await emptyRequestShop();
    await addRequest(db, shop.id, { interest: "later", preferredDate: "2026-10-01" });
    await addRequest(db, shop.id, { interest: "no date" });
    await addRequest(db, shop.id, { interest: "sooner", preferredDate: "2026-09-12" });
    // Its alternate is the earliest date it can be served on, so it sorts by
    // that rather than by the later day it named first.
    await addRequest(db, shop.id, {
      interest: "early alternate",
      preferredDate: "2026-10-05",
      alternateDate: "2026-09-05",
    });

    const page = await listDateRequestsForStaff(db, shop.id);
    expect(page.rows.map((row) => row.interest)).toEqual([
      "early alternate",
      "sooner",
      "later",
      "no date",
    ]);
    expect(page.total).toBe(4);
    expect(page.page).toBe(1);
  });

  it("carries the course title for a request that names one, and null for one that doesn't", async () => {
    const { db, shop } = await emptyRequestShop();
    const course = await getCourseBySlug(db, shop.id, "open-water-diver");
    if (!course) throw new Error("demo Open Water Diver course missing");
    await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
      preferredDate: "2026-09-12",
    });
    await addRequest(db, shop.id, { interest: "a night dive", preferredDate: "2026-09-13" });

    const page = await listDateRequestsForStaff(db, shop.id);
    expect(page.rows.map((row) => [row.courseTitle, row.interest])).toEqual([
      [course.title, null],
      [null, "a night dive"],
    ]);
  });

  it("never reads another shop's requests", async () => {
    const { db, shop } = await emptyRequestShop();
    const [rival] = await db
      .insert(shops)
      .values({ name: "Rival Reef", slug: "rival-reef-date-requests", timezone: "UTC" })
      .returning();
    if (!rival) throw new Error("rival shop insert failed");
    await addRequest(db, rival.id, { interest: "theirs", preferredDate: "2026-09-12" });
    await addRequest(db, shop.id, { interest: "ours", preferredDate: "2026-09-12" });

    const page = await listDateRequestsForStaff(db, shop.id);
    expect(page.rows.map((row) => row.interest)).toEqual(["ours"]);
    expect(page.total).toBe(1);
  });

  it("pages, and its count is the whole shop rather than the page", async () => {
    const { db, shop } = await emptyRequestShop();
    for (let i = 0; i < DATE_REQUESTS_PAGE_SIZE + 3; i += 1) {
      await addRequest(db, shop.id, {
        interest: `request ${i}`,
        preferredDate: `2026-09-${String(i + 1).padStart(2, "0")}`,
      });
    }

    const first = await listDateRequestsForStaff(db, shop.id);
    expect(first.rows).toHaveLength(DATE_REQUESTS_PAGE_SIZE);
    expect(first.total).toBe(DATE_REQUESTS_PAGE_SIZE + 3);
    expect(first.pageCount).toBe(2);

    const second = await listDateRequestsForStaff(db, shop.id, { page: 2 });
    expect(second.rows).toHaveLength(3);
    // A bookmarked page past the end lands on the last real one, never on an
    // empty table under a heading that cannot be true.
    const past = await listDateRequestsForStaff(db, shop.id, { page: 9 });
    expect(past.page).toBe(2);
    expect(past.rows).toHaveLength(3);
  });
});
