import { and, asc, eq } from "drizzle-orm";
import type { CertificationLevel } from "@/lib/readiness";
import type { AppDb } from "./client";
import { courses } from "./schema";

export type NewCourse = {
  shopId: string;
  title: string;
  description?: string;
  minimumCertificationLevel?: CertificationLevel | null;
  requiresInstructor?: boolean;
  requiresWaiver?: boolean;
};

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
      description: input.description?.trim() || null,
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

export async function getCourse(db: AppDb, shopId: string, courseId: string) {
  const [course] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.shopId, shopId)))
    .limit(1);
  return course ?? null;
}
