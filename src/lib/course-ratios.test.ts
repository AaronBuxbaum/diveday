import { describe, expect, it } from "vitest";
import {
  type CourseCrewGapCourse,
  courseCrewGap,
  courseRatioRule,
  courseSeatCapacity,
  ENTRY_LEVEL_COURSE_RATIO,
  entryLevelCourseCapacity,
  hasCourseCrewGap,
  INTRO_COURSE_RATIO,
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
/** A Discover Scuba Diving taster: nobody aboard holds a card. */
const padiIntro: CourseCrewGapCourse = {
  agency: "padi",
  minimumCertificationLevel: null,
  isIntroCourse: true,
};

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

describe("courseRatioRule", () => {
  it("gates an intro (DSD) session at 4:1 with no assistant bonus", () => {
    expect(courseRatioRule(padiIntro)).toEqual(INTRO_COURSE_RATIO);
    expect(INTRO_COURSE_RATIO).toEqual({
      baseStudentsPerInstructor: 4,
      assistantBonusPerInstructor: 0,
      maxStudentsPerInstructor: 4,
    });
  });

  it("gates a non-intro entry-level session at the 8/12 Open Water ratio", () => {
    expect(courseRatioRule(padiEntryLevel)).toEqual(ENTRY_LEVEL_COURSE_RATIO);
  });

  it("gates nothing for a continuing-ed course or a non-PADI agency", () => {
    expect(courseRatioRule(padiAdvanced)).toBeNull();
    expect(courseRatioRule(ssiEntryLevel)).toBeNull();
    expect(courseRatioRule(null)).toBeNull();
  });

  it("keeps an intro session gated even if a cert level was typed onto it", () => {
    // Nobody on a DSD holds a card, so a stray minimum_certification_level must
    // not be able to switch the tightest cap in the product off.
    expect(
      courseRatioRule({
        agency: "padi",
        minimumCertificationLevel: "open_water",
        isIntroCourse: true,
      }),
    ).toEqual(INTRO_COURSE_RATIO);
  });

  it("reads a differently-cased or padded agency as the same agency (DATA-L2)", () => {
    // `courses.agency` is plain shop-set text; a capital P must never silently
    // drop the ratio cap.
    expect(courseRatioRule({ ...padiIntro, agency: "PADI" })).toEqual(INTRO_COURSE_RATIO);
    expect(courseRatioRule({ ...padiEntryLevel, agency: " Padi " })).toEqual(
      ENTRY_LEVEL_COURSE_RATIO,
    );
  });
});

describe("courseSeatCapacity", () => {
  it("caps an intro session at 4 per instructor and never credits assistants", () => {
    expect(courseSeatCapacity(padiIntro, 1, 0)).toBe(4);
    expect(courseSeatCapacity(padiIntro, 1, 3)).toBe(4);
    expect(courseSeatCapacity(padiIntro, 2, 2)).toBe(8);
    expect(courseSeatCapacity(padiIntro, 0, 5)).toBe(0);
  });

  it("is null when the session carries no ratio at all", () => {
    expect(courseSeatCapacity(padiAdvanced, 1, 0)).toBeNull();
    expect(courseSeatCapacity(ssiEntryLevel, 1, 0)).toBeNull();
    expect(courseSeatCapacity(null, 1, 0)).toBeNull();
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

  it("is over_ratio for an intro (DSD) session past 4 per instructor", () => {
    expect(
      courseCrewGap({ course: padiIntro, instructorCount: 1, assistantCount: 0, booked: 4 }),
    ).toEqual({ code: "none" });
    expect(
      courseCrewGap({ course: padiIntro, instructorCount: 1, assistantCount: 0, booked: 5 }),
    ).toEqual({ code: "over_ratio", booked: 5, capacity: 4 });
  });

  it("never lets an assistant raise an intro session's cap", () => {
    // The whole DOM-H2 finding in one assertion: the 8/12 numbers used to
    // certify a 5-student DSD with a divemaster aboard as compliant.
    expect(
      courseCrewGap({ course: padiIntro, instructorCount: 1, assistantCount: 3, booked: 5 }),
    ).toEqual({ code: "over_ratio", booked: 5, capacity: 4 });
  });

  it("still gates an intro session whose agency was typed 'PADI' (DATA-L2)", () => {
    expect(
      courseCrewGap({
        course: { ...padiIntro, agency: "PADI" },
        instructorCount: 1,
        assistantCount: 0,
        booked: 5,
      }),
    ).toEqual({ code: "over_ratio", booked: 5, capacity: 4 });
  });
});

describe("hasCourseCrewGap", () => {
  it("is false only for 'none'", () => {
    expect(hasCourseCrewGap({ code: "none" })).toBe(false);
    expect(hasCourseCrewGap({ code: "no_instructor" })).toBe(true);
    expect(hasCourseCrewGap({ code: "over_ratio", booked: 9, capacity: 8 })).toBe(true);
  });
});
