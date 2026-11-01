import type { EditorSectionRef, EditorUnsavedCopy } from "@/components/editor/EditorSection";
import type { StaffTranslator } from "@/i18n/staff-messages";

/**
 * Section order and ids drive `SiteFields`, anchors, refusal reopening, and the
 * unsaved note (ADR 20260827-the-shops-shelves; visual review 2026-10-24, A11).
 * Keep ids prefixed to avoid collisions with form controls such as `site-photos`.
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

/** Page and unsaved-note order; open sections lead, then disclosures. */
export const SITE_FORM_SECTION_ORDER = [
  "about",
  "dive",
  "certification",
  "forecast",
  "route",
  "photos",
  "underwater",
  "planning",
  "fit",
  "landmarks",
  "fieldGuide",
] as const satisfies readonly SiteFormSection[];

/** Sections opened by default after visual review (2026-10-24, A11). */
export const SITE_FORM_OPEN_SECTIONS: ReadonlySet<SiteFormSection> = new Set([
  "about",
  "dive",
  "certification",
]);

/** The disclosure the briefing's Spanish sits in, on the edit form only. */
export const SITE_FORM_SPANISH_ID = "briefing-spanish";

/**
 * The closed section a refusal is about, so the form opens it beside the
 * refusal rather than leaving the field to fix behind a shut disclosure.
 */
export const SITE_FORM_REFUSAL_SECTION: Partial<Record<string, string>> = {
  coordinatesIncomplete: SITE_FORM_SECTION_IDS.forecast,
  tideStationInvalid: SITE_FORM_SECTION_IDS.forecast,
  images: SITE_FORM_SECTION_IDS.photos,
  imagesUnconfigured: SITE_FORM_SECTION_IDS.photos,
  planningNoteTooLong: SITE_FORM_SECTION_IDS.planning,
  spanishStale: SITE_FORM_SPANISH_ID,
  spanishRefused: SITE_FORM_SPANISH_ID,
};

/** Each section's staff-facing label, reused for the form and unsaved note. */
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

/** The sections' entries, in page order, for the unsaved-changes sentence. */
export function siteFormSections(t: StaffTranslator, fieldGuideOn = true): EditorSectionRef[] {
  const labels = siteFormSectionLabels(t);
  return siteFormSectionOrder(fieldGuideOn).map((section) => ({
    id: SITE_FORM_SECTION_IDS[section],
    label: labels[section],
  }));
}

/** Resolve unsaved-change copy here so client state never interpolates staff copy. */
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
