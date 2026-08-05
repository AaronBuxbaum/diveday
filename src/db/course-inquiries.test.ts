import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { listCourseInquiriesForShop, recordCourseInquiry } from "./course-inquiries";
import { getCourseBySlug } from "./courses";
import { createDiver } from "./divers";
import { courseInquiries, people, shops } from "./schema";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";

async function inquiryContext() {
  const { db, shop } = await seededShopContext();
  const course = await getCourseBySlug(db, shop.id, "open-water-diver");
  if (!course) throw new Error("demo Open Water Diver course missing");
  return { db, shop, course };
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
      preferredDate: "2026-08-12",
      divers: 2,
      message: " Excited to start! ",
    });

    expect(record.id).toBeTruthy();
    const [row] = await listCourseInquiriesForShop(db, shop.id, { courseId: course.id });
    expect(row).toMatchObject({
      id: record.id,
      courseId: course.id,
      name: "Priya Sharma",
      email: "priya@example.com",
      phone: "+1 305 555 0134",
      experienceLevel: "tried",
      timing: "The week of 12 August",
      preferredDate: "2026-08-12",
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

    const [row] = await listCourseInquiriesForShop(db, shop.id, { courseId: course.id });
    expect(row.id).toBe(record.id);
    expect(row.name).toBeNull();
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
    expect(row.timing).toBeNull();
    expect(row.preferredDate).toBeNull();
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
    const [row] = await listCourseInquiriesForShop(db, shop.id, { courseId: course.id });
    expect(row.id).toBe(record.id);
    expect(row.name).toBeNull();
  });

  // A requested date is a lead, never a hold: nothing here reserves a seat,
  // and the column stores the bare calendar day the diver picked so the shop
  // reads the day they meant rather than one shifted by a timezone.
  it("stores a requested date as the bare calendar day, with no instant attached", async () => {
    const { db, shop, course } = await inquiryContext();
    await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
      preferredDate: "2026-08-12",
    });
    const [row] = await listCourseInquiriesForShop(db, shop.id, { courseId: course.id });
    expect(row.preferredDate).toBe("2026-08-12");
  });

  it("accepts a date already gone — the shop answers a typo, the database does not refuse it", async () => {
    const { db, shop, course } = await inquiryContext();
    await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
      preferredDate: "2020-01-01",
    });
    const [row] = await listCourseInquiriesForShop(db, shop.id, { courseId: course.id });
    expect(row.preferredDate).toBe("2020-01-01");
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

describe("listCourseInquiriesForShop", () => {
  it("is shop-scoped — another shop's inquiries never leak into the list", async () => {
    const { db, shop, course } = await inquiryContext();
    await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
    });
    const otherShopRows = await listCourseInquiriesForShop(db, OTHER_SHOP_ID);
    expect(otherShopRows).toEqual([]);
  });

  it("orders newest first and can scope to one course", async () => {
    const { db, shop, course } = await inquiryContext();
    const dsd = await getCourseBySlug(db, shop.id, "discover-scuba-diving");
    if (!dsd) throw new Error("demo Discover Scuba Diving course missing");

    const first = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "never",
      name: "First Asker",
    });
    const second = await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: course.id,
      experienceLevel: "tried",
      name: "Second Asker",
    });
    await recordCourseInquiry(db, {
      shopId: shop.id,
      courseId: dsd.id,
      experienceLevel: "never",
      name: "DSD Asker",
    });

    const owRows = await listCourseInquiriesForShop(db, shop.id, { courseId: course.id });
    // Newest first, scoped to this course only — the DSD inquiry never appears.
    expect(owRows.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(owRows.every((row) => row.courseId === course.id)).toBe(true);
  });
});
