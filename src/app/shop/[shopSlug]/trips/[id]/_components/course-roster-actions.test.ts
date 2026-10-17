import { describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
vi.mock("../course-actions", () => {
  const door =
    (name: string) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
    };
  return {
    certifyDiverFromRosterAction: door("certify"),
    saveCourseNextStepAction: door("next-step"),
    setCourseMaterialsDoneAction: door("materials"),
    markTrainingDiveAction: door("mark"),
    clearTrainingDiveAction: door("clear"),
  };
});
vi.mock("../elearning-actions", () => ({ elearningCheckAction: async () => {} }));

const { trainingMarkRosterActions } = await import("./course-roster-actions");

describe("trainingMarkRosterActions (issue #2275)", () => {
  it("offers mark and clear to a staffer who may configure trips, on a charter", async () => {
    const actions = trainingMarkRosterActions(false, true, "blue-mantis", "trip-1");
    const form = new FormData();
    await actions.markTrainingDiveAction?.(form);
    await actions.clearTrainingDiveAction?.(form);
    expect(calls).toEqual([
      ["mark", "blue-mantis", "trip-1", form],
      ["clear", "blue-mantis", "trip-1", form],
    ]);
  });

  it("offers neither to a captain, nor on a course session", () => {
    expect(trainingMarkRosterActions(false, false, "blue-mantis", "trip-1")).toEqual({});
    expect(trainingMarkRosterActions(true, true, "blue-mantis", "trip-1")).toEqual({});
  });
});
