import { and, eq } from "drizzle-orm";
import { demoIllustration } from "@/content/demo-illustrations";
import type { DbExecutor } from "./client";
import { courses, shops } from "./schema";

/** Activity-led fictional illustrations, shared when courses teach the same kind of activity.
 * Never publish these as species-identification evidence or as a real operator’s photographs.
 */
export const DEMO_COURSE_PHOTOS = {
  "discover-scuba-diving": "student",
  "open-water-diver": "student",
  "advanced-open-water-diver": "student",
  "rescue-diver": "briefing",
  "scuba-refresher": "student",
  "enriched-air-nitrox-diver": "briefing",
  "peak-performance-buoyancy": "student",
  "night-diver": "briefing",
  "deep-diver": "briefing",
  "wreck-diver": "briefing",
  "underwater-navigator": "briefing",
  "digital-underwater-photographer": "reef",
  "drift-diver": "briefing",
  "boat-diver": "boat",
  "search-and-recovery-diver": "briefing",
  "sidemount-diver": "briefing",
  "fish-identification": "reef",
  divemaster: "briefing",
  "dry-suit-diver": "briefing",
  "emergency-oxygen-provider": "oxygen",
  "equipment-specialist": "briefing",
  "underwater-naturalist": "reef",
  "ssi-try-scuba": "student",
  "ssi-open-water-diver": "student",
  "ssi-advanced-adventurer": "briefing",
  "ssi-diver-stress-and-rescue": "briefing",
  "ssi-scuba-skills-update": "student",
  "ssi-perfect-buoyancy": "student",
  "ssi-deep-diving": "briefing",
  "ssi-navigation": "briefing",
  "ssi-photo-and-video": "reef",
  "ssi-marine-ecology": "reef",
  "ssi-react-right": "oxygen",
  "ssi-dive-guide": "briefing",
  "sdi-scuba-discovery": "student",
  "sdi-open-water-scuba-diver": "student",
  "sdi-advanced-adventure-diver": "briefing",
  "sdi-rescue-diver": "briefing",
  "sdi-divemaster": "briefing",
  "sdi-solo-diver": "briefing",
  "sdi-computer-nitrox-diver": "briefing",
  "sdi-deep-diver": "briefing",
  "sdi-underwater-navigation": "briefing",
  "sdi-night-limited-visibility-diver": "briefing",
  "sdi-wreck-diver": "briefing",
  "sdi-drift-diver": "briefing",
  "sdi-boat-diver": "boat",
  "sdi-search-and-recovery-diver": "briefing",
  "sdi-underwater-photography": "reef",
  "sdi-dry-suit-diver": "briefing",
  "sdi-equipment-specialist": "briefing",
  "sdi-sidemount-diver": "briefing",
  "sdi-marine-ecosystems-awareness": "reef",
  "sdi-inactive-diver-scuba-refresher": "student",
} as const;

export async function seedCoursePhotos(db: DbExecutor, shopId: string): Promise<void> {
  const [shop] = await db.select({ isDemo: shops.isDemo }).from(shops).where(eq(shops.id, shopId));
  if (!shop?.isDemo) return;
  for (const [templateSlug, scene] of Object.entries(DEMO_COURSE_PHOTOS)) {
    const image = demoIllustration(scene);
    await db
      .update(courses)
      .set({ heroImageUrl: image.url, heroImageAlt: image.alt })
      .where(and(eq(courses.shopId, shopId), eq(courses.sourceTemplateSlug, templateSlug)));
  }
}
