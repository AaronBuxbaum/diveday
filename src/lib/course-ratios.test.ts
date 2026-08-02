import { describe, expect, it } from "vitest";
import {
  type CourseCrewGapCourse,
  courseCrewGap,
  entryLevelCourseCapacity,
  hasCourseCrewGap,
} from "./course-ratios";

const padiEntryLevel: CourseCrewGapCourse = {
  agency: "padi",
  minimumCertificationLevel: null,
  isIntroCourse: false,
};
const padiAdvanced: CourseCrewGapCourse = {
  agency: "padi",
  minimumCertificationLevel: "open_water",
  isIntroCourse: false,
};
const ssiEntryLevel: CourseCrewGapCourse = {
  agency: "ssi",
  minimumCertificationLevel: null,
  isIntroCourse: false,
};
const padiDsd: CourseCrewGapCourse = {
  agency: "padi",
  minimumCertificationLevel: null,
  isIntroCourse: true,
};

describe("entryLevelCourseCapacity", () => {
  it("seats nobody with no instructor, regardless of assistants", () => {
    expect(entryLevelCourseCapacity(0, 3)).toBe(0);
    expect(entryLevelCourseCapacity(0, 3, true)).toBe(0);
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

  it("is the tighter 2-per-instructor DSD open-water ratio, uncredited by assistants", () => {
    expect(entryLevelCourseCapacity(1, 0, true)).toBe(2);
    expect(entryLevelCourseCapacity(1, 5, true)).toBe(2); // no published DSD assistant bonus
    expect(entryLevelCourseCapacity(2, 0, true)).toBe(4);
  });
});

describe("courseCrewGap", () => {
  it("has no gap for a fun dive (no course)", () => {
    expect(
      courseCrewGap({ course: null, instructorCount: 0, assistantCount: 0, booked: 5 }),
    ).toEqual({
      code: "none",
    });
  });

  it("is no_instructor for any course with zero instructors, regardless of agency", () => {
    expect(
      courseCrewGap({ course: padiEntryLevel, instructorCount: 0, assistantCount: 2, booked: 3 }),
    ).toEqual({ code: "no_instructor" });
    expect(
      courseCrewGap({ course: ssiEntryLevel, instructorCount: 0, assistantCount: 0, booked: 0 }),
    ).toEqual({ code: "no_instructor" });
  });

  it("is none for a non-entry-level (gated) course once it has an instructor, ratio unchecked", () => {
    // Advanced/Rescue/specialties already gate on a verified card at booking
    // and PADI publishes no comparable numeric ratio for them.
    expect(
      courseCrewGap({ course: padiAdvanced, instructorCount: 1, assistantCount: 0, booked: 40 }),
    ).toEqual({ code: "none" });
  });

  it("is none for a non-PADI entry-level course once it has an instructor, ratio unchecked", () => {
    expect(
      courseCrewGap({ course: ssiEntryLevel, instructorCount: 1, assistantCount: 0, booked: 40 }),
    ).toEqual({ code: "none" });
  });

  it("is none for a PADI entry-level course within ratio", () => {
    expect(
      courseCrewGap({ course: padiEntryLevel, instructorCount: 1, assistantCount: 0, booked: 8 }),
    ).toEqual({ code: "none" });
  });

  it("is over_ratio for a PADI entry-level course booked past its crew's capacity", () => {
    expect(
      courseCrewGap({ course: padiEntryLevel, instructorCount: 1, assistantCount: 0, booked: 9 }),
    ).toEqual({ code: "over_ratio", booked: 9, capacity: 8 });
  });

  it("credits certified assistants toward the ratio", () => {
    expect(
      courseCrewGap({ course: padiEntryLevel, instructorCount: 1, assistantCount: 1, booked: 10 }),
    ).toEqual({ code: "none" });
    expect(
      courseCrewGap({ course: padiEntryLevel, instructorCount: 1, assistantCount: 1, booked: 11 }),
    ).toEqual({ code: "over_ratio", booked: 11, capacity: 10 });
  });

  it("holds a DSD session to the tighter 2:1 open-water ratio, not the OW 8:1 figure", () => {
    expect(
      courseCrewGap({ course: padiDsd, instructorCount: 1, assistantCount: 0, booked: 2 }),
    ).toEqual({ code: "none" });
    expect(
      courseCrewGap({ course: padiDsd, instructorCount: 1, assistantCount: 0, booked: 3 }),
    ).toEqual({ code: "over_ratio", booked: 3, capacity: 2 });
  });

  it("does not credit assistants toward a DSD session's ratio (no published bonus)", () => {
    expect(
      courseCrewGap({ course: padiDsd, instructorCount: 1, assistantCount: 3, booked: 3 }),
    ).toEqual({ code: "over_ratio", booked: 3, capacity: 2 });
  });
});

describe("hasCourseCrewGap", () => {
  it("is false only for 'none'", () => {
    expect(hasCourseCrewGap({ code: "none" })).toBe(false);
    expect(hasCourseCrewGap({ code: "no_instructor" })).toBe(true);
    expect(hasCourseCrewGap({ code: "over_ratio", booked: 9, capacity: 8 })).toBe(true);
  });
});
