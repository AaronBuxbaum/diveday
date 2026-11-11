import { describe, expect, it } from "vitest";
import { filterStaffWeek, staffSchedulePerson } from "./filter";
import type { StaffWeek } from "./rules";

describe("staff schedule scope", () => {
  const input = { viewerId: "me-id", staffIds: ["me-id", "other"], canManage: false };
  it("offers full shop and own schedules to staff", () => {
    expect(staffSchedulePerson(input)).toBeNull();
    expect(staffSchedulePerson({ ...input, requested: "all" })).toBeNull();
    expect(staffSchedulePerson({ ...input, requested: "me" })).toBe("me-id");
  });
  it("only lets managers select a person in this shop's live roster", () => {
    expect(staffSchedulePerson({ ...input, requested: "other" })).toBe("me-id");
    expect(staffSchedulePerson({ ...input, requested: "other", canManage: true })).toBe("other");
    expect(staffSchedulePerson({ ...input, requested: "foreign", canManage: true })).toBe("me-id");
  });
  it("filters both screen and paper without changing the source week", () => {
    const week = {
      days: [],
      people: [{ personId: "me-id" }, { personId: "other" }],
      gapDays: [{ date: "2026-11-09", gaps: [{ tripId: "gap" }] }],
      hasGaps: true,
    } as unknown as StaffWeek;
    expect(filterStaffWeek(week, null)).toBe(week);
    const own = filterStaffWeek(week, "me-id");
    expect(own.people.map((person) => person.personId)).toEqual(["me-id"]);
    expect(own.hasGaps).toBe(false);
    expect(own.gapDays[0]?.gaps).toEqual([]);
    expect(week.people).toHaveLength(2);
    expect(week.hasGaps).toBe(true);
  });
});
