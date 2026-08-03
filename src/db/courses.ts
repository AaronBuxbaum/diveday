import { and, asc, eq, gt, or } from "drizzle-orm";
import type { CourseContent } from "@/lib/courses";
import { courseSlug } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
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
      imageUrls: input.imageUrls ?? [],
      imageAlts: input.imageAlts ?? [],
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

/** Active catalog entries available when a staff member schedules a session. */
export async function listActiveCourses(db: AppDb, shopId: string) {
  return db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.isActive, true)))
    .orderBy(asc(courses.title));
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
    .orderBy(asc(courses.agency), asc(courses.title));
}

/** How many courses the staff roster (`/courses`) shows per page before "Show more". */
export const COURSE_PAGE_SIZE = 20;

export type CoursePage = {
  courses: Awaited<ReturnType<typeof listCourses>>;
  nextCursor: string | null;
};

/**
 * The staff roster's own paginated view of {@link listCourses} — same scope
 * (full catalog, hidden entries included) and sort (agency, then title,
 * which is unique per shop and so doubles as the keyset tiebreak), just one
 * keyset page at a time. Every other caller of `listCourses`/
 * `listActiveCourses` needs the complete set for a dropdown or picker and
 * must keep calling those, not this.
 *
 * Still forward-only, and it should not stay that way: ADR
 * 20260803-one-pagination-model moved the roster, reports, and the moderation
 * queue onto `offsetPage` + the shared `Pager`, and this roster is the same
 * job. It is one of the three stragglers named there.
 */
export async function pagedCourses(
  db: AppDb,
  shopId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<CoursePage> {
  const limit = options.limit ?? COURSE_PAGE_SIZE;
  const after = decodeCursor(options.cursor);

  const rows = await db
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.shopId, shopId),
        after
          ? or(
              gt(courses.agency, after[0]),
              and(eq(courses.agency, after[0]), gt(courses.title, after[1])),
            )
          : undefined,
      ),
    )
    .orderBy(asc(courses.agency), asc(courses.title))
    .limit(limit + 1);

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    courses: pageRows,
    nextCursor: rows.length > limit && last ? encodeCursor(last.agency, last.title) : null,
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
      imageUrls: input.imageUrls,
      imageAlts: input.imageAlts,
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
