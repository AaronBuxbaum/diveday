import { type CourseRatioRule, courseRatioCapacity } from "./course-ratios";
import { inWaterCrewRole } from "./crew-roles";
import { type CrewMember, courseInstructorIdsAboard } from "./training-mark";

export type PlannedTrainingStudent = {
  id: string;
  sessionTripId: string;
  instructorPersonId: string | null;
  rule: CourseRatioRule | null;
};

/** A staff plan, not evidence of the people who actually dive together. */
export function trainingAllocationPlan(input: {
  students: readonly PlannedTrainingStudent[];
  sessionCrew: ReadonlyMap<string, readonly CrewMember[]>;
  departureCrew: readonly CrewMember[];
  assistants: readonly { assistantPersonId: string; instructorPersonId: string | null }[];
}): {
  groups: ReadonlyMap<string, { students: number; capacity: number; overRatio: boolean }>;
  unresolvedStudents: ReadonlySet<string>;
  unresolvedAssistants: ReadonlySet<string>;
} {
  const crew = new Map(input.departureCrew.map((member) => [member.personId, member]));
  const crewCounts = new Map<string, number>();
  for (const member of input.departureCrew)
    crewCounts.set(member.personId, (crewCounts.get(member.personId) ?? 0) + 1);
  const assistantCounts = new Map<string, number>();
  const unresolvedAssistants = new Set<string>();
  const frequencies = new Map<string, number>();
  for (const assignment of input.assistants)
    frequencies.set(
      assignment.assistantPersonId,
      (frequencies.get(assignment.assistantPersonId) ?? 0) + 1,
    );
  for (const member of input.departureCrew) {
    if (inWaterCrewRole(member) === "certified_assistant" && !frequencies.has(member.personId))
      unresolvedAssistants.add(member.personId);
  }
  for (const assignment of input.assistants) {
    const helper = crew.get(assignment.assistantPersonId);
    const teacher = assignment.instructorPersonId && crew.get(assignment.instructorPersonId);
    if (
      frequencies.get(assignment.assistantPersonId) !== 1 ||
      crewCounts.get(assignment.assistantPersonId) !== 1 ||
      crewCounts.get(assignment.instructorPersonId ?? "") !== 1 ||
      !helper ||
      inWaterCrewRole(helper) !== "certified_assistant" ||
      !teacher ||
      inWaterCrewRole(teacher) !== "instructor" ||
      helper.personId === teacher.personId
    ) {
      unresolvedAssistants.add(assignment.assistantPersonId);
      continue;
    }
    assistantCounts.set(teacher.personId, (assistantCounts.get(teacher.personId) ?? 0) + 1);
  }
  const groups = new Map<string, { students: number; capacity: number; overRatio: boolean }>();
  const unresolvedStudents = new Set<string>();
  // Never report a partial group when an assigned seat cannot be resolved.
  const incompleteInstructors = new Set<string>();
  const studentCounts = new Map<string, number>();
  for (const student of input.students)
    studentCounts.set(student.id, (studentCounts.get(student.id) ?? 0) + 1);
  for (const student of input.students) {
    const id = student.instructorPersonId;
    if (
      studentCounts.get(student.id) !== 1 ||
      !id ||
      crewCounts.get(id) !== 1 ||
      !student.rule ||
      !courseInstructorIdsAboard(
        input.sessionCrew.get(student.sessionTripId) ?? [],
        input.departureCrew,
      ).includes(id)
    ) {
      unresolvedStudents.add(student.id);
      if (id) incompleteInstructors.add(id);
      continue;
    }
    const capacity = courseRatioCapacity(student.rule, 1, assistantCounts.get(id) ?? 0);
    const prior = groups.get(id);
    const count = (prior?.students ?? 0) + 1;
    const cap = Math.min(prior?.capacity ?? capacity, capacity);
    groups.set(id, { students: count, capacity: cap, overRatio: count > cap });
  }
  for (const instructorId of incompleteInstructors) groups.delete(instructorId);
  return { groups, unresolvedStudents, unresolvedAssistants };
}
