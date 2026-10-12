import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { marineLifeImage } from "./marine-life-catalog";
import { courses } from "./schema";

/**
 * **Every demo course wears its own photo** (UX review 2026-10-10, item 19).
 *
 * The course templates draw from the dozen bundled reef frames under
 * `public/dive-sites/`, so the demo's storefront put one Molasses Reef frame
 * on the shop's cover, on Open Water and Underwater Navigator, and on the
 * Molasses Reef site itself, and the public site read as a template. The demo
 * shop has chosen its own: one species photograph per course, from the
 * catalog DiveDay already ships (`public/marine-life/`), none of them used
 * twice. The reef frames stay with the places they were taken: the cover, the
 * photo strip and the dive sites.
 *
 * Keyed by the template a course was copied from, so it reaches every course
 * the catalog seeds and nothing else. No new image files: every slug here is
 * already in the catalog, which `seed-course-photos.test.ts` checks on disk.
 */
export const DEMO_COURSE_PHOTOS: Readonly<Record<string, string>> = {
  "discover-scuba-diving": "blue-tang",
  "open-water-diver": "green-sea-turtle",
  "advanced-open-water-diver": "spotted-eagle-ray",
  "rescue-diver": "bottlenose-dolphin",
  "scuba-refresher": "sergeant-major",
  "enriched-air-nitrox-diver": "great-barracuda",
  "peak-performance-buoyancy": "queen-angelfish",
  "night-diver": "caribbean-reef-octopus",
  "deep-diver": "goliath-grouper",
  "wreck-diver": "glassy-sweeper",
  "underwater-navigator": "trumpetfish",
  "digital-underwater-photographer": "longsnout-seahorse",
  "drift-diver": "horse-eye-jack",
  "boat-diver": "atlantic-spadefish",
  "search-and-recovery-diver": "queen-conch",
  "sidemount-diver": "tarpon",
  "fish-identification": "french-angelfish",
  divemaster: "hawksbill-turtle",
  "dry-suit-diver": "moon-jelly",
  "emergency-oxygen-provider": "southern-stingray",
  "equipment-specialist": "spiny-lobster",
  "underwater-naturalist": "elkhorn-coral",
  "ssi-try-scuba": "yellowtail-snapper",
  "ssi-open-water-diver": "loggerhead-turtle",
  "ssi-advanced-adventurer": "caribbean-reef-shark",
  "ssi-diver-stress-and-rescue": "nassau-grouper",
  "ssi-scuba-skills-update": "bluehead-wrasse",
  "ssi-perfect-buoyancy": "common-sea-fan",
  "ssi-deep-diving": "black-grouper",
  "ssi-navigation": "bar-jack",
  "ssi-photo-and-video": "flamingo-tongue",
  "ssi-marine-ecology": "giant-barrel-sponge",
  "ssi-react-right": "cobia",
  "ssi-dive-guide": "midnight-parrotfish",
  "sdi-scuba-discovery": "porkfish",
  "sdi-open-water-scuba-diver": "hogfish",
  "sdi-advanced-adventure-diver": "permit-fish",
  "sdi-rescue-diver": "lemon-shark",
  "sdi-divemaster": "whale-shark",
  "sdi-solo-diver": "peacock-flounder",
  "sdi-computer-nitrox-diver": "mutton-snapper",
  "sdi-deep-diver": "red-grouper",
  "sdi-underwater-navigation": "queen-triggerfish",
  "sdi-night-limited-visibility-diver": "caribbean-reef-squid",
  "sdi-wreck-diver": "blackbar-soldierfish",
  "sdi-drift-diver": "creole-wrasse",
  "sdi-boat-diver": "ocean-triggerfish",
  "sdi-search-and-recovery-diver": "slipper-lobster",
  "sdi-underwater-photography": "spotted-scorpionfish",
  "sdi-dry-suit-diver": "upside-down-jellyfish",
  "sdi-equipment-specialist": "giant-basket-star",
  "sdi-sidemount-diver": "cubera-snapper",
  "sdi-marine-ecosystems-awareness": "staghorn-coral",
  "sdi-inactive-diver-scuba-refresher": "stoplight-parrotfish",
};

/** "green-sea-turtle" → "Green sea turtle": the shop's own alt text. */
function photoAlt(species: string): string {
  const words = species.replaceAll("-", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function seedCoursePhotos(db: DbExecutor, shopId: string): Promise<void> {
  for (const [templateSlug, species] of Object.entries(DEMO_COURSE_PHOTOS)) {
    await db
      .update(courses)
      .set({ heroImageUrl: marineLifeImage(species), heroImageAlt: photoAlt(species) })
      .where(and(eq(courses.shopId, shopId), eq(courses.sourceTemplateSlug, templateSlug)));
  }
}
