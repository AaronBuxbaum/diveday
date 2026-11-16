import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { courses, shops } from "./schema";
import { SEED_COURSE_ILLUSTRATIONS } from "./seed-course-illustrations";

// Fictional scenes made for the demo's Open Water course, not operator photos.
export const OPEN_WATER_GALLERY = [
  "Students listen to an instructor in an open-air classroom",
  "An instructor and student look at a mask beside a pool",
  "Two learners carry fins toward a dock",
  "Students chat aboard a moored dive boat",
  "Fins, masks, and towels on a bench",
  "An instructor speaks with students on a beach",
  "A turtle and fish swim over a fictional coral reef",
  "Two learners celebrate on a dock",
].map((alt, index) => ({
  url: `/course-illustrations/open-water-gallery/${index + 1}.webp`,
  alt: `Illustration: ${alt}.`,
}));

/** Fictional course-specific illustrations for demo shops, never real operator photos. */
export async function seedCoursePhotos(db: DbExecutor, shopId: string): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  for (const [templateSlug, image] of Object.entries(SEED_COURSE_ILLUSTRATIONS)) {
    const courseIdentity =
      templateSlug === "ssi-nitrox-40"
        ? and(
            isNull(courses.sourceTemplateSlug),
            eq(courses.agency, "ssi"),
            eq(courses.title, "Nitrox 40"),
          )
        : eq(courses.sourceTemplateSlug, templateSlug);
    await db
      .update(courses)
      .set({
        heroImageUrl: image.url,
        heroImageAlt: image.alt,
        ...(templateSlug === "open-water-diver" ? { galleryPhotos: OPEN_WATER_GALLERY } : {}),
      })
      .where(and(eq(courses.shopId, shopId), courseIdentity));
  }
}
