import { describe, expect, it } from "vitest";
import { trainingAllocationPlan } from "./training-allocation-plan";

const instructor = (personId: string) => ({
  personId,
  shopRoles: ["instructor"],
  tripRole: "instructor" as const,
});
const assistant = (personId: string) => ({
  personId,
  shopRoles: ["divemaster"],
  tripRole: "divemaster" as const,
});
const entry = {
  baseStudentsPerInstructor: 8,
  assistantBonusPerInstructor: 2,
  maxStudentsPerInstructor: 12,
};
const intro = {
  baseStudentsPerInstructor: 2,
  assistantBonusPerInstructor: 0,
  maxStudentsPerInstructor: 2,
};
const students = (prefix: string, instructorId: string, count: number, rule = entry) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    sessionTripId: prefix,
    instructorPersonId: instructorId,
    rule,
  }));

describe("training allocation plan", () => {
  it("does not split one assistant across two planned instructors", () => {
    const t1 = instructor("t1");
    const t2 = instructor("t2");
    const plan = trainingAllocationPlan({
      students: [...students("s1", "t1", 9), ...students("s2", "t2", 9)],
      sessionCrew: new Map([
        ["s1", [t1]],
        ["s2", [t2]],
      ]),
      departureCrew: [t1, t2, assistant("dm")],
      assistants: [{ assistantPersonId: "dm", instructorPersonId: "t1" }],
    });
    expect(plan.groups.get("t1")).toEqual({ students: 9, capacity: 10, overRatio: false });
    expect(plan.groups.get("t2")).toEqual({ students: 9, capacity: 8, overRatio: true });
  });

  it("keeps the 11/11 plan over ratio for the instructor with one of three assistants", () => {
    const t1 = instructor("t1");
    const t2 = instructor("t2");
    const plan = trainingAllocationPlan({
      students: [...students("s1", "t1", 11), ...students("s2", "t2", 11)],
      sessionCrew: new Map([
        ["s1", [t1]],
        ["s2", [t2]],
      ]),
      departureCrew: [t1, t2, assistant("a"), assistant("b"), assistant("c")],
      assistants: [
        { assistantPersonId: "a", instructorPersonId: "t1" },
        { assistantPersonId: "b", instructorPersonId: "t1" },
        { assistantPersonId: "c", instructorPersonId: "t2" },
      ],
    });
    expect(plan.groups.get("t1")).toEqual({ students: 11, capacity: 12, overRatio: false });
    expect(plan.groups.get("t2")).toEqual({ students: 11, capacity: 10, overRatio: true });
  });

  it("credits an assistant to Open Water without lending it to a separate intro group", () => {
    const t1 = instructor("t1");
    const t2 = instructor("t2");
    const plan = trainingAllocationPlan({
      students: [...students("dsd", "t1", 1, intro), ...students("ow", "t2", 10)],
      sessionCrew: new Map([
        ["dsd", [t1]],
        ["ow", [t2]],
      ]),
      departureCrew: [t1, t2, assistant("dm")],
      assistants: [{ assistantPersonId: "dm", instructorPersonId: "t2" }],
    });
    expect(plan.groups.get("t1")).toEqual({ students: 1, capacity: 2, overRatio: false });
    expect(plan.groups.get("t2")).toEqual({ students: 10, capacity: 10, overRatio: false });
  });

  it("never credits missing, duplicate, absent or unqualified assistant assignments", () => {
    const t1 = instructor("t1");
    const plan = trainingAllocationPlan({
      students: students("ow", "t1", 9),
      sessionCrew: new Map([["ow", [t1]]]),
      departureCrew: [
        t1,
        assistant("a"),
        assistant("b"),
        { personId: "deck", shopRoles: [], tripRole: "crew" },
      ],
      assistants: [
        { assistantPersonId: "a", instructorPersonId: null },
        { assistantPersonId: "b", instructorPersonId: "t1" },
        { assistantPersonId: "b", instructorPersonId: "t1" },
        { assistantPersonId: "absent", instructorPersonId: "t1" },
        { assistantPersonId: "deck", instructorPersonId: "t1" },
      ],
    });
    expect(plan.groups.get("t1")).toEqual({ students: 9, capacity: 8, overRatio: true });
    expect([...plan.unresolvedAssistants].sort()).toEqual(["a", "absent", "b", "deck"]);
  });

  it("keeps unknown instructors, unknown ratios and duplicate students unresolved", () => {
    const t1 = instructor("t1");
    const plan = trainingAllocationPlan({
      students: [
        { id: "missing", sessionTripId: "ow", instructorPersonId: null, rule: entry },
        { id: "other", sessionTripId: "ow", instructorPersonId: "other", rule: entry },
        { id: "unknown", sessionTripId: "ow", instructorPersonId: "t1", rule: null },
        ...students("duplicate", "t1", 1),
        ...students("duplicate", "t1", 1),
      ],
      sessionCrew: new Map([
        ["ow", [t1]],
        ["duplicate", [t1]],
      ]),
      departureCrew: [t1, instructor("other")],
      assistants: [],
    });
    expect(plan.groups.size).toBe(0);
    expect([...plan.unresolvedStudents].sort()).toEqual([
      "duplicate-0",
      "missing",
      "other",
      "unknown",
    ]);
  });

  it("does not trust duplicate departure crew records as separate capacity", () => {
    const t1 = instructor("t1");
    const plan = trainingAllocationPlan({
      students: students("ow", "t1", 9),
      sessionCrew: new Map([["ow", [t1]]]),
      departureCrew: [t1, assistant("dm"), assistant("dm")],
      assistants: [{ assistantPersonId: "dm", instructorPersonId: "t1" }],
    });
    expect(plan.groups.get("t1")).toEqual({ students: 9, capacity: 8, overRatio: true });
    expect([...plan.unresolvedAssistants]).toEqual(["dm"]);
  });

  it("flags an unassigned assistant instead of silently treating the plan as complete", () => {
    const t1 = instructor("t1");
    const plan = trainingAllocationPlan({
      students: students("ow", "t1", 8),
      sessionCrew: new Map([["ow", [t1]]]),
      departureCrew: [t1, assistant("dm")],
      assistants: [],
    });
    expect([...plan.unresolvedAssistants]).toEqual(["dm"]);
  });
});
