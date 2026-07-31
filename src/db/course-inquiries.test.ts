// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import { seededShopContext } from "@/test/db";
import { listCourseInquiriesForShop, recordCourseInquiry } from "./course-inquiries";
import { getCourseBySlug } from "./courses";

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
