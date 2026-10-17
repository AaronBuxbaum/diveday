import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import { COURSE_FORMS_BLOCK_BOARDING, type RequiredCourseForm } from "./course-forms";
import { aboardBlockerKind, BLOCKER_CATEGORY, calculateReadiness } from "./readiness";
import {
  courseInstructorsAboard,
  type TrainingDiveCourse,
  type TrainingMarkEnrollment,
  type TrainingMarkSeat,
  type TrainingMarkState,
  trainingDiveLevel,
  trainingDiveRequiredLevel,
  trainingMarkProblem,
} from "./training-mark";

const PERSON = "00000000-0000-4000-8000-0000000000a1";
const SHOP = "00000000-0000-4000-8000-000000000001";
const CHARTER_SEAT = "00000000-0000-4000-8000-0000000000c1";
const ENROLLMENT = "00000000-0000-4000-8000-0000000000e1";
const departs = new Date("2026-10-20T13:00:00.000Z");

const seat: TrainingMarkSeat = {
  personId: PERSON,
  participantType: "diver",
  onCourseSession: false,
  departureStartsAt: departs,
};
const enrollment: TrainingMarkEnrollment = {
  personId: PERSON,
  status: "booked",
  identityHeld: false,
  participantType: "diver",
  courseId: "course-aow",
  departureCanceled: false,
  sessionEndsAt: new Date("2026-10-21T22:00:00.000Z"),
};

describe("trainingMarkProblem — whether a training mark stands", () => {
  it("stands for the same diver's live course seat whose session runs past the departure", () => {
    expect(trainingMarkProblem(seat, enrollment)).toBeNull();
    // Ending the moment the boat leaves still counts the dive.
    expect(trainingMarkProblem(seat, { ...enrollment, sessionEndsAt: departs })).toBeNull();
  });

  it("still stands for a checked-in or no-show course seat: neither unenrolls the diver", () => {
    expect(trainingMarkProblem(seat, { ...enrollment, status: "checked_in" })).toBeNull();
    expect(trainingMarkProblem(seat, { ...enrollment, status: "no_show" })).toBeNull();
  });

  it.each([
    ["seat_on_course_session", { ...seat, onCourseSession: true }, enrollment],
    ["seat_not_diving", { ...seat, participantType: "snorkeler" as const }, enrollment],
    ["seat_not_diving", { ...seat, participantType: "rider" as const }, enrollment],
    ["enrollment_missing", seat, null],
    ["enrollment_other_person", seat, { ...enrollment, personId: "someone-else" }],
    ["enrollment_canceled", seat, { ...enrollment, status: "cancelled" as const }],
    ["enrollment_canceled", seat, { ...enrollment, departureCanceled: true }],
    ["enrollment_held", seat, { ...enrollment, identityHeld: true }],
    ["enrollment_not_diving", seat, { ...enrollment, participantType: "rider" as const }],
    ["not_a_course_session", seat, { ...enrollment, courseId: null }],
    [
      "ends_before_departure",
      seat,
      { ...enrollment, sessionEndsAt: new Date(departs.getTime() - 1) },
    ],
  ] as const)("refuses with %s", (problem, markedSeat, target) => {
    expect(trainingMarkProblem(markedSeat, target)).toBe(problem);
  });

  it("names the seat's own problem before the enrollment's: a snorkeler marked onto a stranger's seat", () => {
    expect(
      trainingMarkProblem(
        { ...seat, participantType: "snorkeler" },
        { ...enrollment, personId: "someone-else" },
      ),
    ).toBe("seat_not_diving");
  });
});

describe("calculateReadiness — a seat carrying a training mark", () => {
  const requirement = {
    requiresWaiver: true,
    requiredSpecialties: [],
  } as unknown as TripRequirement;
  const now = new Date("2026-10-18T12:00:00.000Z");
  const waiver = {
    status: "completed",
    signedAt: now,
    completedAt: now,
    expiresAt: new Date("2027-10-15T00:00:00.000Z"),
  } as WaiverRecord;
  const base = {
    requirement,
    waiver,
    certifications: [],
    now,
    timezone: "America/New_York",
    participantType: "diver" as const,
  };
  const form: RequiredCourseForm = {
    shopId: SHOP,
    formId: "form-adventure",
    versionId: "adventure-v1",
    version: 1,
    title: "Adventure dive statement",
    position: 0,
  };
  const signedOn = (bookingId: string) => ({
    shopId: SHOP,
    bookingId,
    personId: PERSON,
    formVersionId: form.versionId,
    signedAt: now,
    guardianSignedAt: null,
    paperSignedOn: null,
  });
  const enrollmentForms = (signatures: ReturnType<typeof signedOn>[]) => ({
    shopId: SHOP,
    bookingId: ENROLLMENT,
    personId: PERSON,
    required: [form],
    signatures,
    timezone: "America/New_York",
  });

  it("is blocked until the enrollment's form is signed, then ready", () => {
    expect(calculateReadiness({ ...base, courseForms: enrollmentForms([]) }).blockers).toEqual([
      { code: "course_form_unsigned", params: { formTitle: form.title } },
    ]);
    expect(
      calculateReadiness({ ...base, courseForms: enrollmentForms([signedOn(ENROLLMENT)]) }),
    ).toEqual({ status: "ready", blockers: [] });
  });

  it("is not cleared by a record written against the charter seat instead of the enrollment", () => {
    const result = calculateReadiness({
      ...base,
      courseForms: enrollmentForms([signedOn(CHARTER_SEAT)]),
    });
    expect(result.status).toBe(COURSE_FORMS_BLOCK_BOARDING ? "blocked" : "ready");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      COURSE_FORMS_BLOCK_BOARDING ? ["course_form_unsigned"] : [],
    );
  });

  it("is never cleared by a signature on another course's enrollment", () => {
    const result = calculateReadiness({
      ...base,
      courseForms: enrollmentForms([
        { ...signedOn("00000000-0000-4000-8000-0000000000e2"), formVersionId: form.versionId },
      ]),
    });
    expect(result.blockers.map((blocker) => blocker.code)).toContain("course_form_unsigned");
  });

  it("raises training_mark_invalid for a mark that does not stand, whatever else is clear", () => {
    const result = calculateReadiness({ ...base, trainingMarkInvalid: true });
    expect(result).toEqual({ status: "blocked", blockers: [{ code: "training_mark_invalid" }] });
  });

  it("files training_mark_invalid as the desk's setup, and as unknown at the rail", () => {
    expect(BLOCKER_CATEGORY.training_mark_invalid).toBe("setup");
    expect(aboardBlockerKind([{ code: "training_mark_invalid" }])).toBe("unknown");
  });
});

describe("courseInstructorsAboard — the course's instructor on this departure (issue #2731)", () => {
  const teacher = { personId: "teacher", shopRoles: ["instructor"] };
  const other = { personId: "other", shopRoles: ["instructor"] };

  it("is the session's instructor rostered as an instructor on the departure", () => {
    expect(
      courseInstructorsAboard(
        [{ ...teacher, tripRole: "instructor" }],
        [{ ...teacher, tripRole: "instructor" }],
      ),
    ).toBe(1);
    // No per-trip role reads the standing role, as the ratio does.
    expect(courseInstructorsAboard([teacher], [teacher])).toBe(1);
    // Two of the course's instructors aboard count two, for the ratio.
    expect(courseInstructorsAboard([teacher, other], [teacher, other])).toBe(2);
  });

  it.each([
    ["another course's instructor", [teacher], [other]],
    [
      "the teacher as the departure's captain",
      [teacher],
      [{ ...teacher, tripRole: "captain" as const }],
    ],
    [
      "the teacher as the departure's divemaster",
      [teacher],
      [{ ...teacher, tripRole: "divemaster" as const }],
    ],
    [
      "somebody who only drives the session's boat",
      [{ ...teacher, tripRole: "captain" as const }],
      [teacher],
    ],
    [
      "a divemaster on both",
      [{ personId: "dm", shopRoles: ["divemaster"] }],
      [{ personId: "dm", shopRoles: ["divemaster"] }],
    ],
    ["nobody on the departure", [teacher], []],
  ])("is not %s", (_name, sessionCrew, departureCrew) => {
    expect(courseInstructorsAboard(sessionCrew, departureCrew)).toBe(0);
  });
});

describe("trainingDiveLevel — the course a marked dive answers to (issue #2731)", () => {
  const course: TrainingDiveCourse = {
    minimumLevel: "open_water",
    certifiesLevel: "advanced_open_water",
    intro: false,
  };
  const standing: TrainingMarkState = {
    valid: true,
    enrollmentBookingId: ENROLLMENT,
    enrollmentTripId: "session",
    enrollmentMinorDeclared: false,
    enrollmentCourseTitle: "Advanced Open Water",
    enrollmentCourse: course,
    courseInstructorAboard: true,
  };

  it("takes the course, with the mark standing and its instructor aboard", () => {
    expect(trainingDiveLevel(standing)).toEqual(course);
  });

  it("keeps the departure's level with no mark, a mark that fell, no instructor, or no course row", () => {
    expect(trainingDiveLevel(undefined)).toBeNull();
    expect(trainingDiveLevel({ valid: false, problem: "enrollment_canceled" })).toBeNull();
    expect(trainingDiveLevel({ ...standing, courseInstructorAboard: false })).toBeNull();
    expect(trainingDiveLevel({ ...standing, enrollmentCourse: undefined })).toBeNull();
  });
});

describe("trainingDiveRequiredLevel — lowers only as far as the course certifies (issue #2731)", () => {
  const aow: TrainingDiveCourse = {
    minimumLevel: "open_water",
    certifiesLevel: "advanced_open_water",
    intro: false,
  };

  it("lowers an AOW departure to the course's minimum", () => {
    expect(trainingDiveRequiredLevel("advanced_open_water", aow)).toBe("open_water");
  });

  it("never lowers a level above what the course certifies", () => {
    expect(trainingDiveRequiredLevel("rescue", aow)).toBe("rescue");
    expect(trainingDiveRequiredLevel("divemaster", aow)).toBe("divemaster");
  });

  it("never lowers for an intro session, a course certifying nothing, or one with no minimum", () => {
    const dsd: TrainingDiveCourse = { minimumLevel: null, certifiesLevel: null, intro: true };
    expect(trainingDiveRequiredLevel("open_water", dsd)).toBe("open_water");
    expect(
      trainingDiveRequiredLevel("open_water", { ...dsd, minimumLevel: "open_water", intro: true }),
    ).toBe("open_water");
    expect(trainingDiveRequiredLevel("advanced_open_water", { ...aow, certifiesLevel: null })).toBe(
      "advanced_open_water",
    );
    expect(trainingDiveRequiredLevel("advanced_open_water", { ...aow, minimumLevel: null })).toBe(
      "advanced_open_water",
    );
  });

  it("never raises a level, and never invents one", () => {
    const rescueCourse: TrainingDiveCourse = {
      minimumLevel: "advanced_open_water",
      certifiesLevel: "rescue",
      intro: false,
    };
    expect(trainingDiveRequiredLevel("open_water", rescueCourse)).toBe("open_water");
    expect(trainingDiveRequiredLevel(null, aow)).toBeNull();
  });
});
