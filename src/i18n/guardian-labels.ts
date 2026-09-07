import { GUARDIAN_RELATIONSHIPS, type GuardianRelationship } from "@/lib/guardian";
import type { DiverMessageKey, DiverTranslator } from "./messages";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * **What a guardian is to the diver, in words** (ADR
 * 20260907-guardian-co-signature). `src/lib/guardian.ts` hands back a code;
 * the waiver page's `<select>` and every staff surface that says "co-signed
 * by" resolve it here — one key set per audience, so the two bundles never
 * have to agree on a shape (the same split `src/i18n/readiness-labels.ts`
 * draws for certification levels).
 */
export const GUARDIAN_RELATIONSHIP_KEYS: Record<GuardianRelationship, StaffMessageKey> = {
  parent: "shared.guardian.relationship.parent",
  legal_guardian: "shared.guardian.relationship.legalGuardian",
};

export const DIVER_GUARDIAN_RELATIONSHIP_KEYS: Record<GuardianRelationship, DiverMessageKey> = {
  parent: "waiver.guardianRelationshipParent",
  legal_guardian: "waiver.guardianRelationshipLegalGuardian",
};

/**
 * The same two codes as a `<select>` option rather than as the tail of a
 * sentence — "Legal guardian" standing alone, where `coSignedBy` wants
 * "(legal guardian)" inside its parentheses.
 */
const GUARDIAN_RELATIONSHIP_OPTION_KEYS: Record<GuardianRelationship, StaffMessageKey> = {
  parent: "shared.guardian.relationshipOption.parent",
  legal_guardian: "shared.guardian.relationshipOption.legalGuardian",
};

/** The one word a relationship code goes by, in the staff bundle's language. */
export function guardianRelationshipText(
  t: StaffTranslator,
  relationship: GuardianRelationship,
): string {
  return t(GUARDIAN_RELATIONSHIP_KEYS[relationship]);
}

/**
 * "Co-signed by Jonas Fischer (parent)" — the one sentence every staff surface
 * that shows a signature uses for the guardian half of it, so the roster, the
 * manifest, the signature log and the diver record say it identically.
 */
export function guardianCoSignedText(
  t: StaffTranslator,
  guardian: { name: string; relationship: GuardianRelationship },
): string {
  return t("shared.guardian.coSignedBy", {
    name: guardian.name,
    relationship: guardianRelationshipText(t, guardian.relationship),
  });
}

/** The waiver page's relationship options, in the diver's language and the rule's order. */
export function diverGuardianRelationshipOptions(
  t: DiverTranslator,
): Array<{ value: GuardianRelationship; label: string }> {
  return GUARDIAN_RELATIONSHIPS.map((value) => ({
    value,
    label: t(DIVER_GUARDIAN_RELATIONSHIP_KEYS[value]),
  }));
}

/** The paper-release form's relationship options, in the staff bundle's language. */
export function staffGuardianRelationshipOptions(
  t: StaffTranslator,
): Array<{ value: GuardianRelationship; label: string }> {
  return GUARDIAN_RELATIONSHIPS.map((value) => ({
    value,
    label: t(GUARDIAN_RELATIONSHIP_OPTION_KEYS[value]),
  }));
}
