import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  SITE_FORM_SECTION_IDS,
  SITE_FORM_SECTION_ORDER,
  siteFormSectionLabels,
  siteFormSections,
  siteFormUnsavedCopy,
} from "./site-form-sections";

const LOCALES = ["en-US", "es-ES"] as const;

/**
 * The rule ADR 20260827-the-shops-shelves' long-form editor pattern turns on:
 * the rail names the sections, so the list the rail reads and the list the form
 * renders have to be the same list. `SiteFields` builds a
 * `Record<SiteFormSection, …>`, which is what makes a section with no fields a
 * compile error; this covers the other half — the order, the ids, and the words.
 */
describe("the dive-site briefing's sections", () => {
  it("puts every section in the page order exactly once", () => {
    expect([...SITE_FORM_SECTION_ORDER].sort()).toEqual(Object.keys(SITE_FORM_SECTION_IDS).sort());
  });

  it("gives each section an anchor of its own", () => {
    const ids = Object.values(SITE_FORM_SECTION_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    // A fragment lands in a URL and an id lands in `aria-labelledby`; neither
    // wants escaping.
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z-]*$/);
  });

  /**
   * The ids are prefixed because the form already spends the obvious names on
   * its controls — `site-photos` is the multi-file input, and a duplicate id is
   * an accessibility failure `e2e/a11y.spec.ts` fails the build on.
   */
  it("keeps its anchors clear of the control ids on the same page", () => {
    for (const id of Object.values(SITE_FORM_SECTION_IDS)) {
      expect(id.startsWith("site-")).toBe(false);
    }
  });

  it.each(LOCALES)("words every section in %s", (locale) => {
    const t = staffTranslator(locale);
    const labels = siteFormSectionLabels(t);

    for (const section of SITE_FORM_SECTION_ORDER) {
      expect(labels[section].trim()).not.toBe("");
      // A missing key falls back to the key itself; a rail of dotted paths is
      // the failure this catches.
      expect(labels[section]).not.toContain("diveSites.");
    }
    expect(siteFormSections(t).map((entry) => entry.id)).toEqual(
      SITE_FORM_SECTION_ORDER.map((section) => SITE_FORM_SECTION_IDS[section]),
    );
  });

  it.each(LOCALES)("names the section that is unsaved, and counts the rest, in %s", (locale) => {
    const t = staffTranslator(locale);
    const labels = siteFormSectionLabels(t);
    const copy = siteFormUnsavedCopy(t);

    SITE_FORM_SECTION_ORDER.forEach((section, index) => {
      expect(copy.inSection[index]).toContain(labels[section]);
    });
    // Indexed by count, so two dirty sections reads its own sentence rather
    // than one section's name and a guess.
    expect(copy.inSections).toHaveLength(SITE_FORM_SECTION_ORDER.length + 1);
    expect(copy.inSections[2]).toContain("2");
    expect(copy.inSections[2]).not.toContain(labels.about);
  });
});
