/**
 * Test-local catalog fixture builder. Production creates catalog entries by
 * copying a DiveDay-published template (`src/content/course-templates.ts`); these
 * tests need arbitrary shapes, so they insert directly.
 */

/** Test-local full-catalog read in the shared progression order (mirrors `pagedCourses`' sort). */
import type { AppDb } from "../../db/client";
import { courses } from "../../db/schema/index";
import { courseSlug } from "../../lib/courses";
import { type NewCourse, pagedCourses } from "./store";

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
      privatePriceCents: input.privatePriceCents ?? null,
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

export async function listCourses(db: AppDb, shopId: string) {
  const { courses: rows } = await pagedCourses(db, shopId, { limit: 1000 });
  return rows;
}
