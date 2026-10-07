import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { DiveSiteTemplateField } from "@/lib/dive-site-template-sync";

/** The words for each field a template update can change, keyed so a new field fails typecheck. */
export const TEMPLATE_FIELD_KEYS: Record<DiveSiteTemplateField, StaffMessageKey> = {
  description: "diveSites.edit.templateUpdates.fields.description",
  locationName: "diveSites.edit.templateUpdates.fields.locationName",
  forecastLatitude: "diveSites.edit.templateUpdates.fields.coordinates",
  forecastLongitude: "diveSites.edit.templateUpdates.fields.coordinates",
  marineLife: "diveSites.edit.templateUpdates.fields.marineLife",
  marineLifeDescription: "diveSites.edit.templateUpdates.fields.marineLifeDescription",
  difficultyLevel: "diveSites.edit.templateUpdates.fields.difficultyLevel",
  depthRange: "diveSites.edit.templateUpdates.fields.depthRange",
  maxDepthMeters: "diveSites.edit.templateUpdates.fields.maxDepthMeters",
  expectedBottomTimeMinutes: "diveSites.edit.templateUpdates.fields.expectedBottomTimeMinutes",
  currentNote: "diveSites.edit.templateUpdates.fields.currentNote",
  divePlan: "diveSites.edit.templateUpdates.fields.divePlan",
  fitTone: "diveSites.edit.templateUpdates.fields.fitTone",
  fitNote: "diveSites.edit.templateUpdates.fields.fitNote",
  conservationNote: "diveSites.edit.templateUpdates.fields.conservationNote",
  fieldGuideTipsHeading: "diveSites.edit.templateUpdates.fields.fieldGuideTipsHeading",
  landmarks: "diveSites.edit.templateUpdates.fields.landmarks",
  minimumCertificationLevel: "diveSites.edit.templateUpdates.fields.minimumCertificationLevel",
  requiredSpecialties: "diveSites.edit.templateUpdates.fields.requiredSpecialties",
  requiresNitrox: "diveSites.edit.templateUpdates.fields.requiresNitrox",
  creatures: "diveSites.edit.templateUpdates.fields.creatures",
};
