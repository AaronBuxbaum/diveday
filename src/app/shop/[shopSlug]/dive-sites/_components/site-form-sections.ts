import type { EditorSectionRef, EditorUnsavedCopy } from "@/components/editor/EditorSection";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * **The dive-site briefing, as ten named sections** — ADR
 * 20260827-the-shops-shelves, the long-form editor pattern.
 *
 * The form was fourteen unlabelled blocks with four bordered fieldsets among
 * them, at two radii, and no way to know where you were in ~4,000px of it.
 * This list is the one place that changes: the rail reads it, `SiteFields`
 * renders one `EditorSection` per entry, and the unsaved-changes sentence names
 * a section out of it. Nothing may be in the form that is not in here — the
 * `Record<SiteFormSection, ReactNode>` `SiteFields` builds is what makes a
 * missing section a compile error rather than a section unreachable from the
 * rail.
 *
 * Ids are the `#anchor` the rail links to and the DOM subtree the unsaved note
 * maps a control back to. They are prefixed rather than bare because this page
 * already spends the obvious names on its controls (`site-photos` is the
 * multi-file input), and a duplicate id is an accessibility failure; since the
 * suite's axe scan was removed on 2026-10-24, the test beside this file is the
 * only net.
 */
export const SITE_FORM_SECTION_IDS = {
  about: "briefing-about",
  forecast: "briefing-forecast",
  route: "briefing-route",
  photos: "briefing-photos",
  underwater: "briefing-underwater",
  dive: "briefing-dive",
  planning: "briefing-planning",
  fit: "briefing-fit",
  landmarks: "briefing-landmarks",
  fieldGuide: "briefing-field-guide",
  certification: "briefing-certification",
} as const;

export type SiteFormSection = keyof typeof SITE_FORM_SECTION_IDS;

/**
 * Page order — the rail's order, the form's order, and the order the unsaved
 * sentence counts in are one list.
 */
export const SITE_FORM_SECTION_ORDER = [
  "about",
  "forecast",
  "route",
  "photos",
  "underwater",
  "dive",
  "planning",
  "fit",
  "landmarks",
  "fieldGuide",
  "certification",
] as const satisfies readonly SiteFormSection[];

/**
 * Each section's name, in the staffer's language.
 *
 * Seven of the ten reuse the legend the bordered fieldset they replaced already
 * carried — the words did not become wrong when the box around them went — and
 * three name a run of fields that had never been grouped at all.
 */
export function siteFormSectionLabels(t: StaffTranslator): Record<SiteFormSection, string> {
  return {
    about: t("diveSites.form.sections.about"),
    forecast: t("diveSites.form.forecastLegend"),
    route: t("diveSites.form.route.legend"),
    photos: t("diveSites.form.photosLegend"),
    underwater: t("diveSites.form.sections.underwater"),
    dive: t("diveSites.form.sections.dive"),
    planning: t("diveSites.form.sections.planning"),
    fit: t("diveSites.form.fitLegend"),
    landmarks: t("diveSites.form.landmarks.legend"),
    fieldGuide: t("diveSites.form.fieldGuide.legend"),
    certification: t("diveSites.form.certificationLegend"),
  };
}

/**
 * The sections a shop's form draws, in page order: every one, less the field
 * guide while its Features switch is off.
 */
export function siteFormSectionOrder(fieldGuideOn = true): readonly SiteFormSection[] {
  return fieldGuideOn
    ? SITE_FORM_SECTION_ORDER
    : SITE_FORM_SECTION_ORDER.filter((section) => section !== "fieldGuide");
}

/** The rail's entries, in page order. */
export function siteFormSections(t: StaffTranslator, fieldGuideOn = true): EditorSectionRef[] {
  const labels = siteFormSectionLabels(t);
  return siteFormSectionOrder(fieldGuideOn).map((section) => ({
    id: SITE_FORM_SECTION_IDS[section],
    label: labels[section],
  }));
}

/**
 * The unsaved-changes sentences, one per outcome.
 *
 * Resolved here rather than in the component for the reason
 * `route-editor-copy.ts` states beside it: which sections are dirty is client
 * state, staff copy is server-side only, and a `{count}` interpolated in a
 * Client Component is a plural a translator can never reach (AGENTS.md).
 */
export function siteFormUnsavedCopy(t: StaffTranslator, fieldGuideOn = true): EditorUnsavedCopy {
  const labels = siteFormSectionLabels(t);
  const order = siteFormSectionOrder(fieldGuideOn);
  return {
    inSection: order.map((section) =>
      t("diveSites.form.unsavedInSection", { section: labels[section] }),
    ),
    // Index is the count, so index 0 and 1 are never read — the one-section
    // sentence names the section instead of counting it.
    inSections: Array.from({ length: order.length + 1 }, (_unused, count) =>
      t("diveSites.form.unsavedInSections", { count }),
    ),
  };
}
