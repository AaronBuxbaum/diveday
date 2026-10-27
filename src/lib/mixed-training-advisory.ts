import { type CourseCrewGapCourse, courseRatioKind } from "./course-ratios";

/** Evidence for a conditional desk warning; these sessions are not an assigned group. */
export type TrainingSession = {
  id: string;
  course: CourseCrewGapCourse;
  windows: readonly { startsAt: Date; endsAt: Date }[];
  instructorIds: readonly string[];
  students: number;
};

/** Find other sessions whose students might train with the proposed new student. */
export function mixedTrainingCandidates(
  target: TrainingSession,
  others: readonly TrainingSession[],
): string[] {
  const targetKind = courseRatioKind(target.course);
  if (!targetKind || target.instructorIds.length === 0) return [];
  const instructors = new Set(target.instructorIds);
  return [
    ...new Set(
      others
        .filter((other) => {
          const kind = courseRatioKind(other.course);
          if (
            other.id === target.id ||
            !kind ||
            (kind !== "intro" && targetKind !== "intro") ||
            other.students <= 0
          )
            return false;
          if (!other.instructorIds.some((id) => instructors.has(id))) return false;
          return target.windows.some((a) =>
            other.windows.some((b) => a.startsAt < b.endsAt && b.startsAt < a.endsAt),
          );
        })
        .map((other) => other.id),
    ),
  ];
}
