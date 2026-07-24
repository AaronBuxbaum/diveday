import { describe, expect, it } from "vitest";
import { entryLevelCourseCapacity } from "./course-ratios";

describe("entryLevelCourseCapacity", () => {
  it("seats nobody with no instructor, regardless of assistants", () => {
    expect(entryLevelCourseCapacity(0, 3)).toBe(0);
  });

  it("is 8 per solo instructor with no certified assistant (PADI base ratio)", () => {
    expect(entryLevelCourseCapacity(1, 0)).toBe(8);
  });

  it("adds 2 per certified assistant up to the 12 ceiling", () => {
    expect(entryLevelCourseCapacity(1, 1)).toBe(10);
    expect(entryLevelCourseCapacity(1, 2)).toBe(12);
    expect(entryLevelCourseCapacity(1, 3)).toBe(12); // capped, not 14
  });

  it("scales the base ratio across multiple instructors", () => {
    expect(entryLevelCourseCapacity(2, 0)).toBe(16);
    expect(entryLevelCourseCapacity(2, 1)).toBe(18);
    expect(entryLevelCourseCapacity(2, 2)).toBe(20);
  });

  it("never exceeds the per-instructor ceiling even with excess assistants", () => {
    expect(entryLevelCourseCapacity(2, 10)).toBe(24); // 2 * 12
  });
});
