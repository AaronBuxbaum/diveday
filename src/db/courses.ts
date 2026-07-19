import { and, asc, eq } from "drizzle-orm";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { courses } from "./schema";

export type NewCourse = {
  shopId: string;
  title: string;
  agency?: "padi" | "ssi";
  description?: string;
  priceCents?: number | null;
  eLearningPriceCents?: number | null;
  minimumCertificationLevel?: CertificationLevel | null;
  requiresInstructor?: boolean;
  requiresWaiver?: boolean;
};

export type CoursePatch = Omit<NewCourse, "shopId">;

/**
 * The catalog owns the reusable admission baseline. A particular session
 * inherits it when scheduled; later course edits never silently rewrite an
 * already-published session's readiness requirements.
 */
export async function createCourse(db: AppDb, input: NewCourse) {
  const [course] = await db
    .insert(courses)
    .values({
      shopId: input.shopId,
      title: input.title.trim(),
      agency: input.agency ?? "padi",
      description: input.description?.trim() || null,
      priceCents: input.priceCents ?? null,
      eLearningPriceCents: input.eLearningPriceCents ?? null,
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      requiresInstructor: input.requiresInstructor ?? true,
      requiresWaiver: input.requiresWaiver ?? true,
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
      title: input.title.trim(),
      agency: input.agency ?? "padi",
      description: input.description?.trim() || null,
      priceCents: input.priceCents ?? null,
      eLearningPriceCents: input.eLearningPriceCents ?? null,
      minimumCertificationLevel: input.minimumCertificationLevel ?? null,
      requiresInstructor: input.requiresInstructor ?? true,
      requiresWaiver: input.requiresWaiver ?? true,
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
