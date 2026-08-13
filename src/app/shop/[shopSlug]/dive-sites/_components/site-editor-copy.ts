import { MARINE_LIFE_CATALOG, marineLifeImage } from "@/db/marine-life-catalog";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_SITE_CREATURES } from "@/lib/dive-site-field-guide";
import { MAX_SITE_LANDMARKS } from "@/lib/dive-site-landmarks";
import type { FieldGuideCatalogEntry, FieldGuideEditorCopy } from "./FieldGuideEditor";
import type { LandmarkEditorCopy } from "./LandmarkEditor";

/**
 * Words for the two list editors on the dive-site form.
 *
 * Resolved here, on the server, for the same reason `route-editor-copy.ts`
 * exists beside it: both editors are Client Components, staff copy is
 * server-side only, and anything with a `{count}` in it has to be pluralised
 * where the bundle can see it (AGENTS.md).
 */
/**
 * What `{name}` is replaced back to, so the client can substitute the row's own
 * name into an otherwise fully translated sentence. Interpolating the token
 * *out* here and back in there keeps the whole sentence — word order, particles,
 * whatever a language needs around a name — in the bundle, where a translator
 * can move it; the component only ever swaps one placeholder.
 */
// i18n-exempt: a substitution token, not a word anyone reads.
const NAME_TOKEN = "{name}";

export function landmarkEditorCopy(t: StaffTranslator): LandmarkEditorCopy {
  return {
    legend: t("diveSites.form.landmarks.legend"),
    description: t("diveSites.form.landmarks.description"),
    nameLabel: t("diveSites.form.landmarks.nameLabel"),
    namePlaceholder: t("diveSites.form.landmarks.namePlaceholder"),
    kindLabel: t("diveSites.form.landmarks.kindLabel"),
    kindLabels: {
      pointOfInterest: t("diveSites.form.landmarks.kinds.pointOfInterest"),
      navigationMark: t("diveSites.form.landmarks.kinds.navigationMark"),
      reefFormation: t("diveSites.form.landmarks.kinds.reefFormation"),
      reefHistory: t("diveSites.form.landmarks.kinds.reefHistory"),
      wreckFeature: t("diveSites.form.landmarks.kinds.wreckFeature"),
      underwaterMonument: t("diveSites.form.landmarks.kinds.underwaterMonument"),
    },
    noteLabel: t("diveSites.form.landmarks.noteLabel"),
    notePlaceholder: t("diveSites.form.landmarks.notePlaceholder"),
    add: t("diveSites.form.landmarks.add"),
    remove: t("diveSites.form.landmarks.remove"),
    removeAriaLabel: t("diveSites.form.landmarks.removeAriaLabel", { name: NAME_TOKEN }),
    empty: t("diveSites.form.landmarks.empty"),
    full: t("diveSites.form.landmarks.full", { max: MAX_SITE_LANDMARKS }),
  };
}

export function fieldGuideEditorCopy(t: StaffTranslator): FieldGuideEditorCopy {
  return {
    legend: t("diveSites.form.fieldGuide.legend"),
    description: t("diveSites.form.fieldGuide.description"),
    searchLabel: t("diveSites.form.fieldGuide.searchLabel"),
    searchPlaceholder: t("diveSites.form.fieldGuide.searchPlaceholder"),
    add: t("diveSites.form.fieldGuide.add"),
    addBlank: t("diveSites.form.fieldGuide.addBlank"),
    empty: t("diveSites.form.fieldGuide.empty"),
    full: t("diveSites.form.fieldGuide.full", { max: MAX_SITE_CREATURES }),
    notFound: t("diveSites.form.fieldGuide.notFound"),
    nameLabel: t("diveSites.form.fieldGuide.nameLabel"),
    kindLabel: t("diveSites.form.fieldGuide.kindLabel"),
    kindPlaceholder: t("diveSites.form.fieldGuide.kindPlaceholder"),
    descriptionLabel: t("diveSites.form.fieldGuide.descriptionLabel"),
    tipLabel: t("diveSites.form.fieldGuide.tipLabel"),
    tipPlaceholder: t("diveSites.form.fieldGuide.tipPlaceholder"),
    remove: t("diveSites.form.fieldGuide.remove"),
    removeAriaLabel: t("diveSites.form.fieldGuide.removeAriaLabel", { name: NAME_TOKEN }),
    moveUp: t("diveSites.form.fieldGuide.moveUp"),
    moveUpAriaLabel: t("diveSites.form.fieldGuide.moveUpAriaLabel", { name: NAME_TOKEN }),
    moveDown: t("diveSites.form.fieldGuide.moveDown"),
    moveDownAriaLabel: t("diveSites.form.fieldGuide.moveDownAriaLabel", { name: NAME_TOKEN }),
  };
}

/**
 * DiveDay's species catalog, flattened for the picker's `<datalist>`.
 *
 * The whole catalog rides to the browser — 93 short records, well under the
 * weight of one of the photos on this same form — because a `<datalist>` is a
 * real autocomplete only when it holds the options. Searching over the network
 * per keystroke would trade that for a round trip and a spinner on a
 * configure-once form.
 */
export function marineLifeCatalogEntries(): FieldGuideCatalogEntry[] {
  return MARINE_LIFE_CATALOG.map((species) => ({
    slug: species.slug,
    name: species.name,
    scientificName: species.scientificName,
    kind: species.kind,
    description: species.description,
    preparationTip: species.preparationTip,
    imageUrl: marineLifeImage(species.slug),
  }));
}
