import { describe, expect, it } from "vitest";
import type { Certification } from "@/db/schema";
import {
  COURSE_GATES,
  type CourseAdmissionInput,
  type CourseAdmissionRule,
  type CourseAdmissionStrictness,
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

const sale = (
  over: Partial<Extract<CourseAdmissionInput, { strictness: "sale" }>> = {},
): CourseAdmissionInput => ({
  strictness: "sale",
  actor: "staff",
  course: openWater,
  student: true,
  crew: oneInstructor,
  studentsHeld: 0,
  diver: qualified,
  courseDate: "2031-06-14",
  ...over,
});
const restore = (
  over: Partial<Extract<CourseAdmissionInput, { strictness: "restore" }>> = {},
): CourseAdmissionInput => ({
  strictness: "restore",
  course: openWater,
  student: true,
  crew: oneInstructor,
  studentsHeld: 0,
  ...over,
});

describe("decideCourseAdmission", () => {
  it("asks nothing of a departure that is no course session", () => {
    expect(decideCourseAdmission(sale({ course: null, crew: noCrew, diver: null }))).toBeNull();
    expect(decideCourseAdmission(restore({ course: null, crew: noCrew, studentsHeld: 99 }))).toBe(
      null,
    );
  });

  it("refuses every seat on an unstaffed session at the sale, student or passenger", () => {
    expect(decideCourseAdmission(sale({ crew: noCrew }))).toBe("course_unstaffed");
    expect(decideCourseAdmission(sale({ crew: noCrew, student: false }))).toBe("course_unstaffed");
    // Assistants alone do not staff a course.
    expect(decideCourseAdmission(sale({ crew: { instructorCount: 0, assistantCount: 4 } }))).toBe(
      "course_unstaffed",
    );
    // A course with no ratio still needs its instructor.
    expect(decideCourseAdmission(sale({ course: ssiOpenWater, crew: noCrew }))).toBe(
      "course_unstaffed",
    );
  });

  it("names staffing before the card, and the card before the ratio", () => {
    expect(decideCourseAdmission(sale({ course: advanced, crew: noCrew, diver: null }))).toBe(
      "course_unstaffed",
    );
    expect(
      decideCourseAdmission(
        sale({
          course: { ...dsd, minimumAge: 10 },
          studentsHeld: 2,
          diver: { cards: [], dateOfBirth: "2025-01-01" },
        }),
      ),
    ).toBe("course_min_age");
  });

  it("fails the card gate closed for a walk-in with no record", () => {
    expect(decideCourseAdmission(sale({ course: advanced, diver: null }))).toBe(
      "course_prerequisite",
    );
    expect(
      decideCourseAdmission(
        sale({
          course: advanced,
          actor: "public",
          diver: { cards: [card("advanced_open_water", "pending")], dateOfBirth: null },
        }),
      ),
    ).toBe("course_prerequisite");
  });

  it("asks a passenger beside the class none of the student gates", () => {
    expect(
      decideCourseAdmission(sale({ course: advanced, student: false, diver: null })),
    ).toBeNull();
    expect(decideCourseAdmission(sale({ course: dsd, student: false, studentsHeld: 50 }))).toBe(
      null,
    );
    expect(decideCourseAdmission(restore({ course: dsd, student: false, studentsHeld: 50 }))).toBe(
      null,
    );
  });

  it("caps a DSD at two per instructor, whatever assistants are rostered", () => {
    const crew = { instructorCount: 1, assistantCount: 3 };
    expect(decideCourseAdmission(sale({ course: dsd, crew, studentsHeld: 1 }))).toBeNull();
    expect(decideCourseAdmission(sale({ course: dsd, crew, studentsHeld: 2 }))).toBe(
      "course_ratio_full",
    );
    expect(decideCourseAdmission(restore({ course: dsd, crew, studentsHeld: 2 }))).toBe(
      "course_ratio_full",
    );
  });

  it("caps PADI Open Water at the entry-level ratio, and an assistant raises it", () => {
    expect(decideCourseAdmission(sale({ studentsHeld: 7 }))).toBeNull();
    expect(decideCourseAdmission(sale({ studentsHeld: 8 }))).toBe("course_ratio_full");
    const withDm = { instructorCount: 1, assistantCount: 1 };
    expect(decideCourseAdmission(sale({ crew: withDm, studentsHeld: 9 }))).toBeNull();
    expect(decideCourseAdmission(sale({ crew: withDm, studentsHeld: 10 }))).toBe(
      "course_ratio_full",
    );
  });

  it("refuses a student over the ratio even when the session is already over it", () => {
    // Day-of crew changes can leave a session above its ratio; no door adds to it.
    expect(decideCourseAdmission(sale({ course: dsd, studentsHeld: 6 }))).toBe("course_ratio_full");
    expect(decideCourseAdmission(restore({ course: dsd, studentsHeld: 6 }))).toBe(
      "course_ratio_full",
    );
  });

  it("hands back a seat on an undo without re-asking staffing or enrollment", () => {
    // The diver passed the card gate when the seat was sold.
    expect(decideCourseAdmission(restore({ course: advanced }))).toBeNull();
    // An ungated session that lost its instructor still takes its seat back.
    expect(decideCourseAdmission(restore({ course: ssiOpenWater, crew: noCrew }))).toBeNull();
  });

  it("refuses an undo onto a ratio-gated session that has lost its last instructor", () => {
    // A seat cannot be handed back to a session that could not sell it.
    expect(decideCourseAdmission(restore({ course: dsd, crew: noCrew }))).toBe("course_ratio_full");
    expect(
      decideCourseAdmission(
        restore({ course: openWater, crew: { instructorCount: 0, assistantCount: 2 } }),
      ),
    ).toBe("course_ratio_full");
  });

  /**
   * Adversarial sweep over a small grid of every input that moves the answer.
   * Three properties hold everywhere, so no ordering or table edit can quietly
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
    const cases: Extract<CourseAdmissionInput, { strictness: "sale" }>[] = [];
    for (const course of courses)
      for (const crew of crews)
        for (const studentsHeld of [0, 1, 2, 4, 8, 10, 12, 30])
          for (const diver of divers)
            for (const student of [true, false])
              for (const actor of ["staff", "public"] as const)
                cases.push({
                  strictness: "sale",
                  actor,
                  course,
                  crew,
                  studentsHeld,
                  diver,
                  student,
                  courseDate: "2031-06-14",
                });

    it("an undo is never stricter than the sale", () => {
      for (const c of cases) {
        if (decideCourseAdmission(c) !== null) continue;
        expect(decideCourseAdmission({ ...c, strictness: "restore" }), JSON.stringify(c)).toBe(
          null,
        );
      }
    });

    it("never seats a student at or past the crew's cap, at any strictness", () => {
      for (const c of cases) {
        if (!c.student || !c.course) continue;
        const cap = courseSeatCapacity(c.course, c.crew.instructorCount, c.crew.assistantCount);
        if (cap === null || c.studentsHeld < cap) continue;
        expect(decideCourseAdmission(c), JSON.stringify(c)).not.toBeNull();
        expect(decideCourseAdmission({ ...c, strictness: "restore" }), JSON.stringify(c)).not.toBe(
          null,
        );
      }
    });

    it("never sells a seat on a course session with no instructor", () => {
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

describe("COURSE_GATES", () => {
  it("asks no gate at the undo that the sale does not ask", () => {
    for (const strictness of Object.keys(COURSE_GATES) as CourseAdmissionStrictness[]) {
      for (const [gate, asked] of Object.entries(COURSE_GATES[strictness])) {
        if (asked) expect(COURSE_GATES.sale[gate as keyof typeof COURSE_GATES.sale]).toBe(true);
      }
    }
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
