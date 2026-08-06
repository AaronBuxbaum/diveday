import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { CourseContent } from "@/lib/courses";
import { courseSlug } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { offsetPage } from "./paging";
import { courses, shops } from "./schema";

export type NewCourse = {
  shopId: string;
  title: string;
  agency?: "padi" | "ssi";
  description?: string;
  slug?: string;
  priceCents?: number | null;
  eLearningPriceCents?: number | null;
  minimumCertificationLevel?: CertificationLevel | null;
} & Partial<CourseContent>;

/**
 * Title, agency, the cert gate, and the minimum age come from the agency's
 * catalog; a shop owns only its two prices, which it sets on the course page.
 */
export type CoursePatch = Pick<NewCourse, "priceCents" | "eLearningPriceCents">;

/**
 * The diver-facing page, edited on its own screen and saved in one shot. The
 * minimum age is the agency's and never edited here, so it is not in the patch.
 */
export type CourseContentPatch = Omit<CourseContent, "minimumAge">;

/**
 * The catalog owns the reusable admission baseline. A particular session
 * inherits it when scheduled; later course edits never silently rewrite an
 * already-published session's readiness requirements.
 */
export async function createCourse(db: AppDb, input: NewCourse) {
  const title = input.title.trim();
  const [course] = await db
    .insert(courses)
    .values({
      shopId: input.shopId,
      title,
      agency: input.agency ?? "padi",
      description: input.description?.trim() || null,
      slug: input.slug ?? courseSlug(title),
      priceCents: input.priceCents ?? null,
      eLearningPriceCents: input.eLearningPriceCents ?? null,
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      summary: input.summary ?? null,
      overview: input.overview ?? null,
      heroImageUrl: input.heroImageUrl ?? null,
      heroImageAlt: input.heroImageAlt ?? null,
      galleryPhotos: input.galleryPhotos ?? [],
      durationText: input.durationText ?? null,
      groupSizeText: input.groupSizeText ?? null,
      minimumAge: input.minimumAge ?? null,
      prerequisiteNote: input.prerequisiteNote ?? null,
      includes: input.includes ?? [],
      excludes: input.excludes ?? [],
      scheduleDays: input.scheduleDays ?? [],
      faqs: input.faqs ?? [],
      isIntroCourse: input.isIntroCourse ?? false,
    })
    .returning();
  return course ?? null;
}

/**
 * Progression order: the sequence a shop teaches its catalog in, read off the
 * courses themselves.
 *
 * `minimum_certification_level` *is* the ladder — Open Water opens Advanced,
 * Advanced opens Rescue, Rescue opens Divemaster — and Postgres orders an enum
 * by its declared order, which is that ladder (`certification_level` in
 * schema.ts). Nulls sort **first**, not last: a course that admits an
 * uncertified diver is where a diver starts, and Postgres's ASC default would
 * otherwise bury Open Water below Divemaster. Within one rung a taster session
 * comes before the certification it leads into (Discover Scuba, then Open
 * Water), and title breaks the remaining ties — it is unique per shop, so the
 * sort is total and paging is stable.
 *
 * Derived, never stored. The shop-built certification paths this replaced kept
 * the same ladder in their own tables, where it could disagree with the
 * courses and where a newly added course simply never appeared
 * (ADR 20260805-remove-certification-paths).
 */
const progressionOrder = [
  sql`${courses.minimumCertificationLevel} asc nulls first`,
  desc(courses.isIntroCourse),
  asc(courses.title),
];

/** Active catalog entries available when a staff member schedules a session. */
export async function listActiveCourses(db: AppDb, shopId: string) {
  return db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.isActive, true)))
    .orderBy(...progressionOrder);
}

/**
 * Whether this shop's public catalog has anything in it.
 *
 * The one fact the diver-facing header needs to decide whether a "Courses" tab
 * has anywhere worth going, and it runs on every public page render — so it
 * asks the database for the existence of a row rather than reading the whole
 * catalog through {@link listActiveCourses} and counting it. Never widen this
 * into a count: nothing shows a number, and a count cannot stop at the first
 * row.
 */
export async function hasActiveCourses(db: AppDb, shopId: string): Promise<boolean> {
  const rows = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.isActive, true)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Every publicly-indexable course page, for the sitemap — active courses at
 * non-demo shops, across the whole catalog rather than one shop at a time, so
 * this joins to `shops` for the `isDemo` filter instead of looping
 * {@link listActiveCourses} per shop.
 */
export async function listActiveCoursesForSitemap(
  db: AppDb,
): Promise<{ shopSlug: string; courseSlug: string }[]> {
  const rows = await db
    .select({ shopSlug: shops.slug, courseSlug: courses.slug })
    .from(courses)
    .innerJoin(shops, eq(courses.shopId, shops.id))
    .where(and(eq(courses.isActive, true), eq(shops.isDemo, false)));
  return rows;
}

/**
 * Full shop copy, including entries hidden from new session scheduling. Used
 * wherever the *complete* catalog is needed, not one page of it: the New Trip
 * course dropdown, the certification-path builder's course picker, and the
 * roster this file also exposes a paginated view of below. Never add a
 * `limit` here — every one of those callers needs the whole set.
 */
export async function listCourses(db: AppDb, shopId: string) {
  return db
    .select()
    .from(courses)
    .where(eq(courses.shopId, shopId))
    .orderBy(...progressionOrder);
}

/**
 * The agencies this shop's catalog actually holds, alphabetically.
 *
 * Drives the roster's agency tabs, which is why it is a `SELECT DISTINCT` over
 * the shop's own rows rather than a constant: `courses.agency` is free text a
 * CSV import can carry anything into, so a hard-coded PADI/SSI pair would hide
 * a third agency's courses behind no tab at all. One or zero agencies means
 * there is nothing to filter and the roster renders no tab strip.
 */
export async function courseAgencies(db: AppDb, shopId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ agency: courses.agency })
    .from(courses)
    .where(eq(courses.shopId, shopId))
    .orderBy(asc(courses.agency));
  return rows.map((row) => row.agency);
}

/** How many courses the staff roster (`/courses`) shows per page. */
export const COURSE_PAGE_SIZE = 20;

export type CoursePage = {
  courses: Awaited<ReturnType<typeof listCourses>>;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * The staff roster's own paginated view of {@link listCourses} — same scope
 * (full catalog, hidden entries included) and the same progression sort, just
 * one page at a time, and optionally narrowed to one agency by the roster's
 * tabs. Every other caller of `listCourses`/`listActiveCourses` needs the
 * complete set for a dropdown or picker and must keep calling those, not this.
 *
 * `scope` is built once and used by **both** the count and the row query: a
 * count taken over a wider scope than the rows would promise pages that render
 * nothing (AGENTS.md, one-pagination-model).
 *
 * Offset-paged, like the roster and the orders index. It was a forward-only
 * keyset cursor, which meant a staffer three pages into a large catalog had
 * "Show more" and "Back to top" and nothing in between — no way back one page,
 * and no way to see how much catalog was left
 * (ADR 20260803-one-pagination-model).
 */
export async function pagedCourses(
  db: AppDb,
  shopId: string,
  options: { page?: number; limit?: number; agency?: string } = {},
): Promise<CoursePage> {
  const scope = options.agency
    ? and(eq(courses.shopId, shopId), eq(courses.agency, options.agency))
    : eq(courses.shopId, shopId);

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? COURSE_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db.select({ total: count() }).from(courses).where(scope);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select()
        .from(courses)
        .where(scope)
        .orderBy(...progressionOrder)
        .limit(limit)
        .offset(offset),
  });

  return {
    courses: paged.rows,
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

export async function updateCourse(
  db: AppDb,
  shopId: string,
  courseId: string,
  input: CoursePatch,
) {
  const [course] = await db
    .update(courses)
    .set({
      priceCents: input.priceCents ?? null,
      eLearningPriceCents: input.eLearningPriceCents ?? null,
    })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .returning();
  return course ?? null;
}

/** Catalog deletion is an archive so historical course sessions keep their snapshot. */
export async function archiveCourse(db: AppDb, shopId: string, courseId: string) {
  const [course] = await db
    .update(courses)
    .set({ isActive: false })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId), eq(courses.isActive, true)))
    .returning({ id: courses.id });
  return Boolean(course);
}

export async function setCourseVisibility(
  db: AppDb,
  shopId: string,
  courseId: string,
  visible: boolean,
) {
  const [course] = await db
    .update(courses)
    .set({ isActive: visible })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .returning();
  return course ?? null;
}

export async function getCourseBySlug(db: AppDb, shopId: string, slug: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.slug, slug), eq(courses.shopId, shopId)))
    .limit(1);
  return course ?? null;
}

/**
 * Saves the whole marketing page at once. Pricing, the cert gate, and the
 * agency's minimum age are untouched — those are not marketing prose.
 */
export async function updateCourseContent(
  db: AppDb,
  shopId: string,
  courseId: string,
  input: CourseContentPatch,
) {
  const [course] = await db
    .update(courses)
    .set({
      summary: input.summary?.trim() || null,
      overview: input.overview?.trim() || null,
      heroImageUrl: input.heroImageUrl?.trim() || null,
      heroImageAlt: input.heroImageAlt?.trim() || null,
      galleryPhotos: input.galleryPhotos,
      durationText: input.durationText?.trim() || null,
      groupSizeText: input.groupSizeText?.trim() || null,
      prerequisiteNote: input.prerequisiteNote?.trim() || null,
      includes: input.includes,
      excludes: input.excludes,
      scheduleDays: input.scheduleDays,
      faqs: input.faqs,
      isIntroCourse: input.isIntroCourse,
    })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .returning();
  return course ?? null;
}
