import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { courses, shops } from "./schema";
import { SEED_COURSE_ILLUSTRATIONS } from "./seed-course-illustrations";

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
      .set({ heroImageUrl: image.url, heroImageAlt: image.alt })
      .where(and(eq(courses.shopId, shopId), courseIdentity));
  }
}
