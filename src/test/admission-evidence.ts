import type { Certification } from "@/db/schema";
import type { SiteCertRequirement } from "@/lib/readiness";
import type { TripLevelRequirement } from "@/lib/training-mark";
import type { TripAdmissionEvidence } from "@/lib/trip-admission";

/**
 * The admission tests' evidence and requirement builders: a verified card, the
 * diver's whole file, and a trip's or a site's demand, each with nothing
 * demanded until a test says otherwise.
 */
export function certification(overrides: Partial<Certification> = {}): Certification {
  return {
    status: "verified",
    level: "open_water",
    ...overrides,
  } as Certification;
}

export function evidence(overrides: Partial<TripAdmissionEvidence> = {}): TripAdmissionEvidence {
  return {
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
    ...overrides,
  };
}

export function requirement(overrides: Partial<TripLevelRequirement> = {}): TripLevelRequirement {
  return {
    minimumCertificationIsDefault: false,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    ...overrides,
  };
}

export function site(overrides: Partial<SiteCertRequirement> = {}): SiteCertRequirement {
  return requirement(overrides);
}
