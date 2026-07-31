import { and, desc, eq } from "drizzle-orm";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import type { AppDb, DbExecutor } from "./client";
import { courseInquiries } from "./schema";

/**
 * The lead recorded from the public course page's "get in touch" composer
 * (docs/product/assessments/ux-personas-20260730.md task 7). `courseId` and
 * `shopId` are always derived server-side from the URL's shop/course slugs —
 * never accepted from the caller — the same discipline `submitTripReview`
 * uses for `bookingId`.
 */
export type RecordCourseInquiryInput = {
  shopId: string;
  courseId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  experienceLevel: CourseInquiryExperience;
  timing?: string | null;
  divers?: number | null;
  message?: string | null;
};

export type CourseInquiryRecord = {
  id: string;
  createdAt: Date;
};

/** Normalizes an optional free-text field to trimmed text or null — never an empty string. */
function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Records one inquiry. Insert-only — there is no edit or withdraw path (a diver just asks again). */
export async function recordCourseInquiry(
  db: AppDb,
  input: RecordCourseInquiryInput,
): Promise<CourseInquiryRecord> {
  const [inserted] = await db
    .insert(courseInquiries)
    .values({
      shopId: input.shopId,
      courseId: input.courseId,
      name: normalizeOptional(input.name),
      email: normalizeOptional(input.email)?.toLowerCase() ?? null,
      phone: normalizeOptional(input.phone),
      experienceLevel: input.experienceLevel,
      timing: normalizeOptional(input.timing),
      divers: input.divers ?? null,
      message: normalizeOptional(input.message),
    })
    .returning({ id: courseInquiries.id, createdAt: courseInquiries.createdAt });
  if (!inserted) throw new Error("recordCourseInquiry: insert returned no row");
  return inserted;
}

export type CourseInquiryListRow = {
  id: string;
  courseId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  experienceLevel: CourseInquiryExperience;
  timing: string | null;
  divers: number | null;
  message: string | null;
  createdAt: Date;
};

/**
 * This shop's inquiries, newest first. Not surfaced in any UI yet — the email
 * notification is the delivery path task 7 asks for — but kept shop-scoped
 * and queryable from the start the way every other lead-capture table
 * (`lastMinuteListEntries`, `tripWaitlistEntries`) is, for a moderation view
 * to read from later without a second migration.
 */
export async function listCourseInquiriesForShop(
  db: DbExecutor,
  shopId: string,
  options: { courseId?: string; limit?: number } = {},
): Promise<CourseInquiryListRow[]> {
  const limit = options.limit ?? 50;
  const scope = options.courseId
    ? and(eq(courseInquiries.shopId, shopId), eq(courseInquiries.courseId, options.courseId))
    : eq(courseInquiries.shopId, shopId);
  return db
    .select({
      id: courseInquiries.id,
      courseId: courseInquiries.courseId,
      name: courseInquiries.name,
      email: courseInquiries.email,
      phone: courseInquiries.phone,
      experienceLevel: courseInquiries.experienceLevel,
      timing: courseInquiries.timing,
      divers: courseInquiries.divers,
      message: courseInquiries.message,
      createdAt: courseInquiries.createdAt,
    })
    .from(courseInquiries)
    .where(scope)
    .orderBy(desc(courseInquiries.createdAt))
    .limit(limit);
}
