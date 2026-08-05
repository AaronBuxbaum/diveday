import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import type { AppDb, DbExecutor } from "./client";
import { courseInquiries, people } from "./schema";

/**
 * The lead recorded from the public course page's "get in touch" composer
 * (docs/product/archive/ux-personas-20260730-findings.md task 7). `courseId` and
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
  /** A bare `YYYY-MM-DD` the diver asked for, or null when they named none. */
  preferredDate?: string | null;
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

/**
 * The shop's live diver holding exactly this address, or null.
 *
 * Exact and case-insensitive, never fuzzy, and never on the phone number: a
 * household number is genuinely shared, and a link written from one would point
 * a future erasure at a partner's or a child's lead. `people_shop_email_unique`
 * is a partial unique index on `lower(email)` over this shop's live rows, so
 * there is at most one candidate and the resolution is deterministic — no
 * "first match wins" ordering to reason about.
 *
 * Deleted and erased records are excluded on purpose. An erased person's email
 * is null, so they can never match anyway; a soft-deleted duplicate is outside
 * the unique index, which is exactly where a second row holding the same
 * address could hide, and linking to the removed one would send a later erasure
 * at the wrong record.
 */
async function livePersonIdForEmail(
  db: DbExecutor,
  shopId: string,
  email: string,
): Promise<string | null> {
  const [match] = await db
    .select({ id: people.id })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        sql`lower(${people.email}) = ${email}`,
      ),
    )
    .limit(1);
  return match?.id ?? null;
}

/**
 * Records one inquiry. Insert-only — there is no edit or withdraw path (a diver
 * just asks again).
 *
 * When the writer left an email that a live diver of this shop already holds,
 * the resulting `person_id` link is snapshotted onto the row. That is not a
 * convenience: it is the only handle diver erasure will have once the diver
 * changes their address (`anonymizeDiver`, src/db/anonymize.ts, and
 * ADR 20260802-diver-data-erasure). A lead with no email, or with an address
 * nobody here holds, is stored unlinked — the honest answer, and the reason the
 * column is nullable.
 */
export async function recordCourseInquiry(
  db: AppDb,
  input: RecordCourseInquiryInput,
): Promise<CourseInquiryRecord> {
  const email = normalizeOptional(input.email)?.toLowerCase() ?? null;
  const personId = email ? await livePersonIdForEmail(db, input.shopId, email) : null;
  const [inserted] = await db
    .insert(courseInquiries)
    .values({
      shopId: input.shopId,
      courseId: input.courseId,
      personId,
      name: normalizeOptional(input.name),
      email,
      phone: normalizeOptional(input.phone),
      experienceLevel: input.experienceLevel,
      timing: normalizeOptional(input.timing),
      preferredDate: normalizeOptional(input.preferredDate),
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
  preferredDate: string | null;
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
      preferredDate: courseInquiries.preferredDate,
      divers: courseInquiries.divers,
      message: courseInquiries.message,
      createdAt: courseInquiries.createdAt,
    })
    .from(courseInquiries)
    .where(scope)
    .orderBy(desc(courseInquiries.createdAt))
    .limit(limit);
}
