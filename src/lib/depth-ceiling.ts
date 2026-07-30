import type { Certification, SpecialtyCertification } from "@/db/schema";
import { ageOnDate } from "./age";
import type { CalendarDate } from "./calendar-date";
import {
  type CertificationLevel,
  certificationRank,
  validVerifiedCertification,
} from "./readiness";

/**
 * How deep each certification level is trained to go, in metres. Sourced in
 * [20260724-course-admission-standards](../../docs/architecture/decisions/20260724-course-admission-standards.md):
 * Open Water 18 m/60 ft, Advanced Open Water 30 m/100 ft, and 40 m as the
 * recreational limit beyond which a dive stops being recreational at all.
 *
 * Rescue does not extend depth — it is a skills course, not a deeper one — so it
 * shares AOW's ceiling. Divemaster and Instructor are professional ratings held
 * to the recreational 40 m.
 */
const LEVEL_DEPTH_LIMIT_METERS: Record<CertificationLevel, number> = {
  open_water: 18,
  advanced_open_water: 30,
  rescue: 30,
  divemaster: 40,
  instructor: 40,
};

/** The recreational floor. A Deep specialty lifts an OW diver to it, not past it. */
const RECREATIONAL_LIMIT_METERS = 40;

/**
 * Junior certifications carry an age-linked ceiling that is *stricter* than the
 * card's own level, and it lifts on the diver's 15th birthday rather than on
 * any new card. Ages 10–11 are capped at 12 m whatever they hold; 12–14 reach
 * 18 m, or 21 m on a Junior Advanced Open Water card.
 *
 * Modeled on age rather than a `junior_*` enum member because that is how the
 * restriction actually works — the same plastic card means different depths on
 * either side of a birthday, and DiveDay stores one `certification_level`
 * ladder with no junior variants (src/db/schema.ts).
 */
const JUNIOR_AGE_FLOOR = 10;
const JUNIOR_AGE_CEILING = 14;
const JUNIOR_YOUNGEST_LIMIT_METERS = 12;
const JUNIOR_OPEN_WATER_LIMIT_METERS = 18;
const JUNIOR_ADVANCED_LIMIT_METERS = 21;

/** Why a diver's ceiling is what it is — the UI needs to say which rule bit. */
export type DepthLimitBasis = "certification" | "junior_age" | "deep_specialty";

export type DepthLimit = {
  limitMeters: number;
  basis: DepthLimitBasis;
  /** The level the limit was read off, for the "your Open Water card…" phrasing. */
  level: CertificationLevel;
};

/**
 * The deepest a diver may go, given the best card they actually hold and — when
 * a date of birth is on file — the junior band they fall in.
 *
 * Returns null when no verified card clears, which is deliberately *not* a
 * depth of zero: an uncertified diver is a readiness blocker's problem
 * (`certification_missing`), and inventing a 0 m ceiling here would spray a
 * second, redundant depth warning across every diver a shop hasn't carded yet.
 */
export function diverDepthLimit(
  certifications: readonly Certification[],
  specialtyCertifications: readonly SpecialtyCertification[],
  todayLocal: CalendarDate,
  dateOfBirth?: CalendarDate | null,
  onDate?: CalendarDate | null,
): DepthLimit | null {
  const verified = certifications.filter((certification) =>
    validVerifiedCertification(certification, todayLocal),
  );
  if (verified.length === 0) return null;

  const level = verified.reduce<CertificationLevel>(
    (best, certification) =>
      certificationRank(certification.level) > certificationRank(best) ? certification.level : best,
    verified[0].level,
  );

  // The junior band, when it applies, is always the stricter answer — a
  // 12-year-old with an AOW card is held to 21 m, not AOW's 30 m — so it wins
  // outright rather than being min()'d against a Deep specialty they could not
  // hold at that age anyway.
  const age = dateOfBirth && onDate ? ageOnDate(dateOfBirth, onDate) : null;
  if (age !== null && age >= JUNIOR_AGE_FLOOR && age <= JUNIOR_AGE_CEILING) {
    if (age < 12) {
      return { limitMeters: JUNIOR_YOUNGEST_LIMIT_METERS, basis: "junior_age", level };
    }
    return {
      limitMeters:
        certificationRank(level) >= certificationRank("advanced_open_water")
          ? JUNIOR_ADVANCED_LIMIT_METERS
          : JUNIOR_OPEN_WATER_LIMIT_METERS,
      basis: "junior_age",
      level,
    };
  }

  // A Deep specialty is exactly the training that lifts an Open Water diver past
  // 18 m, so it raises the ceiling to the recreational limit — but it can only
  // ever raise, never lower an already-deeper level.
  const hasDeep = specialtyCertifications.some(
    (card) =>
      card.specialty === "deep" &&
      card.status === "verified" &&
      (!card.importedAt || card.reviewedAt),
  );
  const levelLimit = LEVEL_DEPTH_LIMIT_METERS[level];
  if (hasDeep && levelLimit < RECREATIONAL_LIMIT_METERS) {
    return { limitMeters: RECREATIONAL_LIMIT_METERS, basis: "deep_specialty", level };
  }
  return { limitMeters: levelLimit, basis: "certification", level };
}

export type DepthCeilingCheck =
  /** No site depth recorded, or no card to measure against. Say nothing. */
  | { status: "unknown" }
  | { status: "within"; limitMeters: number; siteMaxDepthMeters: number }
  | {
      status: "exceeds";
      limitMeters: number;
      siteMaxDepthMeters: number;
      basis: DepthLimitBasis;
      level: CertificationLevel;
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
 */
export function checkDepthCeiling(
  siteMaxDepthMeters: number | null | undefined,
  limit: DepthLimit | null,
): DepthCeilingCheck {
  if (!siteMaxDepthMeters || !limit) return { status: "unknown" };
  if (siteMaxDepthMeters <= limit.limitMeters) {
    return { status: "within", limitMeters: limit.limitMeters, siteMaxDepthMeters };
  }
  return {
    status: "exceeds",
    limitMeters: limit.limitMeters,
    siteMaxDepthMeters,
    basis: limit.basis,
    level: limit.level,
  };
}
