import type { StaffWeek } from "./rules";

/** Selection changes the view, never the actor or their permissions. */
export function staffSchedulePerson(input: {
  requested?: string;
  viewerId: string;
  canManage: boolean;
  staffIds: readonly string[];
}): string | null {
  if (!input.requested || input.requested === "all") return null;
  if (input.requested === "me") return input.viewerId;
  return input.canManage && input.staffIds.includes(input.requested)
    ? input.requested
    : input.viewerId;
}

export function filterStaffWeek(week: StaffWeek, personId: string | null): StaffWeek {
  if (!personId) return week;
  return {
    ...week,
    people: week.people.filter((person) => person.personId === personId),
    gapDays: week.gapDays.map((day) => ({ ...day, gaps: [] })),
    hasGaps: false,
  };
}
