import { eq } from "drizzle-orm";
import { courseSlug } from "@/lib/courses";
import type { DbExecutor } from "./client";
import { COURSE_TEMPLATES, type CourseTemplate, courseTemplateSnapshot } from "./course-templates";
import { courses } from "./schema";

/**
 * **One display title per course, disambiguated by agency where two agencies
 * teach the same one.**
 *
 * A course's public URL is minted from its title (`courseSlug`), and the
 * title-only staff and session helpers look a course up by name — so two rows
 * called "Rescue Diver" is not a cosmetic problem, it is a slug collision and
 * an ambiguous lookup.
 *
 * This was a single hard-coded exception for `ssi-open-water-diver`, because
 * that was the only clash in the tree. Adding SDI brought nine more at once —
 * Rescue Diver, Divemaster, Deep Diver, Wreck, Drift, Boat, Dry Suit,
 * Equipment Specialist and Sidemount all exist under PADI too — which is more
 * exceptions than a list of exceptions can honestly hold.
 *
 * **The first template to claim a title keeps it bare; every later one wears
 * its agency.** The templates are in agency order, so PADI keeps the
 * unqualified names it already has and this reproduces the old hard-coded
 * result exactly: SSI's is still "SSI Open Water Diver" and nothing else moves.
 * A template's own `title` is untouched — that stays the agency's official
 * name, which is what the course page itself reads.
 *
 * Exported because the seed is not the only reader: `courses.test.ts` asserts
 * every template reaches the catalog under the right name, and a second copy of
 * this rule in the test would pass while disagreeing with the seed.
 */
const DISPLAY_TITLE_BY_SLUG = new Map<string, string>();
{
  // **Claimed by slug, not by title.** The uniqueness this protects is
  // `courses_shop_slug_unique`, and `courseSlug` normalises — it lowercases and
  // collapses every run of non-alphanumerics to one `-`. So two titles that
  // merely *look* different can still land on one slug ("Photo & Video" and
  // "Photo Video" both give `photo-video`), and comparing the titles would wave
  // that through into a constraint violation at seed time. No pair in the tree
  // collides today, which is exactly why this is worth pinning rather than
  // noticing later: `seed-catalog.test.ts` asserts the whole set is distinct.
  const claimed = new Set<string>();
  for (const template of COURSE_TEMPLATES) {
    const key = courseSlug(template.title);
    DISPLAY_TITLE_BY_SLUG.set(
      template.slug,
      claimed.has(key) ? `${template.agency.toUpperCase()} ${template.title}` : template.title,
    );
    claimed.add(key);
  }
}

/** What a template is called in a shop's own catalog — see the map above. */
export function courseTemplateDisplayTitle(template: CourseTemplate): string {
  return DISPLAY_TITLE_BY_SLUG.get(template.slug) ?? template.title;
}

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
  const templateKey = (agency: string, title: string) => `${agency.toLowerCase()}:${title}`;
  const templateByKey = new Map(
    COURSE_TEMPLATES.map((template) => [templateKey(template.agency, template.title), template]),
  );
  const templateBySlug = new Map(COURSE_TEMPLATES.map((template) => [template.slug, template]));
  // Catalog baselines: DSD/OW welcome uncertified students; continuing
  // education admits only a verified card at the stated level.
  const baseCourseRows = [
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
      description: "Four dives that extend your range to 40 meters (130 feet).",
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
  ];
  const seededCourseKeys = new Set(
    baseCourseRows.map((course) => templateKey(course.agency, course.title)),
  );
  const missingTemplateRows = COURSE_TEMPLATES.filter(
    (template) =>
      !seededCourseKeys.has(templateKey(template.agency, courseTemplateDisplayTitle(template))),
  ).map((template) => ({
    shopId,
    agency: template.agency,
    title: courseTemplateDisplayTitle(template),
    description: template.description,
    // A template is a complete, bookable catalog entry. Prices remain shop
    // editable; these conservative defaults keep the new rows useful in the
    // demo without pretending they share the price of an existing course.
    priceCents: template.minimumCertificationLevel === "rescue" ? 95000 : 22500,
    eLearningPriceCents: template.minimumCertificationLevel === null ? null : 15000,
    minimumCertificationLevel: template.minimumCertificationLevel,
    isIntroCourse: template.content.isIntroCourse,
  }));
  const courseRows = await db
    .insert(courses)
    .values(
      [...baseCourseRows, ...missingTemplateRows].map((course) => {
        const template =
          templateByKey.get(templateKey(course.agency, course.title)) ??
          templateBySlug.get(courseSlug(course.title));
        const isIntroCourse = template?.content.isIntroCourse ?? course.isIntroCourse ?? false;
        const minimumCertificationLevel = template
          ? template.minimumCertificationLevel
          : course.minimumCertificationLevel;
        return {
          ...course,
          ...(template
            ? {
                agency: template.agency,
                description: template.description,
                minimumCertificationLevel,
                isIntroCourse,
                sourceTemplateSlug: template.slug,
                sourceTemplateVersion: template.version,
                sourceTemplateSnapshot: courseTemplateSnapshot(template),
              }
            : {}),
          slug: courseSlug(course.title),
          // The same rule the `nitrox_compatible` migration backfills existing
          // shops with, so a freshly seeded catalog and a migrated one answer
          // identically: a taster, or any course open to uncertified divers,
          // runs on air. Nobody enrolled on those holds the verified nitrox card
          // a fill needs, so offering the box would advertise a fill the course
          // cannot give. Everything above that rung keeps the column's `true`
          // default, and a shop turns one off on the course page.
          nitroxCompatible: !(isIntroCourse || minimumCertificationLevel === null),
        };
      }),
    )
    .returning();
  const discoverCourse = courseRows.find((course) => course.title === "Discover Scuba Diving");
  if (!discoverCourse) throw new Error("seed: DSD course missing");

  // The demo shop starts where a real shop does: every course pre-filled with
  // DiveDay's default page copy. That default content is the shop's starting
  // point — it edits from there. Open Water is the one a visitor is most
  // likely to open, so it is the most complete.
  for (const template of COURSE_TEMPLATES) {
    const course = courseRows.find((row) => row.sourceTemplateSlug === template.slug);
    if (!course) continue;
    await db.update(courses).set(template.content).where(eq(courses.id, course.id));
  }
  const openWaterCourse = courseRows.find((course) => course.title === "Open Water Diver");
  const courseIdByTitle = new Map(courseRows.map((course) => [course.title, course.id]));

  return { courseRows, discoverCourse, openWaterCourse, courseIdByTitle };
}
