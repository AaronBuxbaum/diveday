import type { listSiteFieldGuides } from "@/db/dive-sites";
import { fieldGuideCards, marineLifeCatalogCards } from "@/i18n/marine-life-labels";
import { diverTranslator } from "@/i18n/messages";

/**
 * The species the crew can name on this page: DiveDay's whole catalog, and
 * each live site's own field guide, as `{ slug, name }` in the reader's
 * language — read by the dive log's "one thing you saw" picker and the
 * sightings group alike.
 */
export function manifestSpecies(
  locale: string,
  fieldGuides: Awaited<ReturnType<typeof listSiteFieldGuides>>,
) {
  // The **diver** translator, on a staff page, deliberately: these are the
  // same words the diver will read on their record, and showing a divemaster
  // a different name for the fish they are about to record would be the bug
  // (`marine-life-labels.ts`, ADR 20260813-marine-life-is-diveday-copy).
  const diverT = diverTranslator(locale);
  const catalogSpecies = marineLifeCatalogCards(diverT).map((card) => ({
    slug: card.slug,
    name: card.name,
  }));
  const speciesBySite = Object.fromEntries(
    [...fieldGuides].map(([siteId, rows]) => [
      siteId,
      fieldGuideCards(rows, diverT).map((card) => ({
        slug: card.slug,
        name: card.name,
      })),
    ]),
  );
  return { catalogSpecies, speciesBySite };
}

/** One species the crew can name, in the reader's language. */
export type ManifestSpecies = ReturnType<typeof manifestSpecies>["catalogSpecies"][number];
