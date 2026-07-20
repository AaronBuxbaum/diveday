import { and, asc, eq } from "drizzle-orm";
import type { CourseContent } from "@/lib/courses";
import { courseSlug } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { courses } from "./schema";

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
      imageUrls: input.imageUrls ?? [],
      durationText: input.durationText ?? null,
      groupSizeText: input.groupSizeText ?? null,
      minimumAge: input.minimumAge ?? null,
      prerequisiteNote: input.prerequisiteNote ?? null,
      includes: input.includes ?? [],
      excludes: input.excludes ?? [],
      scheduleDays: input.scheduleDays ?? [],
      faqs: input.faqs ?? [],
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

/** Full shop copy, including entries hidden from new session scheduling. */
export async function listCourses(db: AppDb, shopId: string) {
  return db
    .select()
    .from(courses)
    .where(eq(courses.shopId, shopId))
    .orderBy(asc(courses.agency), asc(courses.title));
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

export async function getCourse(db: AppDb, shopId: string, courseId: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .limit(1);
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

/** The shop's public course pages, in the order a visitor should meet them. */
export async function listPublishedCourses(db: AppDb, shopId: string) {
  return db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.isPublished, true)))
    .orderBy(asc(courses.agency), asc(courses.title));
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
      imageUrls: input.imageUrls,
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

export async function setCoursePublished(
  db: AppDb,
  shopId: string,
  courseId: string,
  published: boolean,
) {
  const [course] = await db
    .update(courses)
    .set({ isPublished: published })
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .returning();
  return course ?? null;
}
