import { and, asc, eq, inArray } from "drizzle-orm";
import type { CourseContent } from "@/lib/courses";
import { courseSlug } from "@/lib/courses";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { courses, globalCourses, globalCourseVersions } from "./schema";

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
 * Title, agency, and the prerequisite card come from the agency's catalog, so
 * a shop owns its two prices, its blurb, and everything on the public page.
 */
export type CoursePatch = Pick<NewCourse, "description" | "priceCents" | "eLearningPriceCents">;

/** The diver-facing page, edited on its own screen and saved in one shot. */
export type CourseContentPatch = CourseContent & { relatedCourseIds: string[] };

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
      description: input.description?.trim() || null,
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

/** Resolve the cross-sell cards at the foot of a course page, published ones only. */
export async function listRelatedCourses(db: AppDb, shopId: string, courseIds: string[]) {
  if (courseIds.length === 0) return [];
  const rows = await db
    .select()
    .from(courses)
    .where(
      and(
        eq(courses.shopId, shopId),
        eq(courses.isPublished, true),
        inArray(courses.id, courseIds),
      ),
    );
  // Keep the shop's chosen order rather than whatever the index returns.
  return courseIds.flatMap((id) => rows.filter((course) => course.id === id));
}

/** Saves the whole marketing page at once; pricing and the cert gate are untouched. */
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
      minimumAge: input.minimumAge,
      prerequisiteNote: input.prerequisiteNote?.trim() || null,
      includes: input.includes,
      excludes: input.excludes,
      scheduleDays: input.scheduleDays,
      faqs: input.faqs,
      relatedCourseIds: input.relatedCourseIds,
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

export async function listGlobalCourseTemplates(db: AppDb) {
  return db
    .select({ template: globalCourses, version: globalCourseVersions })
    .from(globalCourses)
    .innerJoin(
      globalCourseVersions,
      and(
        eq(globalCourseVersions.globalCourseId, globalCourses.id),
        eq(globalCourseVersions.version, globalCourses.currentVersion),
      ),
    )
    .orderBy(asc(globalCourses.slug));
}

/**
 * Copy a published template into the shop's catalog as an independent row.
 * Nothing links back for reads: a later template version never rewrites what a
 * shop has edited, and never relaxes a cert gate under a live course.
 */
export async function importGlobalCourseTemplate(db: AppDb, shopId: string, templateId: string) {
  const [row] = await db
    .select({ template: globalCourses, version: globalCourseVersions })
    .from(globalCourses)
    .innerJoin(
      globalCourseVersions,
      and(
        eq(globalCourseVersions.globalCourseId, globalCourses.id),
        eq(globalCourseVersions.version, globalCourses.currentVersion),
      ),
    )
    .where(eq(globalCourses.id, templateId))
    .limit(1);
  if (!row) return null;
  // A shop that already teaches this course keeps its own pricing and edits;
  // re-importing would otherwise trip the (shop_id, title) unique index.
  const existing = await getCourseByTitle(db, shopId, row.version.title);
  if (existing) return existing;
  const [course] = await db
    .insert(courses)
    .values({
      shopId,
      title: row.version.title,
      agency: row.version.agency,
      description: row.version.description,
      slug: await availableCourseSlug(db, shopId, courseSlug(row.version.title)),
      // The content blob is `$type`-asserted, not validated — a stray key in
      // published JSON would win over anything spread above it. The admission
      // gate goes *after* the spread so no template can ever relax it.
      ...row.version.content,
      minimumCertificationLevel: row.version.minimumCertificationLevel,
      sourceTemplateId: row.template.id,
      sourceTemplateVersion: row.version.version,
    })
    .returning();
  return course ?? null;
}

async function getCourseByTitle(db: AppDb, shopId: string, title: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.shopId, shopId), eq(courses.title, title)))
    .limit(1);
  return course ?? null;
}

/** Suffix a slug until it is free within the shop, so an import never collides. */
async function availableCourseSlug(db: AppDb, shopId: string, base: string) {
  const taken = new Set(
    (await db.select({ slug: courses.slug }).from(courses).where(eq(courses.shopId, shopId))).map(
      (row) => row.slug,
    ),
  );
  if (!taken.has(base)) return base;
  let attempt = 2;
  while (taken.has(`${base}-${attempt}`)) attempt += 1;
  return `${base}-${attempt}`;
}
