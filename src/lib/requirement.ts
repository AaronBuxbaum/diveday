import type { DiveSpecialty } from "@/db/schema";
import {
  type CertificationLevel,
  certificationRank,
  higherCertificationLevel,
} from "./certification-levels";

/**
 * **Who may take this** — the one shape a dive site, a trip and the running
 * total of several of them all demand of a diver.
 *
 * A level on the ladder, specialty cards, and an enriched-air card. Null level,
 * no specialties and no nitrox means the thing asks nothing of anybody — never
 * "unknown". It is declared once here; the schema's three columns
 * (`requirementColumns`, src/db/schema/requirement.ts), the staff form
 * (`RequirementFields`) and every gate (`src/lib/readiness.ts`,
 * `src/lib/trip-admission.ts`, and the lists that read ahead of them) fold,
 * test and print this and nothing else, so a future fourth demand is added in
 * one place.
 *
 * Codes and numbers only: the words are the staff and diver bundles'.
 */
export type Requirement = {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: readonly DiveSpecialty[];
  requiresNitrox: boolean;
};

/** The identity element of {@link unionRequirements}: demands nothing of anybody. */
export const NO_REQUIREMENT: Requirement = Object.freeze({
  minimumCertificationLevel: null,
  requiredSpecialties: Object.freeze([]) as readonly DiveSpecialty[],
  requiresNitrox: false,
});

/**
 * Whether this asks nothing at all. Deliberately broader than "has a minimum
 * level": a Deep-and-nitrox charter with the level box left blank is a common
 * real configuration, and it is still a departure a diver can fail to meet.
 * An absent requirement asks nothing.
 */
export function requirementDemandsNothing(requirement: Requirement | null | undefined): boolean {
  if (!requirement) return true;
  return (
    !requirement.minimumCertificationLevel &&
    (requirement.requiredSpecialties?.length ?? 0) === 0 &&
    !requirement.requiresNitrox
  );
}

/** The requirement itself when it asks for something, otherwise null ("absent", not "empty"). */
export function requirementOrNull<R extends Requirement>(
  requirement: R | null | undefined,
): R | null {
  return requirementDemandsNothing(requirement) ? null : (requirement ?? null);
}

/**
 * The gate a diver is actually held to when several things each ask something:
 * the stricter minimum level, the union of specialties (first mention first),
 * and nitrox if any one of them wants it. Absent parts ask nothing.
 *
 * Commutative and associative as far as what is demanded goes, which is what
 * lets a trip fold its own requirement with every site it visits in any order.
 */
export function unionRequirements(
  ...parts: ReadonlyArray<Requirement | null | undefined>
): Requirement {
  let level: CertificationLevel | null = null;
  const specialties = new Set<DiveSpecialty>();
  let requiresNitrox = false;
  for (const part of parts) {
    if (!part) continue;
    level = higherCertificationLevel(level, part.minimumCertificationLevel);
    for (const specialty of part.requiredSpecialties ?? []) specialties.add(specialty);
    requiresNitrox = requiresNitrox || Boolean(part.requiresNitrox);
  }
  return {
    minimumCertificationLevel: level,
    requiredSpecialties: [...specialties],
    requiresNitrox,
  };
}

/**
 * **Asks no more than the ceiling does**: no higher rung on the ladder, no
 * nitrox the ceiling does not ask, no specialty it does not ask. A candidate
 * that asks nothing is within any ceiling, including none.
 */
export function requirementWithin(
  candidate: Requirement | null | undefined,
  ceiling: Requirement | null | undefined,
): boolean {
  if (!candidate) return true;
  const wanted = candidate.minimumCertificationLevel;
  const held = ceiling?.minimumCertificationLevel ?? null;
  if (wanted && (!held || certificationRank(wanted) > certificationRank(held))) return false;
  if (candidate.requiresNitrox && !ceiling?.requiresNitrox) return false;
  const allowed = new Set(ceiling?.requiredSpecialties ?? []);
  return candidate.requiredSpecialties.every((specialty) => allowed.has(specialty));
}

/**
 * A requirement read off a row, a join or a form that may be missing any part
 * of it. Absent fields ask nothing, and a requirement is never read as asking
 * *more* than it says: this is the one place `null` / `undefined` / `[]` /
 * `false` are made the same thing.
 */
export function parseRequirement(
  raw:
    | {
        minimumCertificationLevel?: CertificationLevel | null;
        requiredSpecialties?: readonly DiveSpecialty[] | null;
        requiresNitrox?: boolean | null;
      }
    | null
    | undefined,
): Requirement {
  return {
    minimumCertificationLevel: raw?.minimumCertificationLevel ?? null,
    requiredSpecialties: [...(raw?.requiredSpecialties ?? [])],
    requiresNitrox: Boolean(raw?.requiresNitrox),
  };
}

/**
 * The three column values a table that stores a requirement is written with
 * (`requirementColumns`). The inverse of {@link parseRequirement}, so a write
 * and the next read cannot disagree about what "nothing" looks like.
 */
export function serializeRequirement(requirement: Requirement): {
  minimumCertificationLevel: CertificationLevel | null;
  requiredSpecialties: DiveSpecialty[];
  requiresNitrox: boolean;
} {
  return {
    minimumCertificationLevel: requirement.minimumCertificationLevel,
    requiredSpecialties: [...requirement.requiredSpecialties],
    requiresNitrox: requirement.requiresNitrox,
  };
}
