import { isMarineLifeSlug, type MarineLifeSlug } from "@/db/marine-life-catalog";
import type { DiveSpecialty } from "@/db/schema";
import type { DiveSiteDifficulty } from "./dive-site-difficulty";
import { type DiveSiteLandmark, parseDiveSiteLandmarks } from "./dive-site-landmarks";
import type { CertificationLevel } from "./readiness";

/** Fields a template snapshot can compare. Conservation guidance is compared but stays local. */
export const DIVE_SITE_TEMPLATE_SYNC_FIELDS = [
  "description",
  "locationName",
  "forecastLatitude",
  "forecastLongitude",
  "marineLife",
  "marineLifeDescription",
  "difficultyLevel",
  "snorkelSuitable",
  "depthMinMeters",
  "maxDepthMeters",
  "expectedBottomTimeMinutes",
  "currentNote",
  "divePlan",
  "fitTone",
  "fitNote",
  "conservationNote",
  "fieldGuideTipsHeading",
  "landmarks",
  "minimumCertificationLevel",
  "requiredSpecialties",
  "requiresNitrox",
  "creatures",
] as const;

export type DiveSiteTemplateField = (typeof DIVE_SITE_TEMPLATE_SYNC_FIELDS)[number];

export type DiveSiteTemplateSnapshot = {
  description: string | null;
  locationName: string | null;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
  marineLife: string | null;
  marineLifeDescription: string | null;
  difficultyLevel: DiveSiteDifficulty | null;
  snorkelSuitable: boolean | null;
  depthMinMeters: number | null;
  maxDepthMeters: number | null;
  expectedBottomTimeMinutes: number | null;
  currentNote: string | null;
  divePlan: string | null;
  fitTone: "welcoming" | "demanding" | "unknown" | null;
  fitNote: string | null;
  conservationNote: string | null;
  fieldGuideTipsHeading: string | null;
  landmarks: DiveSiteLandmark[];
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
  creatures: MarineLifeSlug[];
};

/** One-time inverse of the most recent template pull, kept on the site row. */
export type DiveSiteTemplateUndo = {
  sourceTemplateVersion: number;
  snapshot: DiveSiteTemplateSnapshot;
};

/** Structural shape accepted from an immutable catalog version. */
export type DiveSiteTemplateSource = {
  description?: string;
  locationName?: string;
  forecastLatitude?: number;
  forecastLongitude?: number;
  marineLife?: string;
  marineLifeDescription?: string;
  difficultyLevel?: DiveSiteDifficulty;
  snorkelSuitable?: boolean;
  depthMinMeters?: number;
  maxDepthMeters?: number;
  expectedBottomTimeMinutes?: number;
  currentNote?: string;
  divePlan?: string;
  fitTone?: "welcoming" | "demanding" | "unknown";
  fitNote?: string;
  conservationNote?: string;
  fieldGuideTipsHeading?: string;
  landmarks?: unknown;
  minimumCertificationLevel?: CertificationLevel;
  requiredSpecialties?: DiveSpecialty[];
  requiresNitrox?: boolean;
  creatureSlugs?: string[];
};

/** Structural shape accepted from a shop-owned site row plus its current guide. */
export type DiveSiteTemplateSiteRecord = {
  description: string | null;
  locationName: string | null;
  forecastLatitude: number | null;
  forecastLongitude: number | null;
  marineLife: string | null;
  marineLifeDescription: string | null;
  difficultyLevel: DiveSiteDifficulty | null;
  snorkelSuitable: boolean | null;
  depthMinMeters: number | null;
  maxDepthMeters: number | null;
  expectedBottomTimeMinutes: number | null;
  currentNote: string | null;
  divePlan: string | null;
  fitTone: "welcoming" | "demanding" | "unknown" | null;
  fitNote: string | null;
  conservationNote: string | null;
  fieldGuideTipsHeading: string | null;
  landmarks: unknown;
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
  creatures: readonly MarineLifeSlug[];
};

export type DiveSiteTemplateDiff = {
  field: DiveSiteTemplateField;
  shopChanged: boolean;
  current: DiveSiteTemplateSnapshot[DiveSiteTemplateField];
  latest: DiveSiteTemplateSnapshot[DiveSiteTemplateField];
};

export type DiveSiteTemplateUpdateMode = "preserve-shop-edits" | "replace-template-copy";

/** Normalize an immutable source version into the comparable shop-row shape. */
export function diveSiteTemplateSnapshot(source: DiveSiteTemplateSource): DiveSiteTemplateSnapshot {
  return {
    description: source.description ?? null,
    locationName: source.locationName ?? null,
    forecastLatitude: source.forecastLatitude ?? null,
    forecastLongitude: source.forecastLongitude ?? null,
    marineLife: source.marineLife ?? null,
    marineLifeDescription: source.marineLifeDescription ?? null,
    difficultyLevel: source.difficultyLevel ?? null,
    snorkelSuitable: source.snorkelSuitable ?? null,
    depthMinMeters: source.depthMinMeters ?? null,
    maxDepthMeters: source.maxDepthMeters ?? null,
    expectedBottomTimeMinutes: source.expectedBottomTimeMinutes ?? null,
    currentNote: source.currentNote ?? null,
    divePlan: source.divePlan ?? null,
    fitTone: source.fitTone ?? null,
    fitNote: source.fitNote ?? null,
    conservationNote: source.conservationNote ?? null,
    fieldGuideTipsHeading: source.fieldGuideTipsHeading ?? null,
    landmarks: parseDiveSiteLandmarks(source.landmarks),
    minimumCertificationLevel: source.minimumCertificationLevel ?? null,
    requiredSpecialties: source.requiredSpecialties ?? [],
    requiresNitrox: source.requiresNitrox ?? false,
    creatures: (source.creatureSlugs ?? []).filter(isMarineLifeSlug),
  };
}

/** Normalize a live shop row into the same shape without importing the DB layer. */
export function diveSiteTemplateSnapshotFromSite(
  site: DiveSiteTemplateSiteRecord,
): DiveSiteTemplateSnapshot {
  return {
    ...site,
    landmarks: parseDiveSiteLandmarks(site.landmarks),
    creatures: [...site.creatures],
  };
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

/** Show fields where the latest published version actually differs. */
export function diveSiteTemplateDiff(
  current: DiveSiteTemplateSnapshot,
  baseline: DiveSiteTemplateSnapshot,
  latest: DiveSiteTemplateSnapshot,
): DiveSiteTemplateDiff[] {
  return DIVE_SITE_TEMPLATE_SYNC_FIELDS.flatMap((field) => {
    const currentValue = current[field];
    const latestValue = latest[field];
    if (sameValue(currentValue, latestValue)) return [];
    return [
      {
        field,
        shopChanged: !sameValue(currentValue, baseline[field]),
        current: currentValue,
        latest: latestValue,
      },
    ];
  });
}

/** Merge a new template version while leaving shop edits intact by default. */
export function mergedDiveSiteTemplateSnapshot(
  current: DiveSiteTemplateSnapshot,
  baseline: DiveSiteTemplateSnapshot,
  latest: DiveSiteTemplateSnapshot,
  mode: DiveSiteTemplateUpdateMode,
): DiveSiteTemplateSnapshot {
  if (mode === "replace-template-copy") {
    return { ...latest, conservationNote: current.conservationNote };
  }
  const merged = Object.fromEntries(
    DIVE_SITE_TEMPLATE_SYNC_FIELDS.map((field) => [
      field,
      sameValue(current[field], baseline[field]) ? latest[field] : current[field],
    ]),
  ) as DiveSiteTemplateSnapshot;
  // Site-specific conservation guidance stays with the shop, even on replacement.
  merged.conservationNote = current.conservationNote;
  // Two ends taken from two authors can cross: a shop's shallow end kept under a
  // deeper point the template has since shortened. The row refuses that pair
  // (`dive_sites_depth_range_ordered`), so the shallow end is dropped, not the update.
  const { depthMinMeters, maxDepthMeters } = merged;
  if (depthMinMeters !== null && (maxDepthMeters === null || depthMinMeters > maxDepthMeters)) {
    merged.depthMinMeters = null;
  }
  return merged;
}
