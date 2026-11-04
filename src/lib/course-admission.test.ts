import { describe, expect, it } from "vitest";
import type { Certification } from "@/db/schema";
import {
  type CourseAdmissionInput,
  type CourseAdmissionRule,
  type CourseDiver,
  courseEnrollmentRefusal,
  courseRatioRefusal,
  courseStudentCap,
  decideCourseAdmission,
} from "./course-admission";
import { courseSeatCapacity } from "./course-ratios";

const card = (level: Certification["level"], status: Certification["status"]) =>
  ({ level, status }) as Certification;

/** PADI Open Water training dives: entry-level ratio, no card asked. */
const openWater: CourseAdmissionRule = {
  agency: "padi",
  isIntroCourse: false,
  minimumCertificationLevel: null,
  minimumAge: 10,
};
/** A Discover Scuba taster: two per instructor, no assistant bonus. */
const dsd: CourseAdmissionRule = { ...openWater, isIntroCourse: true, minimumAge: null };
/** Advanced: a card is asked, and no ratio is modelled. */
const advanced: CourseAdmissionRule = {
  ...openWater,
  minimumCertificationLevel: "open_water",
  minimumAge: 12,
};
/** An SSI course carries no PADI number. */
const ssiOpenWater: CourseAdmissionRule = { ...openWater, agency: "ssi" };

const qualified: CourseDiver = {
  cards: [card("advanced_open_water", "verified")],
  dateOfBirth: "2000-01-01",
};
const oneInstructor = { instructorCount: 1, assistantCount: 0 };
const noCrew = { instructorCount: 0, assistantCount: 0 };

/** Every door asks the same gates (issues #3769, #3686), a sale and an undo alike. */
const seat = (over: Partial<CourseAdmissionInput> = {}): CourseAdmissionInput => ({
  actor: "staff",
  course: openWater,
  student: true,
  crew: oneInstructor,
  studentsHeld: 0,
  diver: qualified,
  courseDate: "2031-06-14",
  ...over,
});

describe("decideCourseAdmission", () => {
  it("asks nothing of a departure that is no course session", () => {
    expect(decideCourseAdmission(seat({ course: null, crew: noCrew, diver: null }))).toBeNull();
    expect(decideCourseAdmission(seat({ course: null, crew: noCrew, studentsHeld: 99 }))).toBe(
      null,
    );
  });

  it("refuses every seat on an unstaffed session, student or passenger", () => {
    expect(decideCourseAdmission(seat({ crew: noCrew }))).toBe("course_unstaffed");
    expect(decideCourseAdmission(seat({ crew: noCrew, student: false }))).toBe("course_unstaffed");
    // Assistants alone do not staff a course.
    expect(decideCourseAdmission(seat({ crew: { instructorCount: 0, assistantCount: 4 } }))).toBe(
      "course_unstaffed",
    );
    // A course with no ratio still needs its instructor.
    expect(decideCourseAdmission(seat({ course: ssiOpenWater, crew: noCrew }))).toBe(
      "course_unstaffed",
    );
  });

  it("names staffing before the card, and the card before the ratio", () => {
    expect(decideCourseAdmission(seat({ course: advanced, crew: noCrew, diver: null }))).toBe(
      "course_unstaffed",
    );
    expect(
      decideCourseAdmission(
        seat({
          course: { ...dsd, minimumAge: 10 },
          studentsHeld: 2,
          diver: { cards: [], dateOfBirth: "2025-01-01" },
        }),
      ),
    ).toBe("course_min_age");
  });

  it("fails the card gate closed for a walk-in with no record", () => {
    expect(decideCourseAdmission(seat({ course: advanced, diver: null }))).toBe(
      "course_prerequisite",
    );
    expect(
      decideCourseAdmission(
        seat({
          course: advanced,
          actor: "public",
          diver: { cards: [card("advanced_open_water", "pending")], dateOfBirth: null },
        }),
      ),
    ).toBe("course_prerequisite");
  });

  it("asks a passenger beside the class none of the student gates", () => {
    expect(
      decideCourseAdmission(seat({ course: advanced, student: false, diver: null })),
    ).toBeNull();
    expect(decideCourseAdmission(seat({ course: dsd, student: false, studentsHeld: 50 }))).toBe(
      null,
    );
  });

  it("caps a DSD at two per instructor, whatever assistants are rostered", () => {
    const crew = { instructorCount: 1, assistantCount: 3 };
    expect(decideCourseAdmission(seat({ course: dsd, crew, studentsHeld: 1 }))).toBeNull();
    expect(decideCourseAdmission(seat({ course: dsd, crew, studentsHeld: 2 }))).toBe(
      "course_ratio_full",
    );
  });

  it("caps PADI Open Water at the entry-level ratio, and an assistant raises it", () => {
    expect(decideCourseAdmission(seat({ studentsHeld: 7 }))).toBeNull();
    expect(decideCourseAdmission(seat({ studentsHeld: 8 }))).toBe("course_ratio_full");
    const withDm = { instructorCount: 1, assistantCount: 1 };
    expect(decideCourseAdmission(seat({ crew: withDm, studentsHeld: 9 }))).toBeNull();
    expect(decideCourseAdmission(seat({ crew: withDm, studentsHeld: 10 }))).toBe(
      "course_ratio_full",
    );
  });

  it("refuses a student over the ratio even when the session is already over it", () => {
    // Day-of crew changes can leave a session above its ratio; no door adds to it.
    expect(decideCourseAdmission(seat({ course: dsd, studentsHeld: 6 }))).toBe("course_ratio_full");
  });

  /**
   * Issue #3769: an undo once asked the ratio alone, so a course with no ratio
   * (any non-PADI course, or PADI continuing education) took a student back
   * onto a session nobody was teaching. A ratio-gated session refused, but as
   * "ratio full", which sent the desk looking for a second instructor.
   */
  it("refuses a seat back on a session that has lost its last instructor, ratio or not", () => {
    expect(decideCourseAdmission(seat({ course: ssiOpenWater, crew: noCrew }))).toBe(
      "course_unstaffed",
    );
    expect(decideCourseAdmission(seat({ course: advanced, crew: noCrew }))).toBe(
      "course_unstaffed",
    );
    expect(decideCourseAdmission(seat({ course: dsd, crew: noCrew }))).toBe("course_unstaffed");
    expect(
      decideCourseAdmission(
        seat({ course: openWater, crew: { instructorCount: 0, assistantCount: 2 } }),
      ),
    ).toBe("course_unstaffed");
  });

  /**
   * Issue #3686: a card revoked since the sale, or a date of birth recorded
   * since, refuses the seat coming back as it refuses a new one.
   */
  it("asks a seat coming back the student's card and age again", () => {
    expect(
      decideCourseAdmission(seat({ course: advanced, diver: { cards: [], dateOfBirth: null } })),
    ).toBe("course_prerequisite");
    expect(
      decideCourseAdmission(
        seat({
          course: advanced,
          diver: { cards: [card("advanced_open_water", "verified")], dateOfBirth: "2025-01-01" },
        }),
      ),
    ).toBe("course_min_age");
  });

  /**
   * Adversarial sweep over a small grid of every input that moves the answer.
   * Three properties hold everywhere, so no reordering can quietly
   * break them.
   */
  describe("over every course, crew, head count and diver", () => {
    const courses: (CourseAdmissionRule | null)[] = [null, openWater, dsd, advanced, ssiOpenWater];
    const crews = [0, 1, 2].flatMap((instructorCount) =>
      [0, 1, 3].map((assistantCount) => ({ instructorCount, assistantCount })),
    );
    const divers: (CourseDiver | null)[] = [
      null,
      { cards: [], dateOfBirth: null },
      { cards: [card("open_water", "pending")], dateOfBirth: "2025-01-01" },
      qualified,
    ];
    const cases: CourseAdmissionInput[] = [];
    for (const course of courses)
      for (const crew of crews)
        for (const studentsHeld of [0, 1, 2, 4, 8, 10, 12, 30])
          for (const diver of divers)
            for (const student of [true, false])
              for (const actor of ["staff", "public"] as const)
                cases.push({
                  actor,
                  course,
                  crew,
                  studentsHeld,
                  diver,
                  student,
                  courseDate: "2031-06-14",
                });

    it("never seats a student at or past the crew's cap", () => {
      for (const c of cases) {
        if (!c.student || !c.course) continue;
        const cap = courseSeatCapacity(c.course, c.crew.instructorCount, c.crew.assistantCount);
        if (cap === null || c.studentsHeld < cap) continue;
        expect(decideCourseAdmission(c), JSON.stringify(c)).not.toBeNull();
      }
    });

    it("never seats anyone on a course session with no instructor", () => {
      for (const c of cases) {
        if (!c.course || c.crew.instructorCount > 0) continue;
        expect(decideCourseAdmission(c), JSON.stringify(c)).toBe("course_unstaffed");
      }
    });

    it("more crew never refuses a seat fewer crew admitted, and more students never admit one", () => {
      for (const c of cases) {
        if (decideCourseAdmission(c) !== null) continue;
        const moreCrew = [
          { ...c.crew, instructorCount: c.crew.instructorCount + 1 },
          { ...c.crew, assistantCount: c.crew.assistantCount + 1 },
        ];
        for (const crew of moreCrew) {
          expect(decideCourseAdmission({ ...c, crew }), JSON.stringify(c)).toBeNull();
        }
        if (c.studentsHeld > 0) {
          expect(
            decideCourseAdmission({ ...c, studentsHeld: c.studentsHeld - 1 }),
            JSON.stringify(c),
          ).toBeNull();
        }
      }
    });
  });
});

describe("courseStudentCap", () => {
  it("is null off a course, zero without an instructor, and the crew's ratio otherwise", () => {
    expect(courseStudentCap(null, noCrew)).toBeNull();
    expect(courseStudentCap(ssiOpenWater, noCrew)).toBe(0);
    expect(courseStudentCap(ssiOpenWater, oneInstructor)).toBeNull();
    expect(courseStudentCap(dsd, oneInstructor)).toBe(2);
    expect(courseStudentCap(openWater, { instructorCount: 1, assistantCount: 1 })).toBe(10);
  });
});

describe("courseEnrollmentRefusal", () => {
  const needsOpenWater = { minimumCertificationLevel: "open_water" as const, minimumAge: null };
  const tenAndUp = { minimumCertificationLevel: null, minimumAge: 10 };

  it("admits anyone to a course that asks for nothing", () => {
    const open = { minimumCertificationLevel: null, minimumAge: null };
    expect(
      courseEnrollmentRefusal({ actor: "public", course: open, diver: null, courseDate: null }),
    ).toBeNull();
  });

  it("fails the card gate closed: no record, no verified card, or a card below the level", () => {
    const refuse = (diver: Parameters<typeof courseEnrollmentRefusal>[0]["diver"]) =>
      courseEnrollmentRefusal({ actor: "staff", course: needsOpenWater, diver, courseDate: null });
    expect(refuse(null)).toBe("course_prerequisite");
    expect(refuse({ cards: [], dateOfBirth: null })).toBe("course_prerequisite");
    // A diver's own claim is pending, never verified, and reserves no seat.
    expect(refuse({ cards: [card("advanced_open_water", "pending")], dateOfBirth: null })).toBe(
      "course_prerequisite",
    );
    expect(
      refuse({ cards: [card("advanced_open_water", "verified")], dateOfBirth: null }),
    ).toBeNull();
  });

  it("refuses an under-age student at the staff door, on the day the course runs", () => {
    const at = (courseDate: string, actor: "staff" | "public" = "staff") =>
      courseEnrollmentRefusal({
        actor,
        course: tenAndUp,
        diver: { cards: [], dateOfBirth: "2021-06-15" },
        courseDate,
      });
    expect(at("2031-06-14")).toBe("course_min_age");
    expect(at("2031-06-15")).toBeNull();
    // The anonymous form never refuses on someone else's date of birth (H-20260724-certification-levels-agency-rules).
    expect(at("2031-06-14", "public")).toBeNull();
  });

  it("fails the age gate open when there is no date of birth or no record", () => {
    for (const diver of [null, { cards: [], dateOfBirth: null }]) {
      expect(
        courseEnrollmentRefusal({
          actor: "staff",
          course: tenAndUp,
          diver,
          courseDate: "2031-06-14",
        }),
      ).toBeNull();
    }
  });

  it("applies the card gate before the age gate", () => {
    expect(
      courseEnrollmentRefusal({
        actor: "staff",
        course: { minimumCertificationLevel: "open_water", minimumAge: 10 },
        diver: { cards: [], dateOfBirth: "2025-01-01" },
        courseDate: "2031-06-14",
      }),
    ).toBe("course_prerequisite");
  });
});

describe("courseRatioRefusal", () => {
  it("refuses at the ratio cap, and never without one", () => {
    expect(courseRatioRefusal(3, 4)).toBeNull();
    expect(courseRatioRefusal(4, 4)).toBe("course_ratio_full");
    expect(courseRatioRefusal(40, null)).toBeNull();
  });
});
