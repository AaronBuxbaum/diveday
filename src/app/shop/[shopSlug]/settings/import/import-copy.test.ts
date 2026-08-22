import { describe, expect, it } from "vitest";
import { fill, pluralForm } from "@/i18n/fill";
import { DIVER_LOCALES } from "@/i18n/settings";
import { STAFF_MESSAGES } from "@/i18n/staff-messages";
import { cachedListFormat } from "@/lib/intl-cache";

/**
 * The eleven sentences the CSV import wizard composes on the client, rendered
 * from the **real bundles** at a singular and a plural count, in every locale.
 *
 * These were reported (issue #649) as printing ICU source to a shop mid-import.
 * They were not: `ImportWizard.tsx` shadowed the shared `fill()` with a
 * hand-rolled ICU-subset parser of its own that resolved plurals correctly. The
 * defect underneath the report was the second implementation, not a leak — and
 * that one is real, because its `count === 1` is not `Intl.PluralRules` and
 * would take the wrong branch the day a locale with more plural categories is
 * added.
 *
 * So the parser is gone, the messages are `…One`/`…Other` pairs the shared
 * `fill()` can resolve, and this is the test that would have answered the
 * question without anyone having to read two files: it renders what a shop
 * actually sees.
 */
const SPLIT_KEYS = [
  "issues.specialtyImportedVerified",
  "issues.specialtyImportedPending",
  "wizard.waiverRowsNotice",
  "wizard.visitRowsNotice",
  "wizard.paymentHistoryRowsNotice",
  "wizard.submit",
  "wizard.result.waiversLine",
  "wizard.result.visitsLine",
  "wizard.result.paymentHistoryLine",
  "wizard.result.notesLine",
] as const;

/** The three fragments `wizard.result.cardsLine` joins. */
const CARD_FRAGMENTS = ["cardsCertifications", "cardsSpecialty", "cardsNitrox"] as const;

function importMessage(locale: (typeof DIVER_LOCALES)[number], dotted: string): string {
  let node: unknown = (STAFF_MESSAGES[locale] as { settings: { import: Record<string, unknown> } })
    .settings.import;
  for (const part of dotted.split(".")) {
    node = (node as Record<string, unknown>)[part];
    expect(node, `${locale}: settings.import.${dotted} is missing`).toBeDefined();
  }
  return String(node);
}

describe("the import wizard's client-composed copy", () => {
  for (const locale of DIVER_LOCALES) {
    for (const count of [1, 3]) {
      it(`resolves every counted sentence in ${locale} at ${count}`, () => {
        for (const key of SPLIT_KEYS) {
          const rendered = fill(
            pluralForm(count, {
              one: importMessage(locale, `${key}One`),
              other: importMessage(locale, `${key}Other`),
            }),
            { count },
          );
          // The whole failure this is about: an unresolved template reaching a
          // shop's screen. Nothing may survive with a brace in it.
          expect(rendered, `${locale} ${key} at ${count}`).not.toContain("{");
          expect(rendered.length, `${locale} ${key} at ${count}`).toBeGreaterThan(0);
        }
      });

      it(`resolves the three-count cards line in ${locale} at ${count}`, () => {
        // The one that could not be a single One/Other pair: three independent
        // plurals in one sentence. Three separately-pluralized fragments joined
        // by `Intl.ListFormat`, which also fixes the English — three counts
        // crammed into one clause read badly at every value.
        const fragments = CARD_FRAGMENTS.map((fragment) =>
          fill(
            pluralForm(count, {
              one: importMessage(locale, `wizard.result.${fragment}One`),
              other: importMessage(locale, `wizard.result.${fragment}Other`),
            }),
            { count },
          ),
        );
        const rendered = fill(importMessage(locale, "wizard.result.cardsLine"), {
          cards: cachedListFormat(locale, { style: "long", type: "conjunction" }).format(fragments),
        });
        expect(rendered, `${locale} cardsLine at ${count}`).not.toContain("{");
        // The list really was joined, not silently collapsed to one fragment.
        for (const fragment of fragments) {
          expect(rendered).toContain(fragment);
        }
      });
    }
  }

  it("mixes counts in the cards line rather than forcing them to agree", () => {
    // The shape the old single-pair fix could not express, and the reason this
    // one is three fragments: 1 certification, 2 specialties, 0 nitrox is an
    // ordinary import result.
    const counts = { cardsCertifications: 1, cardsSpecialty: 2, cardsNitrox: 0 };
    const fragments = CARD_FRAGMENTS.map((fragment) =>
      fill(
        pluralForm(counts[fragment], {
          one: importMessage("en-US", `wizard.result.${fragment}One`),
          other: importMessage("en-US", `wizard.result.${fragment}Other`),
        }),
        { count: counts[fragment] },
      ),
    );
    expect(fragments).toEqual([
      "1 certification",
      "2 specialty certifications",
      "0 nitrox certifications",
    ]);
  });
});
