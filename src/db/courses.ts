import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import {
  type CourseTemplateDiff,
  type CourseTemplateSnapshot,
  type CourseTemplateUpdateMode,
  courseTemplateDatabaseFields,
  courseTemplateDiff,
  courseTemplateSnapshotFromCourse,
  mergedCourseTemplateSnapshot,
  parseCourseTemplateSnapshot,
} from "@/lib/course-template-sync";
import type { CourseContent } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { courseTemplateSnapshot, getCourseTemplate } from "./course-templates";
import { offsetPage } from "./paging";
import type { Course } from "./schema";
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
  /** Whether a session of this course may run on enriched air — see the column's own note. */
  nitroxCompatible?: boolean;
  isPrivate?: boolean;
} & Partial<CourseContent>;

/**
 * Title, agency, the cert gate, and the minimum age come from the agency's
 * catalog; what a shop owns is what it decides for itself — its two prices,
 * and whether it will run this course on enriched air. Everything here is a
 * shop's own answer, which is what separates this patch from
 * {@link CourseContentPatch}'s prose.
 */
export type CoursePatch = Pick<
  NewCourse,
  "priceCents" | "eLearningPriceCents" | "nitroxCompatible" | "isPrivate"
>;

/**
 * The diver-facing page, edited on its own screen and saved in one shot. The
 * minimum age is the agency's and never edited here, so it is not in the patch.
 *
 * Neither is `isIntroCourse`. It rides along on {@link CourseContent} because
 * that is the shape a published template carries, but it is not prose a shop
 * writes: DiveDay ships the catalogue and knows which entries are tasters, and
 * the flag picks the tighter in-water ratio a taster is held to
 * (src/lib/course-ratios.ts). Out of the patch means the page editor cannot
 * send it at all — a safety cap is not a side effect of saving marketing copy.
 */
export type CourseContentPatch = Omit<CourseContent, "minimumAge" | "isIntroCourse">;

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

/** Course agency is imported shop data; tabs use one stable key per company. */
const canonicalAgencyExpression = sql<string>`lower(trim(${courses.agency}))`;

function agencyScope(agency: string) {
  return sql`lower(trim(${courses.agency})) = ${agency.trim().toLowerCase()}`;
}

/**
 * Active catalog entries — what a staff member picks from when scheduling a
 * session, and what the diver-facing catalog lists.
 *
 * `agency` narrows it to one agency's ladder, which is what the diver page's
 * tab strip selects. Left off, the whole active catalog comes back in
 * progression order; passing an agency nobody teaches returns nothing rather
 * than everything, so a caller must have resolved it against
 * {@link activeCourseAgencies} first.
 */
export async function listActiveCourses(
  db: AppDb,
  shopId: string,
  options: { agency?: string } = {},
) {
  const scope = and(
    eq(courses.shopId, shopId),
    eq(courses.isActive, true),
    ...(options.agency ? [agencyScope(options.agency)] : []),
  );
  return db
    .select()
    .from(courses)
    .where(scope)
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
    // An active course *is* the readiness signal here, so this query needs no
    // equivalent of the schedule query's "has published a departure" condition
    // — but it honours the same opt-out, or a shop that asked not to be listed
    // would still have its course pages in the sitemap
    // (ADR 20260813-search-listing-is-a-choice).
    .where(
      and(eq(courses.isActive, true), eq(shops.isDemo, false), isNull(shops.searchListingOptOutAt)),
    );
  return rows;
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
    .selectDistinct({ agency: canonicalAgencyExpression })
    .from(courses)
    .where(eq(courses.shopId, shopId))
    .orderBy(asc(canonicalAgencyExpression));
  return rows.map((row) => row.agency);
}

/**
 * The same question asked of the *publicly visible* catalog, for the diver
 * page's tab strip.
 *
 * Deliberately not {@link courseAgencies} with a filter applied afterwards: a
 * shop whose SSI ladder is entirely hidden must not be offered an SSI tab that
 * lands a diver on an empty page. Hidden courses are staff's business, and a
 * tab is a promise that there is something behind it.
 */
export async function activeCourseAgencies(db: AppDb, shopId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ agency: canonicalAgencyExpression })
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.isActive, true)))
    .orderBy(asc(canonicalAgencyExpression));
  return rows.map((row) => row.agency);
}

/** How many courses the staff roster (`/courses`) shows per page. */
export const COURSE_PAGE_SIZE = 20;

export type CoursePage = {
  courses: Course[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * The staff roster's paginated view of the full catalog — hidden entries
 * included, in the shared progression sort, just one page at a time, and
 * optionally narrowed to one agency by the roster's tabs. Callers that need
 * the complete set for a dropdown or picker use {@link listActiveCourses},
 * not this.
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
    ? and(eq(courses.shopId, shopId), agencyScope(options.agency))
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
      // A checkbox that arrives absent means unticked, never "leave it alone" —
      // the editor always renders the control, so an omitted key is a form that
      // did not have it and the column keeps its own default rather than
      // silently flipping.
      ...(input.nitroxCompatible === undefined ? {} : { nitroxCompatible: input.nitroxCompatible }),
      ...(input.isPrivate === undefined ? {} : { isPrivate: input.isPrivate }),
    })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .returning();
  return course ?? null;
}

export type CourseTemplateUpdate = {
  course: Course;
  baseline: CourseTemplateSnapshot | null;
  current: CourseTemplateSnapshot;
  latest: CourseTemplateSnapshot;
  diff: CourseTemplateDiff[];
  latestVersion: number;
  currentVersion: number;
  legacyBaseline: boolean;
  sourceTemplateSlug: string;
};

function courseTemplateUpdateFromCourse(course: Course): CourseTemplateUpdate | null {
  // Before source tracking existed, the seeded PADI rows still carried the
  // stable template slug in their course slug. Treat that as a legacy link
  // only when the agency and title agree; the missing snapshot means the safe
  // merge must preserve all editable prose rather than guessing ownership.
  const legacyTemplate = course.sourceTemplateSlug ? null : getCourseTemplate(course.slug);
  const sourceTemplateSlug = course.sourceTemplateSlug ?? legacyTemplate?.slug;
  if (!sourceTemplateSlug) return null;

  const template = getCourseTemplate(sourceTemplateSlug);
  if (
    !template ||
    (course.sourceTemplateSlug === null &&
      (course.agency.trim().toLowerCase() !== template.agency || course.title !== template.title))
  ) {
    return null;
  }
  const currentVersion = course.sourceTemplateVersion ?? 1;
  const baseline = parseCourseTemplateSnapshot(course.sourceTemplateSnapshot);
  if (template.version <= currentVersion) return null;

  const current = courseTemplateSnapshotFromCourse(course);
  const latest = courseTemplateSnapshot(template);
  return {
    course,
    baseline,
    current,
    latest,
    diff: courseTemplateDiff(current, baseline, latest),
    latestVersion: template.version,
    currentVersion,
    legacyBaseline: baseline === null,
    sourceTemplateSlug: template.slug,
  };
}

/**
 * Return a template revision only when a course has a valid source baseline and
 * the code-owned template has moved forward. A missing or malformed baseline
 * is intentionally not guessed at: the safe UI simply offers no merge.
 */
export async function getCourseTemplateUpdate(
  db: AppDb,
  shopId: string,
  courseId: string,
): Promise<CourseTemplateUpdate | null> {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .limit(1);
  if (!course) return null;
  return courseTemplateUpdateFromCourse(course);
}

/**
 * Apply a reviewed template revision. The update is tenant-scoped and writes
 * the new baseline in the same statement as the merged fields, so a later
 * revision can distinguish a shop edit from an already-applied template word.
 */
export async function pullCourseTemplateUpdates(
  db: AppDb,
  shopId: string,
  courseId: string,
  mode: CourseTemplateUpdateMode,
) {
  // The merge reads the shop's current prose and then writes a derived row.
  // Lock that row for the whole read/merge/write so an editor save cannot land
  // between those steps and be overwritten by an older template view.
  return db.transaction(async (tx) => {
    const [currentCourse] = await tx
      .select()
      .from(courses)
      .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
      .for("update");
    if (!currentCourse) return { status: "unavailable" as const };
    const update = courseTemplateUpdateFromCourse(currentCourse);
    if (!update) return { status: "unavailable" as const };

    const merged = mergedCourseTemplateSnapshot(
      update.current,
      update.baseline,
      update.latest,
      mode,
    );
    const [course] = await tx
      .update(courses)
      .set({
        ...courseTemplateDatabaseFields(merged),
        sourceTemplateSlug: update.sourceTemplateSlug,
        sourceTemplateVersion: update.latestVersion,
        sourceTemplateSnapshot: update.latest,
      })
      .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
      .returning();
    if (!course) return { status: "unavailable" as const };
    return { status: "updated" as const, course, mode, diff: update.diff };
  });
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
 * Saves the whole marketing page at once. Pricing, the cert gate, the agency's
 * minimum age, and the taster flag are untouched — none of those are marketing
 * prose, and the last one is a safety cap (see {@link CourseContentPatch}).
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
    })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .returning();
  return course ?? null;
}
