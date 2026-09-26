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
 * multi-file input), and a duplicate id is an accessibility failure
 * `e2e/a11y.spec.ts` fails the build on.
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
 * **Each section's rail entry, as the loading skeleton draws it** before the
 * words arrive (`EditorRailSkeleton`, docs/design/pixel-craft.md class 11: a
 * skeleton has the loaded page's geometry).
 *
 * Below `lg` the rail is a wrap of 44px links, so how many rows it takes, and
 * how far the form under it sits, depends on how wide the words are. Eleven
 * uniform stubs wrapped three to a row at 390, four rows, where these labels
 * wrap 3/3/2/2/1, five, and the form dropped 44px when the editor arrived.
 * Each width here is its en-US label at 14px medium plus the link's `px-3`
 * either side, rounded up to the 4px step, measured on dive-site-new's 390
 * capture: that wraps 2/2/2/2/2/1 at 360, 3/3/2/2/1 at 390, 5/5/1 at 640 and
 * 6/5 at 768, the loaded rail's rows at each. A section whose en-US label
 * changes is re-measured here.
 */
export const SITE_FORM_RAIL_STUB_WIDTHS = {
  about: "w-20", // The site, 77px
  forecast: "w-28", // GPS location, 108px
  route: "w-38", // The route you swim, 152px
  photos: "w-18", // Photos, 71px
  underwater: "w-37", // What's down there, 148px
  dive: "w-20", // The dive, 80px
  planning: "w-31", // Planning notes, 122px
  fit: "w-36", // Who this site suits, 144px
  landmarks: "w-25", // Landmarks, 97px
  fieldGuide: "w-24", // Field guide, 95px
  certification: "w-49", // Certification requirements, 196px
} as const satisfies Record<SiteFormSection, string>;

/** The skeleton's stubs, in page order. */
export const SITE_FORM_RAIL_STUBS: readonly string[] = SITE_FORM_SECTION_ORDER.map(
  (section) => SITE_FORM_RAIL_STUB_WIDTHS[section],
);

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

/** The rail's entries, in page order. */
export function siteFormSections(t: StaffTranslator): EditorSectionRef[] {
  const labels = siteFormSectionLabels(t);
  return SITE_FORM_SECTION_ORDER.map((section) => ({
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
export function siteFormUnsavedCopy(t: StaffTranslator): EditorUnsavedCopy {
  const labels = siteFormSectionLabels(t);
  return {
    inSection: SITE_FORM_SECTION_ORDER.map((section) =>
      t("diveSites.form.unsavedInSection", { section: labels[section] }),
    ),
    // Index is the count, so index 0 and 1 are never read — the one-section
    // sentence names the section instead of counting it.
    inSections: Array.from({ length: SITE_FORM_SECTION_ORDER.length + 1 }, (_unused, count) =>
      t("diveSites.form.unsavedInSections", { count }),
    ),
  };
}
