import type { Certification, SpecialtyCertification } from "@/db/schema";
import { ageOnDate } from "./age";
import type { CalendarDate } from "./calendar-date";
import { type DepthUnit, depthInUnit } from "./depth-units";
import {
  type CertificationLevel,
  certificationRank,
  validVerifiedCertification,
} from "./readiness";

/**
 * A published depth limit, as the agencies actually state it: a **pair**, not a
 * conversion. PADI and SSI print 18 m/60 ft, 30 m/100 ft, 40 m/130 ft — the two
 * numbers are both the standard, and neither is derived from the other.
 *
 * Storing only the metric number and converting on demand produced a false
 * warning on the single most common recreational dive in the launch
 * jurisdiction: a Florida shop typing the textbook `60` ft stores 18.288 m,
 * which is greater than a hard-coded 18, so every Open Water diver on every
 * 60 ft reef was told they were over their limit — by a warning that cited a
 * ceiling of "59 ft", a number that appears in no dive manual anywhere.
 */
export type DepthCeiling = { meters: number; feet: number };

function ceilingIn(ceiling: DepthCeiling, unit: DepthUnit): number {
  return unit === "feet" ? ceiling.feet : ceiling.meters;
}

/**
 * How deep each certification level is trained to go. Open Water and Advanced
 * Open Water are sourced in
 * [20260724-course-admission-standards](../../docs/architecture/decisions/20260724-course-admission-standards.md).
 *
 * Rescue, Divemaster and Instructor are **DiveDay's own reading**, not rows in
 * that ADR: Rescue is a skills course with no depth component, so it inherits
 * AOW's ceiling rather than extending it, and the two professional ratings are
 * held to the 40 m/130 ft recreational limit.
 */
const LEVEL_DEPTH_LIMIT: Record<CertificationLevel, DepthCeiling> = {
  open_water: { meters: 18, feet: 60 },
  advanced_open_water: { meters: 30, feet: 100 },
  rescue: { meters: 30, feet: 100 },
  divemaster: { meters: 40, feet: 130 },
  instructor: { meters: 40, feet: 130 },
};

/** The recreational floor. A Deep specialty lifts a diver to it, not past it. */
const RECREATIONAL_LIMIT: DepthCeiling = { meters: 40, feet: 130 };

/**
 * The entry-level ceiling applied when a diver has no card at all on a trip
 * that does not gate on certification — a Discover Scuba Diving session, or an
 * "all levels" charter. Sourced as the DSD open-water maximum in the standards
 * ADR and the glossary.
 */
const NO_CARD_LIMIT: DepthCeiling = { meters: 12, feet: 40 };

/**
 * Junior certifications carry an age-linked ceiling that is *stricter* than the
 * card's own level, and it lifts on the diver's 15th birthday rather than on
 * any new card. Ages 10–11 are capped at 12 m/40 ft whatever they hold; 12–14
 * reach 18 m/60 ft, or 21 m/70 ft on a Junior Advanced Open Water card.
 *
 * Modeled on age rather than a `junior_*` enum member because that is how the
 * restriction actually works — the same plastic card means different depths on
 * either side of a birthday, and DiveDay stores one `certification_level`
 * ladder with no junior variants (src/db/schema.ts).
 *
 * **Depth is only half the junior rule.** The standards also require
 * supervision (10–11 with a professional or certified guardian; 12–14 with any
 * certified adult), which DiveDay does not model — see the ADR's Consequences.
 */
const JUNIOR_AGE_CEILING = 14;
const JUNIOR_YOUNGEST_LIMIT: DepthCeiling = { meters: 12, feet: 40 };
const JUNIOR_OPEN_WATER_LIMIT: DepthCeiling = { meters: 18, feet: 60 };
const JUNIOR_ADVANCED_LIMIT: DepthCeiling = { meters: 21, feet: 70 };

/** Why a diver's ceiling is what it is — the UI needs to say which rule bit. */
export type DepthLimitBasis = "certification" | "junior_age" | "deep_specialty" | "no_card";

export type DepthLimit = {
  ceiling: DepthCeiling;
  basis: DepthLimitBasis;
  /** The level the limit was read off; null when the diver holds no card. */
  level: CertificationLevel | null;
};

/**
 * The deepest a diver may go, given the best card they actually hold and — when
 * a date of birth is on file — the junior band they fall in.
 *
 * With **no verified card** this returns the entry-level DSD ceiling rather
 * than null. The earlier "say nothing" version inverted the risk gradient: a
 * trip with no `minimum_certification_level` (a DSD session, an all-levels
 * charter) raises no `certification_missing` blocker either, so the diver with
 * the least training was the one surface DiveDay stayed completely silent
 * about. The caller suppresses this case when a certification blocker *is*
 * already present, so the warning never doubles up.
 */
export function diverDepthLimit(
  certifications: readonly Certification[],
  specialtyCertifications: readonly SpecialtyCertification[],
  todayLocal: CalendarDate,
  dateOfBirth?: CalendarDate | null,
  onDate?: CalendarDate | null,
): DepthLimit {
  const verified = certifications.filter((certification) =>
    validVerifiedCertification(certification, todayLocal),
  );
  const level =
    verified.length === 0
      ? null
      : verified.reduce<CertificationLevel>(
          (best, certification) =>
            certificationRank(certification.level) > certificationRank(best)
              ? certification.level
              : best,
          verified[0].level,
        );

  // The junior band, when it applies, is always the stricter answer — a
  // 12-year-old with an AOW card is held to 21 m, not AOW's 30 m — so it wins
  // outright rather than being min()'d against a Deep specialty they could not
  // hold at that age anyway.
  //
  // Applied with no lower age bound on purpose. An age below the junior floor
  // of 10 is a typo or a bad import, not a licence, so it falls to the
  // strictest band rather than through to the adult ladder — the conservative
  // direction on a data-quality problem.
  const age = dateOfBirth && onDate ? ageOnDate(dateOfBirth, onDate) : null;
  if (age !== null && age <= JUNIOR_AGE_CEILING) {
    if (age < 12) return { ceiling: JUNIOR_YOUNGEST_LIMIT, basis: "junior_age", level };
    return {
      ceiling:
        level && certificationRank(level) >= certificationRank("advanced_open_water")
          ? JUNIOR_ADVANCED_LIMIT
          : JUNIOR_OPEN_WATER_LIMIT,
      basis: "junior_age",
      level,
    };
  }

  if (!level) return { ceiling: NO_CARD_LIMIT, basis: "no_card", level: null };

  // A Deep specialty is exactly the training that lifts an Open Water diver past
  // 18 m, so it raises the ceiling to the recreational limit — but it can only
  // ever raise, never lower an already-deeper level. Held to the *same*
  // predicate as the specialty readiness gate (src/lib/readiness.ts): a card the
  // shop has marked stale must not silently keep buying depth here that it no
  // longer buys there.
  const hasDeep = specialtyCertifications.some(
    (card) =>
      card.specialty === "deep" &&
      card.status === "verified" &&
      (!card.expiresAt || card.expiresAt >= todayLocal) &&
      (!card.importedAt || card.reviewedAt),
  );
  const levelLimit = LEVEL_DEPTH_LIMIT[level];
  if (hasDeep && levelLimit.meters < RECREATIONAL_LIMIT.meters) {
    return { ceiling: RECREATIONAL_LIMIT, basis: "deep_specialty", level };
  }
  return { ceiling: levelLimit, basis: "certification", level };
}

export type DepthCeilingCheck =
  /** No site depth recorded, or nothing to measure. Say nothing. */
  | { status: "unknown" }
  | { status: "within"; siteDepth: number; limitDepth: number; unit: DepthUnit }
  | {
      status: "exceeds";
      /** Both already converted to the shop's unit and rounded for display. */
      siteDepth: number;
      limitDepth: number;
      unit: DepthUnit;
      basis: DepthLimitBasis;
      level: CertificationLevel | null;
    };

/**
 * Does this site go deeper than this diver's training allows?
 *
 * **A warning, never a gate** (H-08, decided 2026-07-30). The site's maximum is
 * not the dive plan: an instructor may deliberately keep a student at 15 m on a
 * 30 m wall, and that is an ordinary, correct day of diving — refusing the
 * booking would make DiveDay wrong about the thing it was trying to be careful
 * about. So this returns an advisory the roster renders and nothing consumes as
 * a blocker; `calculateReadiness` never sees it.
 *
 * The comparison happens **in the shop's own unit, after rounding**, not in
 * stored metres. A 60 ft site and a 60 ft ceiling are the same depth to a dive
 * professional, and 18.288 > 18 is a floating-point artefact of the storage
 * unit, not a fact about diving.
 */
export function checkDepthCeiling(
  siteMaxDepthMeters: number | null | undefined,
  limit: DepthLimit | null,
  unit: DepthUnit = "meters",
): DepthCeilingCheck {
  if (!siteMaxDepthMeters || !limit) return { status: "unknown" };
  const siteDepth = depthInUnit(siteMaxDepthMeters, unit);
  const limitDepth = ceilingIn(limit.ceiling, unit);
  if (siteDepth <= limitDepth) return { status: "within", siteDepth, limitDepth, unit };
  return {
    status: "exceeds",
    siteDepth,
    limitDepth,
    unit,
    basis: limit.basis,
    level: limit.level,
  };
}
