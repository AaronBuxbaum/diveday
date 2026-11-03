import type { DiveSpecialty } from "@/db/schema";
import type { CertificationLevel, ReadinessBlocker } from "@/lib/readiness";

/**
 * The four ladder blockers a sale refusal is made of (`TripAdmissionRefusal`,
 * src/lib/trip-admission.ts), spelled once for every test that expects one.
 */
export function levelShort(
  requiredLevel: CertificationLevel,
  heldLevel: CertificationLevel,
): ReadinessBlocker {
  return { code: "certification_insufficient", params: { requiredLevel, heldLevel } };
}

export function noLevel(requiredLevel: CertificationLevel): ReadinessBlocker {
  return { code: "certification_missing", params: { requiredLevel } };
}

export function noSpecialty(specialty: DiveSpecialty): ReadinessBlocker {
  return { code: "specialty_missing", params: { specialty } };
}

export const NO_NITROX: ReadinessBlocker = { code: "nitrox_missing" };
