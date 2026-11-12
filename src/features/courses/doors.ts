import type { CertificationLevel } from "../../lib/certification-levels";
import { isRefresherCourse } from "../../lib/re-entry";

type DoorCourse = {
  isActive: boolean;
  isIntroCourse: boolean;
  minimumCertificationLevel: CertificationLevel | null;
  certifiesLevel: CertificationLevel | null;
  sourceTemplateSlug: string | null;
};

/** The first matching shop course in catalog order; names never establish suitability. */
export function courseDoors<T extends DoorCourse>(catalog: readonly T[]) {
  const active = catalog.filter((course) => course.isActive);
  const matches = [
    {
      kind: "try" as const,
      course: active.find(
        (course) => course.isIntroCourse && course.minimumCertificationLevel === null,
      ),
    },
    {
      kind: "certify" as const,
      course: active.find(
        (course) =>
          !course.isIntroCourse &&
          course.minimumCertificationLevel === null &&
          course.certifiesLevel === "open_water",
      ),
    },
    { kind: "refresh" as const, course: active.find(isRefresherCourse) },
  ];
  return matches.flatMap(({ kind, course }) => (course ? [{ kind, course }] : []));
}
