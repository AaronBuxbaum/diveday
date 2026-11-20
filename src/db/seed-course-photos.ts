import { eq, sql } from "drizzle-orm";
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

/**
 * Fictional course-specific illustrations for demo shops, never real operator photos.
 * One statement for the catalog rather than one per course (#4763).
 */
export async function seedCoursePhotos(db: DbExecutor, shopId: string): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  const images = sql.join(
    Object.entries(SEED_COURSE_ILLUSTRATIONS).map(
      ([templateSlug, image]) => sql`(${templateSlug}, ${image.url}, ${image.alt})`,
    ),
    sql`, `,
  );
  // Nitrox 40 is SSI's own catalog row, named by agency and title: no template carries it.
  await db.execute(sql`
    update ${courses}
    set hero_image_url = image.url, hero_image_alt = image.alt,
      gallery_photos = case when image.template_slug = 'open-water-diver'
        then ${JSON.stringify(OPEN_WATER_GALLERY)}::jsonb else ${courses.galleryPhotos} end
    from (values ${images}) as image(template_slug, url, alt)
    where ${courses.shopId} = ${shopId}
      and case when image.template_slug = 'ssi-nitrox-40'
        then ${courses.sourceTemplateSlug} is null and ${courses.agency} = 'ssi' and ${courses.title} = 'Nitrox 40'
        else ${courses.sourceTemplateSlug} = image.template_slug end`);
}
