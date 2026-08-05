import { eq } from "drizzle-orm";
import { courseSlug } from "@/lib/courses";
import type { DbExecutor } from "./client";
import { COURSE_TEMPLATES } from "./course-templates";
import { courses } from "./schema";

/**
 * What the shop teaches: its course catalog and the page content each course
 * starts from.
 *
 * The catalog's `minimumCertificationLevel` is the admission rule every course
 * session snapshots at creation, so the baselines here are what later gate a
 * seeded roster — DSD and Open Water welcome uncertified students, continuing
 * education admits only a verified card at the stated level.
 */
export async function seedCatalog(db: DbExecutor, shopId: string) {
  // Catalog baselines: DSD/OW welcome uncertified students; continuing
  // education admits only a verified card at the stated level.
  const courseRows = await db
    .insert(courses)
    .values(
      [
        {
          shopId,
          agency: "padi",
          title: "Discover Scuba Diving",
          description: "A supervised first underwater experience with an instructor.",
          priceCents: 17500,
          minimumCertificationLevel: null,
          isIntroCourse: true,
        },
        {
          shopId,
          agency: "padi",
          title: "Open Water Diver",
          description: "The foundational certification course for new divers.",
          priceCents: 49900,
          eLearningPriceCents: 21000,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "padi",
          title: "Advanced Open Water Diver",
          description: "Build confidence and range with five adventure dives.",
          priceCents: 42500,
          eLearningPriceCents: 19000,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Scuba Refresher",
          description: "A patient skills tune-up before getting back in the water.",
          priceCents: 12500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Rescue Diver",
          description: "Problem prevention and rescue skills for experienced divers.",
          priceCents: 52500,
          eLearningPriceCents: 24500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Nitrox Diver",
          description: "Plan and dive safely with Nitrox.",
          priceCents: 19500,
          eLearningPriceCents: 15000,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Peak Performance Buoyancy",
          description: "Two dives spent fixing weighting, trim, and control.",
          priceCents: 22500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Night Diver",
          description: "Three evening dives and the skills the dark demands.",
          priceCents: 29500,
          eLearningPriceCents: 14500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Deep Diver",
          description: "Four dives that extend your range to 40 meters.",
          priceCents: 42500,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Wreck Diver",
          description: "Survey, mapping, and limited penetration on four dives.",
          priceCents: 44500,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "padi",
          title: "Divemaster",
          description: "The first professional rating, taught as an internship.",
          priceCents: 125000,
          eLearningPriceCents: 32500,
          minimumCertificationLevel: "rescue" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Try Scuba",
          description: "A supervised first scuba experience.",
          priceCents: 15000,
          minimumCertificationLevel: null,
          isIntroCourse: true,
        },
        {
          shopId,
          agency: "ssi",
          title: "SSI Open Water Diver",
          description: "SSI's entry-level autonomous diver certification.",
          priceCents: 47500,
          eLearningPriceCents: 19500,
          minimumCertificationLevel: null,
        },
        {
          shopId,
          agency: "ssi",
          title: "Advanced Adventurer",
          description: "Five guided specialty adventure dives.",
          priceCents: 39900,
          eLearningPriceCents: 17500,
          minimumCertificationLevel: "open_water" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Diver Stress & Rescue",
          description: "Recognize stress and respond to diver emergencies.",
          priceCents: 49900,
          eLearningPriceCents: 22500,
          minimumCertificationLevel: "advanced_open_water" as const,
        },
        {
          shopId,
          agency: "ssi",
          title: "Nitrox 40",
          description: "Use nitrox mixes up to 40 percent oxygen.",
          priceCents: 18500,
          eLearningPriceCents: 14000,
          minimumCertificationLevel: "open_water" as const,
        },
        // The public page lives at /courses/<slug>; the catalog is the only place
        // slugs are minted, so the seed mints them the same way an import does.
      ].map((course) => ({ ...course, slug: courseSlug(course.title) })),
    )
    .returning();
  const discoverCourse = courseRows.find((course) => course.title === "Discover Scuba Diving");
  if (!discoverCourse) throw new Error("seed: DSD course missing");

  // The demo shop starts where a real shop does: every course pre-filled with
  // DiveDay's default page copy. That default content is the shop's starting
  // point — it edits from there. Open Water is the one a visitor is most
  // likely to open, so it is the most complete.
  for (const template of COURSE_TEMPLATES) {
    const course = courseRows.find((row) => row.title === template.title);
    if (!course) continue;
    await db.update(courses).set(template.content).where(eq(courses.id, course.id));
  }
  const openWaterCourse = courseRows.find((course) => course.title === "Open Water Diver");
  const courseIdByTitle = new Map(courseRows.map((course) => [course.title, course.id]));

  return { courseRows, discoverCourse, openWaterCourse, courseIdByTitle };
}
