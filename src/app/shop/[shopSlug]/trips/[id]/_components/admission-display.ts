import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CertificationLevel } from "@/lib/certification-levels";
import { type Requirement, unionRequirements } from "@/lib/requirement";

/** Describe the diver's booking gates, not the separate boarding-readiness checks. */
export function admissionDisplay(
  course: {
    minimumCertificationLevel: CertificationLevel | null;
    minimumAge: number | null;
  } | null,
  trip: Requirement | null,
  site: Requirement | null,
  t: StaffTranslator,
): string {
  // Course admission replaces the trip and site certification gates. The course
  // row is live; the trip requirement can be an older snapshot of that row.
  if (course) {
    return (
      [
        course.minimumCertificationLevel
          ? t("trips.clock.filling.courseCard", {
              level: t(CERTIFICATION_LEVEL_KEYS[course.minimumCertificationLevel]),
            })
          : null,
        course.minimumAge ? t("trips.clock.filling.courseAge", { age: course.minimumAge }) : null,
      ]
        .filter(Boolean)
        .join(" · ") || t("trips.clock.filling.anyone")
    );
  }
  const effective = unionRequirements(trip, site);
  return (
    [
      effective.minimumCertificationLevel
        ? t("trips.clock.filling.orHigher", {
            level: t(CERTIFICATION_LEVEL_KEYS[effective.minimumCertificationLevel]),
          })
        : null,
      ...effective.requiredSpecialties.map((specialty) =>
        t("trips.clock.filling.specialty", { specialty: t(SPECIALTY_KEYS[specialty]) }),
      ),
      effective.requiresNitrox ? t("trips.clock.filling.nitrox") : null,
    ]
      .filter(Boolean)
      .join(" · ") || t("trips.clock.filling.anyone")
  );
}
