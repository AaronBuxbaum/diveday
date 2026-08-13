import {
  MARINE_LIFE_BY_SLUG,
  MARINE_LIFE_CATALOG,
  type MarineLifeKind,
  type MarineLifeSlug,
  marineLifeImage,
} from "@/db/marine-life-catalog";
import type { DiverTranslator } from "./messages";

/**
 * The words for a catalog species, in the reader's own language.
 *
 * A dive site's field guide stores *which* species it shows and in what order
 * (`dive_site_creatures`, one row per slug). Everything a person reads off that
 * row is resolved here, at render, from `marineLife.*` in the diver bundle — so
 * one saved briefing reads in English to one diver and in Spanish to the next,
 * and a shop that never opens the editor still has a field guide in the
 * language of the person looking at it (ADR
 * 20260813-marine-life-is-diveday-copy).
 *
 * That is the reverse of `dive-site-templates.ts` and `course-templates.ts`,
 * whose words are copied onto a shop's row at pick time and owned by the shop
 * from then on. The line between them is authorship: a dive plan for Molasses
 * Reef is the shop's to write, and what a stoplight parrotfish looks like is
 * the same sentence for every shop in the Caribbean.
 *
 * The **diver** translator, even on staff surfaces. The picker on the dive-site
 * form is showing a staffer the card a diver will see, so showing it in
 * different words than the briefing would be the bug, not the feature. Staff
 * pages build one from the same `requestLocale()` they already resolve.
 */
export type MarineLifeCard = {
  slug: MarineLifeSlug;
  /** The species' common name in the reader's language. */
  name: string;
  /** The Latin binomial, identical in every language and not from a bundle. */
  scientificName: string;
  /** The category word printed over the name, translated. */
  kind: string;
  description: string;
  /** How to actually see one — the lines the briefing's "slow down" aside collects. */
  preparationTip: string;
  imageUrl: string;
};

/** The category word over a species' name (`Reef fish`, `Pez de arrecife`). */
export function marineLifeKindLabel(kind: MarineLifeKind, t: DiverTranslator): string {
  return t(`marineLife.kinds.${kind}`);
}

/**
 * One species, fully resolved.
 *
 * Takes a slug already narrowed by `isMarineLifeSlug`, which is what lets the
 * three keys below be type-checked against the bundle rather than cast. A slug
 * the catalog no longer carries has no card and no words, and every caller
 * drops it rather than rendering a nameless tile.
 */
export function marineLifeCard(slug: MarineLifeSlug, t: DiverTranslator): MarineLifeCard {
  const species = MARINE_LIFE_BY_SLUG.get(slug);
  return {
    slug,
    name: t(`marineLife.species.${slug}.name`),
    // Non-null because `MarineLifeSlug` is derived from this very map's source
    // array — the two cannot disagree.
    scientificName: species?.scientificName ?? "",
    kind: marineLifeKindLabel(species?.kind ?? "reefFish", t),
    description: t(`marineLife.species.${slug}.description`),
    preparationTip: t(`marineLife.species.${slug}.tip`),
    imageUrl: marineLifeImage(slug),
  };
}

/**
 * The whole catalog, resolved, in the order the picker offers it.
 *
 * 93 short records is the entire payload the dive-site form's `<datalist>`
 * needs, which is why it ships whole rather than searching over the network per
 * keystroke on a configure-once form.
 */
export function marineLifeCatalogCards(t: DiverTranslator): MarineLifeCard[] {
  return MARINE_LIFE_CATALOG.map((species) => marineLifeCard(species.slug, t));
}

/**
 * A site's stored field guide, resolved in its saved order.
 *
 * Rows are read straight out of `dive_site_creatures`, so this takes the
 * nullable `catalogSlug` the column actually holds. A row naming a species the
 * catalog has dropped is skipped: an older release could have written it, and
 * one card fewer is a better briefing than one card of nothing.
 */
export function fieldGuideCards(
  rows: readonly { id: string; catalogSlug: string | null }[],
  t: DiverTranslator,
): (MarineLifeCard & { id: string })[] {
  return rows.flatMap((row) => {
    const slug = row.catalogSlug;
    if (!slug || !MARINE_LIFE_BY_SLUG.has(slug as MarineLifeSlug)) return [];
    return [{ id: row.id, ...marineLifeCard(slug as MarineLifeSlug, t) }];
  });
}
