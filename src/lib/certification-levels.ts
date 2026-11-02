/**
 * **The certification ladder, on its own, importing nothing** (issue #1354).
 *
 * Apart from `./readiness.ts` for a bundle reason: `src/i18n/readiness-labels.ts`
 * needs one value from it (`REQUIRABLE_CERTIFICATION_LEVELS`), and importing
 * `readiness.ts` for that held the waiver and medical copy in the first load of
 * the public diver pages and `/offline-manifest`. Message-bundle copy only, no
 * diver's answers. The same seam shape as `./certification-options.ts` and
 * `./course-limits.ts` (PR #1347).
 *
 * `readiness.ts` re-exports everything here, so no caller changes. **Keep this
 * file free of imports**: a guard in `src/lib/certification-levels.test.ts`
 * fails if it grows one, because this edge has been cut before (issue #718)
 * and grew back.
 */

/**
 * The five-rung certification ladder. Labels for these live in the message
 * bundles (`src/i18n/readiness-labels.ts` maps each code to a translation key),
 * never here: this states facts about ordering and gates, `src/app` chooses
 * words. This ordered tuple is also the runtime source for validators that
 * accept any held or awarded rung.
 */
export const CERTIFICATION_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
] as const;

export type CertificationLevel = (typeof CERTIFICATION_LEVELS)[number];

/**
 * **What a site or a trip may demand of a diver — the top of it is Rescue.**
 *
 * Deliberately a different set from {@link CertificationLevel}, which is what a
 * person can *hold*. Divemaster and Instructor are working ratings: crew hold
 * them, `src/lib/course-ratios.ts` counts them, and an instructor-led session
 * is gated on one being assigned. None of that is a shop telling a paying
 * diver to hold a professional rating to board a charter, which is the only
 * thing this list is for (issue #630).
 *
 * It stops at Rescue because Rescue is the highest *modelled* recreational
 * rung. Master Scuba Diver is not one: MSD is Rescue plus five specialties
 * plus fifty dives, which a linear ladder cannot express, and the import path
 * deliberately files it under `level_not_gated`
 * (ADR 20260725-imported-card-sighting).
 *
 * The `satisfies` is the same guard `DECLARABLE_CERTIFICATION_LEVELS` carries:
 * a rung spelled wrong here is a compile error rather than a requirement
 * nobody can pick.
 */
export const REQUIRABLE_CERTIFICATION_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
] as const satisfies readonly CertificationLevel[];

/** A level a site or trip is allowed to demand — see the list above. */
export type RequirableCertificationLevel = (typeof REQUIRABLE_CERTIFICATION_LEVELS)[number];

const levelRank: Record<CertificationLevel, number> = {
  open_water: 1,
  advanced_open_water: 2,
  rescue: 3,
  divemaster: 4,
  instructor: 5,
};

/** A level's place on the ladder, for ordering rather than comparison. Open Water is 1. */
export function certificationRank(level: CertificationLevel): number {
  return levelRank[level];
}

/** The stricter of two levels; null means "no level demanded" and never wins. */
export function higherCertificationLevel(
  a: CertificationLevel | null | undefined,
  b: CertificationLevel | null | undefined,
): CertificationLevel | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return levelRank[a] >= levelRank[b] ? a : b;
}
