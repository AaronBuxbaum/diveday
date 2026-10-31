import type { Certification, SpecialtyCertification } from "@/db/schema";
import { ADULT_AGE, ageOnDate, JUNIOR_AGE_END, JUNIOR_YOUNGEST_BAND_END } from "./age";
import type { CalendarDate } from "./calendar-date";
import { type DepthUnit, depthInUnit } from "./depth-units";
import {
  type CertificationLevel,
  certificationRank,
  holdsSpecialtyCard,
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
 * These conservative age bands use the published PADI junior limits. Other
 * agencies can have different limits, upgrade rules and supervision conditions;
 * staff must verify those facts. A confirmed NAUI junior card also carries its
 * 18 m limit beyond age 15 until upgraded. See the junior-card evidence ADR.
 */
const JUNIOR_AGE_CEILING = JUNIOR_AGE_END - 1;
const JUNIOR_YOUNGEST_LIMIT: DepthCeiling = { meters: 12, feet: 40 };
const JUNIOR_OPEN_WATER_LIMIT: DepthCeiling = { meters: 18, feet: 60 };
const JUNIOR_ADVANCED_LIMIT: DepthCeiling = { meters: 21, feet: 70 };

/** Why a diver's ceiling is what it is — the UI needs to say which rule bit. */
export type DepthLimitBasis =
  | "certification"
  | "junior_age"
  | "junior_card"
  | "deep_specialty"
  | "no_card";

export type JuniorVerificationReason = "card_status" | "junior_limits";

export type DepthLimit = {
  ceiling: DepthCeiling;
  basis: DepthLimitBasis;
  /** The level the limit was read off; null when the diver holds no card. */
  level: CertificationLevel | null;
  /** Card status, training depth or a supervision condition needs staff verification. */
  verificationReasons?: JuniorVerificationReason[];
};

/** Under 15 on `onDate`; age does not establish what the card says. */
export function isJuniorOnDate(dateOfBirth: CalendarDate, onDate: CalendarDate): boolean {
  return ageOnDate(dateOfBirth, onDate) <= JUNIOR_AGE_CEILING;
}

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
  dateOfBirth?: CalendarDate | null,
  onDate?: CalendarDate | null,
): DepthLimit {
  const verified = certifications.filter(validVerifiedCertification);
  const age = dateOfBirth && onDate ? ageOnDate(dateOfBirth, onDate) : null;
  const cards = verified as readonly (Certification & {
    juniorStatus?: "junior" | "full" | null;
  })[];
  const reasons = new Set<JuniorVerificationReason>();
  if (age !== null && age < JUNIOR_AGE_END) reasons.add("junior_limits");
  if (age === null && verified.length === 0) reasons.add("junior_limits");
  for (const card of cards) {
    if (!card.agency) continue;
    if (card.juniorStatus == null) reasons.add("card_status");
    if (
      age === null ||
      (card.agency === "bsac" && age < ADULT_AGE) ||
      (card.agency !== "padi" && card.juniorStatus === "junior")
    ) {
      reasons.add("junior_limits");
    }
  }
  const uncertain = reasons.size ? { verificationReasons: [...reasons] } : {};
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
  const nauiJunior = cards.some(
    (card) =>
      card.agency === "naui" &&
      (card.juniorStatus === "junior" || (age !== null && age < JUNIOR_AGE_END)),
  );
  if (age !== null && age <= JUNIOR_AGE_CEILING) {
    if (age < JUNIOR_YOUNGEST_BAND_END)
      return { ceiling: JUNIOR_YOUNGEST_LIMIT, basis: "junior_age", level, ...uncertain };
    return {
      ceiling:
        !nauiJunior && level && certificationRank(level) >= certificationRank("advanced_open_water")
          ? JUNIOR_ADVANCED_LIMIT
          : JUNIOR_OPEN_WATER_LIMIT,
      basis: "junior_age",
      level,
      ...uncertain,
    };
  }

  if (nauiJunior) {
    return { ceiling: JUNIOR_OPEN_WATER_LIMIT, basis: "junior_card", level, ...uncertain };
  }

  if (!level) return { ceiling: NO_CARD_LIMIT, basis: "no_card", level: null, ...uncertain };

  // A Deep specialty raises an Open Water diver's ceiling to the recreational
  // limit, but it can only ever raise, never lower an already-deeper level.
  const hasDeep = holdsSpecialtyCard(specialtyCertifications, "deep");
  const levelLimit = LEVEL_DEPTH_LIMIT[level];
  if (hasDeep && levelLimit.meters < RECREATIONAL_LIMIT.meters) {
    return { ceiling: RECREATIONAL_LIMIT, basis: "deep_specialty", level, ...uncertain };
  }
  return { ceiling: levelLimit, basis: "certification", level, ...uncertain };
}

export type DepthCeilingCheck =
  /** No site depth recorded, or nothing to measure. Say nothing. */
  | { status: "unknown" }
  | { status: "verification_required"; verificationReasons: JuniorVerificationReason[] }
  | { status: "within"; siteDepth: number; limitDepth: number; unit: DepthUnit }
  | {
      status: "exceeds";
      /** Both already converted to the shop's unit and rounded for display. */
      siteDepth: number;
      limitDepth: number;
      unit: DepthUnit;
      basis: DepthLimitBasis;
      level: CertificationLevel | null;
      verificationReasons?: JuniorVerificationReason[];
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
  if (!limit) return { status: "unknown" };
  if (!siteMaxDepthMeters)
    return limit.verificationReasons
      ? { status: "verification_required", verificationReasons: limit.verificationReasons }
      : { status: "unknown" };
  const siteDepth = depthInUnit(siteMaxDepthMeters, unit);
  const limitDepth = ceilingIn(limit.ceiling, unit);
  if (siteDepth <= limitDepth)
    return limit.verificationReasons
      ? { status: "verification_required", verificationReasons: limit.verificationReasons }
      : { status: "within", siteDepth, limitDepth, unit };
  return {
    status: "exceeds",
    siteDepth,
    limitDepth,
    unit,
    basis: limit.basis,
    level: limit.level,
    ...(limit.verificationReasons ? { verificationReasons: limit.verificationReasons } : {}),
  };
}
