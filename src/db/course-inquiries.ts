import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { CalendarDate } from "@/lib/calendar-date";
import type { CourseInquiryExperience } from "@/lib/course-inquiry";
import type { AppDb, DbExecutor } from "./client";
import { type OffsetPage, offsetPage, PAGE_SIZE } from "./paging";
import { courseInquiries, courses, people } from "./schema";

/**
 * The lead recorded from a diver asking for a date — from the public course
 * page's "get in touch" composer (docs/product/archive/
 * ux-personas-20260730-findings.md task 7), or from the schedule page, where
 * there is no course and the request says what it is about in `interest`.
 *
 * `courseId` and `shopId` are always derived server-side from the URL's
 * shop/course slugs — never accepted from the caller — the same discipline
 * `submitTripReview` uses for `bookingId`.
 */
export type RecordCourseInquiryInput = {
  shopId: string;
  /** Null for an ordinary dive request, which names `interest` instead. */
  courseId?: string | null;
  /** What a dive request is about; required when there is no course. */
  interest?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  experienceLevel?: CourseInquiryExperience | null;
  timing?: string | null;
  preferredDate?: CalendarDate | null;
  alternateDate?: CalendarDate | null;
  dateFlexible?: boolean;
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
  const courseId = input.courseId ?? null;
  const interest = normalizeOptional(input.interest);
  // A request must be about something. The check constraint says the same, and
  // the server action refuses it in the diver's own words before reaching here;
  // this is the layer that must not depend on either having run.
  if (!courseId && !interest) {
    throw new Error("recordCourseInquiry: a request names either a course or an interest");
  }
  const personId = email ? await livePersonIdForEmail(db, input.shopId, email) : null;
  const [inserted] = await db
    .insert(courseInquiries)
    .values({
      shopId: input.shopId,
      courseId,
      interest,
      personId,
      name: normalizeOptional(input.name),
      email,
      phone: normalizeOptional(input.phone),
      experienceLevel: input.experienceLevel ?? null,
      timing: normalizeOptional(input.timing),
      preferredDate: input.preferredDate ?? null,
      alternateDate: input.alternateDate ?? null,
      dateFlexible: input.dateFlexible ?? false,
      divers: input.divers ?? null,
      message: normalizeOptional(input.message),
    })
    .returning({ id: courseInquiries.id, createdAt: courseInquiries.createdAt });
  if (!inserted) throw new Error("recordCourseInquiry: insert returned no row");
  return inserted;
}

/**
 * One row of the shop's requests list (/shop/<shop>/requests).
 *
 * Codes and facts only — the grouping is `groupDateRequests` in
 * src/lib/date-requests.ts and the words are the staff bundle's.
 */
export type DateRequestRow = {
  id: string;
  courseId: string | null;
  courseTitle: string | null;
  /** Set exactly when there is no course. */
  interest: string | null;
  personId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  experienceLevel: CourseInquiryExperience | null;
  timing: string | null;
  preferredDate: CalendarDate | null;
  alternateDate: CalendarDate | null;
  dateFlexible: boolean;
  divers: number | null;
  message: string | null;
  createdAt: Date;
};

/** How many requests one page of the staff list holds. */
export const DATE_REQUESTS_PAGE_SIZE = PAGE_SIZE.list;

/**
 * One page of this shop's date requests, ordered by the date they are asking
 * for — soonest first, and the ones that named no date at all last, which is
 * the order the page groups them in.
 *
 * Ordered by the *earliest* date a request names rather than by
 * `preferred_date` alone: a request whose alternate falls before its first
 * choice still belongs beside the day it can first be served. Paging is offset
 * paging like every other staff list (ADR 20260803-one-pagination-model), and
 * the count shares this query's scope exactly — the whole shop, unfiltered.
 */
export async function listDateRequestsForStaff(
  db: DbExecutor,
  shopId: string,
  options: { page?: number } = {},
): Promise<OffsetPage<DateRequestRow>> {
  const firstDate = sql`least(${courseInquiries.preferredDate}, ${courseInquiries.alternateDate})`;
  return offsetPage<DateRequestRow>({
    page: options.page,
    pageSize: DATE_REQUESTS_PAGE_SIZE,
    countRows: async () => {
      const [row] = await db
        .select({ n: count() })
        .from(courseInquiries)
        .where(eq(courseInquiries.shopId, shopId));
      return row?.n ?? 0;
    },
    fetchRows: (offset, limit) =>
      db
        .select({
          id: courseInquiries.id,
          courseId: courseInquiries.courseId,
          courseTitle: courses.title,
          interest: courseInquiries.interest,
          personId: courseInquiries.personId,
          name: courseInquiries.name,
          email: courseInquiries.email,
          phone: courseInquiries.phone,
          experienceLevel: courseInquiries.experienceLevel,
          timing: courseInquiries.timing,
          preferredDate: courseInquiries.preferredDate,
          alternateDate: courseInquiries.alternateDate,
          dateFlexible: courseInquiries.dateFlexible,
          divers: courseInquiries.divers,
          message: courseInquiries.message,
          createdAt: courseInquiries.createdAt,
        })
        .from(courseInquiries)
        .leftJoin(courses, eq(courses.id, courseInquiries.courseId))
        .where(eq(courseInquiries.shopId, shopId))
        .orderBy(sql`${firstDate} asc nulls last`, desc(courseInquiries.createdAt))
        .limit(limit)
        .offset(offset),
  });
}

/**
 * Loads the small, explicitly selected set a Requests link carries into the
 * schedule builder. The shop and ids are both checked here; the query string
 * is navigation context, never an authorization boundary.
 */
export async function listDateRequestsByIds(
  db: DbExecutor,
  shopId: string,
  requestIds: string[],
): Promise<DateRequestRow[]> {
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return [];
  return db
    .select({
      id: courseInquiries.id,
      courseId: courseInquiries.courseId,
      courseTitle: courses.title,
      interest: courseInquiries.interest,
      personId: courseInquiries.personId,
      name: courseInquiries.name,
      email: courseInquiries.email,
      phone: courseInquiries.phone,
      experienceLevel: courseInquiries.experienceLevel,
      timing: courseInquiries.timing,
      preferredDate: courseInquiries.preferredDate,
      alternateDate: courseInquiries.alternateDate,
      dateFlexible: courseInquiries.dateFlexible,
      divers: courseInquiries.divers,
      message: courseInquiries.message,
      createdAt: courseInquiries.createdAt,
    })
    .from(courseInquiries)
    .leftJoin(courses, eq(courses.id, courseInquiries.courseId))
    .where(and(eq(courseInquiries.shopId, shopId), inArray(courseInquiries.id, ids)))
    .orderBy(desc(courseInquiries.createdAt));
}

/**
 * Requests that named one of the supplied calendar dates. Callers may pass a
 * small expanded window so flexible requests can be filtered with
 * `dateRequestMatchFor` using the same rules as the Requests page.
 */
export async function listDateRequestsForCalendarDates(
  db: DbExecutor,
  shopId: string,
  dates: CalendarDate[],
): Promise<DateRequestRow[]> {
  const uniqueDates = [...new Set(dates)];
  if (uniqueDates.length === 0) return [];
  return db
    .select({
      id: courseInquiries.id,
      courseId: courseInquiries.courseId,
      courseTitle: courses.title,
      interest: courseInquiries.interest,
      personId: courseInquiries.personId,
      name: courseInquiries.name,
      email: courseInquiries.email,
      phone: courseInquiries.phone,
      experienceLevel: courseInquiries.experienceLevel,
      timing: courseInquiries.timing,
      preferredDate: courseInquiries.preferredDate,
      alternateDate: courseInquiries.alternateDate,
      dateFlexible: courseInquiries.dateFlexible,
      divers: courseInquiries.divers,
      message: courseInquiries.message,
      createdAt: courseInquiries.createdAt,
    })
    .from(courseInquiries)
    .leftJoin(courses, eq(courses.id, courseInquiries.courseId))
    .where(
      and(
        eq(courseInquiries.shopId, shopId),
        or(
          inArray(courseInquiries.preferredDate, uniqueDates),
          inArray(courseInquiries.alternateDate, uniqueDates),
        ),
      ),
    )
    .orderBy(desc(courseInquiries.createdAt));
}
