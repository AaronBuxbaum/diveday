import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES, diverTranslator } from "@/i18n/messages";
import { DIVER_LOCALES } from "@/i18n/settings";
import { MARINE_LIFE_CATALOG, MARINE_LIFE_KINDS, marineLifeImage } from "./marine-life-catalog";

/**
 * The catalog and the bundles are two halves of one record and have to stay
 * that way (ADR 20260813-marine-life-is-diveday-copy).
 *
 * One half is already proven by the compiler: `MarineLifeSlug` is derived from
 * this array, `marine-life-labels.ts` builds `marineLife.species.${slug}.name`
 * from it, and next-intl types every key against the English bundle — so a
 * species added here with no copy does not typecheck. What that cannot see is
 * the other three directions, which is what this file is for: copy with no
 * species (dead strings nobody will ever delete), a Spanish key that fell back
 * to English, and a slug with no photo on disk.
 */

const bundles = Object.fromEntries(
  DIVER_LOCALES.map((locale) => [locale, DIVER_MESSAGES[locale].marineLife]),
);

describe("the marine-life catalog", () => {
  it("carries every species exactly once", () => {
    const slugs = MARINE_LIFE_CATALOG.map((species) => species.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    // Guards the guard: a catalog that had emptied out would pass everything
    // below by vacuous truth.
    expect(slugs.length).toBeGreaterThan(80);
  });

  it("has a bundled photo on disk for every species", () => {
    // Not hot-linked, for the reason every image in this app is bundled
    // (CR-020). A missing file renders an empty tile on a diver's briefing and
    // nothing else notices.
    const missing = MARINE_LIFE_CATALOG.filter(
      (species) => !existsSync(path.join(process.cwd(), "public", marineLifeImage(species.slug))),
    ).map((species) => species.slug);
    expect(missing).toEqual([]);
  });

  it("uses only category codes the bundles name", () => {
    const declared = new Set<string>(MARINE_LIFE_KINDS);
    expect(MARINE_LIFE_CATALOG.filter((species) => !declared.has(species.kind))).toEqual([]);
  });

  for (const locale of DIVER_LOCALES) {
    describe(locale, () => {
      it("writes all three strings for every species, in this language", () => {
        const t = diverTranslator(locale);
        const thin = MARINE_LIFE_CATALOG.filter((species) => {
          const name = t(`marineLife.species.${species.slug}.name`);
          const description = t(`marineLife.species.${species.slug}.description`);
          const tip = t(`marineLife.species.${species.slug}.tip`);
          // A missing key falls back to English and then to the key itself, so
          // "reads as its own key" is the shape a hole actually takes here.
          return [name, description, tip].some(
            (value) => value.trim().length < 3 || value.includes("marineLife."),
          );
        }).map((species) => species.slug);
        expect(thin).toEqual([]);
      });

      it("names every category", () => {
        const t = diverTranslator(locale);
        const thin = MARINE_LIFE_KINDS.filter((kind) => {
          const label = t(`marineLife.kinds.${kind}`);
          return label.trim().length < 3 || label.includes("marineLife.");
        });
        expect(thin).toEqual([]);
      });

      it("holds no copy for a species the catalog dropped", () => {
        // The direction the compiler cannot see. Removing a species leaves 3
        // strings per locale behind that nothing renders and nobody will think
        // to delete, and `pnpm check:locale` is happy either way because both
        // locales are equally wrong.
        const slugs = new Set<string>(MARINE_LIFE_CATALOG.map((species) => species.slug));
        const orphans = Object.keys(bundles[locale].species).filter((slug) => !slugs.has(slug));
        expect(orphans).toEqual([]);
      });

      it("holds no label for a category nothing uses", () => {
        const used = new Set<string>(MARINE_LIFE_CATALOG.map((species) => species.kind));
        const orphans = Object.keys(bundles[locale].kinds).filter((kind) => !used.has(kind));
        expect(orphans).toEqual([]);
      });
    });
  }

  it("says something different in each language", () => {
    // Catches the failure this whole change exists to prevent: a Spanish
    // bundle that is a copy of the English one, which passes every coverage
    // check there is and renders English at a Spanish-speaking diver.
    const en = diverTranslator("en-US");
    const es = diverTranslator("es-ES");
    const untranslated = MARINE_LIFE_CATALOG.filter(
      (species) =>
        en(`marineLife.species.${species.slug}.description`) ===
        es(`marineLife.species.${species.slug}.description`),
    ).map((species) => species.slug);
    expect(untranslated).toEqual([]);
  });
});
