import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import { COURSE_FORMS_BLOCK_BOARDING, type RequiredCourseForm } from "./course-forms";
import { aboardBlockerKind, BLOCKER_CATEGORY, calculateReadiness } from "./readiness";
import {
  courseInstructorsAboard,
  mixedTrainingDepthAdvisory,
  type TrainingDiveCourse,
  type TrainingMarkEnrollment,
  type TrainingMarkSeat,
  type TrainingMarkState,
  trainingDiveAsksNoCard,
  trainingDiveAsksNoCardForSite,
  trainingDiveLevel,
  trainingDiveRequiredLevel,
  trainingMarkProblem,
  trainingRoom,
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

  it("names the no-card case only when the lowering reaches nothing", () => {
    const ow: TrainingDiveCourse = {
      minimumLevel: null,
      certifiesLevel: "open_water",
      intro: false,
    };
    const level = (minimumCertificationLevel: "open_water" | "advanced_open_water" | null) => ({
      minimumCertificationLevel,
      requiredSpecialties: [],
      requiresNitrox: false,
    });
    expect(trainingDiveAsksNoCard(level("open_water"), ow)).toBe(true);
    expect(trainingDiveAsksNoCard(level("advanced_open_water"), ow)).toBe(false);
    expect(trainingDiveAsksNoCard(level("advanced_open_water"), aow)).toBe(false);
    expect(trainingDiveAsksNoCard(level(null), ow)).toBe(false);
    expect(trainingDiveAsksNoCard(level("open_water"), null)).toBe(false);
  });

  it("never says no card is asked when the trip itself requires one", () => {
    const course: TrainingDiveCourse = {
      minimumLevel: null,
      certifiesLevel: "open_water",
      intro: false,
    };
    const level = {
      minimumCertificationLevel: "open_water" as const,
      requiredSpecialties: [],
      requiresNitrox: false,
    };
    const empty = { ...level, minimumCertificationLevel: null };
    expect(trainingDiveAsksNoCardForSite(empty, level, course)).toBe(true);
    expect(trainingDiveAsksNoCardForSite(level, level, course)).toBe(false);
    expect(trainingDiveAsksNoCardForSite({ ...empty, requiresNitrox: true }, level, course)).toBe(
      false,
    );
    expect(
      trainingDiveAsksNoCardForSite({ ...empty, requiredSpecialties: ["wreck"] }, level, course),
    ).toBe(false);
  });

  it("still asks a card when the departure also asks nitrox or a specialty", () => {
    const ow: TrainingDiveCourse = {
      minimumLevel: null,
      certifiesLevel: "open_water",
      intro: false,
    };
    const base = { minimumCertificationLevel: "open_water" as const };
    expect(
      trainingDiveAsksNoCard({ ...base, requiredSpecialties: [], requiresNitrox: true }, ow),
    ).toBe(false);
    expect(
      trainingDiveAsksNoCard(
        { ...base, requiredSpecialties: ["wreck"], requiresNitrox: false },
        ow,
      ),
    ).toBe(false);
  });

  it("lowers an AOW departure to the course's minimum", () => {
    expect(trainingDiveRequiredLevel("advanced_open_water", aow)).toBe("open_water");
  });

  it("never lowers a level above what the course certifies", () => {
    expect(trainingDiveRequiredLevel("rescue", aow)).toBe("rescue");
    expect(trainingDiveRequiredLevel("divemaster", aow)).toBe("divemaster");
  });

  it("asks no card of a course with no minimum for a level it certifies, and no more", () => {
    const ow: TrainingDiveCourse = {
      minimumLevel: null,
      certifiesLevel: "open_water",
      intro: false,
    };
    expect(trainingDiveRequiredLevel("open_water", ow)).toBeNull();
    // Past what it certifies the departure's level stands.
    expect(trainingDiveRequiredLevel("advanced_open_water", ow)).toBe("advanced_open_water");
    expect(trainingDiveRequiredLevel("rescue", ow)).toBe("rescue");
  });

  it("never lowers for an intro session or a course certifying nothing", () => {
    const dsd: TrainingDiveCourse = { minimumLevel: null, certifiesLevel: null, intro: true };
    expect(trainingDiveRequiredLevel("open_water", dsd)).toBe("open_water");
    expect(
      trainingDiveRequiredLevel("open_water", { ...dsd, minimumLevel: "open_water", intro: true }),
    ).toBe("open_water");
    expect(trainingDiveRequiredLevel("advanced_open_water", { ...aow, certifiesLevel: null })).toBe(
      "advanced_open_water",
    );
    expect(
      trainingDiveRequiredLevel("open_water", { ...aow, minimumLevel: null, intro: true }),
    ).toBe("open_water");
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

describe("trainingRoom — conservative instructor capacity across sessions (review 2026-10-17)", () => {
  const teacher = {
    personId: "teacher",
    shopRoles: ["instructor"],
    tripRole: "instructor" as const,
  };
  const teacher2 = {
    personId: "teacher2",
    shopRoles: ["instructor"],
    tripRole: "instructor" as const,
  };
  const dm = { personId: "dm", shopRoles: ["divemaster"], tripRole: "divemaster" as const };
  const entry = {
    baseStudentsPerInstructor: 8,
    assistantBonusPerInstructor: 2,
    maxStudentsPerInstructor: 12,
  };
  const seats = (session: string, count: number, from = 0) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${session}-${from + i}`,
      sessionTripId: session,
      rule: entry,
    }));
  const crews = new Map([
    ["s1", [teacher]],
    ["s2", [teacher]],
  ]);

  it("counts one instructor's seats across two sessions, not per session", () => {
    const room = trainingRoom({
      marked: [...seats("s1", 5), ...seats("s2", 5)],
      sessionCrew: crews,
      departureCrew: [teacher],
    });
    expect(room.seated.size).toBe(8);
    expect(room.seated.has("s2-2")).toBe(true);
    expect(room.seated.has("s2-3")).toBe(false);
  });

  it("seats nobody whose course has no known ratio, or with no instructor aboard", () => {
    const noRule = [{ id: "a", sessionTripId: "s1", rule: null }];
    expect(
      trainingRoom({ marked: noRule, sessionCrew: crews, departureCrew: [teacher] }).seated.size,
    ).toBe(0);
    expect(
      trainingRoom({ marked: seats("s1", 1), sessionCrew: crews, departureCrew: [] }).seated.size,
    ).toBe(0);
  });

  it("withholds modeled coverage when an instructor may also teach an unmodeled seat", () => {
    const unknown = { id: "deep", sessionTripId: "s1", rule: null };
    for (const marked of [
      [unknown, ...seats("s2", 8)],
      [...seats("s2", 8), unknown],
    ]) {
      const room = trainingRoom({ marked, sessionCrew: crews, departureCrew: [teacher] });
      expect(room.seated.size).toBe(0);
      expect(room.spare).toBe(false);
    }
    expect(
      trainingRoom({
        marked: [unknown],
        candidate: { id: "new", sessionTripId: "s2", rule: entry },
        sessionCrew: crews,
        departureCrew: [teacher],
      }).spare,
    ).toBe(false);
    // An unmodeled candidate cannot be offered by unseating an existing mark.
    expect(
      trainingRoom({
        marked: seats("s2", 1),
        candidate: unknown,
        sessionCrew: crews,
        departureCrew: [teacher],
      }).spare,
    ).toBe(false);
    // Separate session rosters do not prove the underwater groups are separate.
    const split = trainingRoom({
      marked: [unknown, ...seats("s2", 8)],
      sessionCrew: new Map([
        ["s1", [teacher]],
        ["s2", [teacher2]],
      ]),
      departureCrew: [teacher, teacher2],
    });
    expect(split.seated.size).toBe(0);
  });

  it("keeps the instructor base cap with one or several assistants aboard", () => {
    const withDm = trainingRoom({
      marked: seats("s1", 12),
      sessionCrew: crews,
      departureCrew: [teacher, dm],
    });
    expect(withDm.seated.size).toBe(8);
    const many = trainingRoom({
      marked: seats("s1", 14),
      sessionCrew: crews,
      departureCrew: [teacher, dm, { ...dm, personId: "dm2" }, { ...dm, personId: "dm3" }],
    });
    expect(many.seated.size).toBe(8);
  });

  it("does not spread one unassigned assistant across two instructors at 9 seats each", () => {
    const twoCrews = new Map([
      ["s1", [teacher]],
      ["s2", [teacher2]],
    ]);
    const room = trainingRoom({
      marked: [...seats("s1", 9), ...seats("s2", 9)],
      sessionCrew: twoCrews,
      departureCrew: [teacher, teacher2, dm],
    });

    expect(room.seated.size).toBe(16);
    expect([...room.overRatio].sort()).toEqual(["s1-8", "s2-8"]);
  });

  it("says whether one more seat fits, and never by unseating a marked one", () => {
    const candidate = { id: "new", sessionTripId: "s2", rule: entry };
    const full = trainingRoom({
      marked: seats("s1", 8),
      candidate,
      sessionCrew: crews,
      departureCrew: [teacher],
    });
    expect(full.spare).toBe(false);
    const room = trainingRoom({
      marked: seats("s1", 7),
      candidate,
      sessionCrew: crews,
      departureCrew: [teacher],
    });
    expect(room.spare).toBe(true);
    // A second instructor on the departure only counts for the session they teach.
    const two = new Map([
      ["s1", [teacher]],
      ["s2", [teacher2]],
    ]);
    expect(
      trainingRoom({
        marked: seats("s1", 8),
        candidate,
        sessionCrew: two,
        departureCrew: [teacher, teacher2],
      }).spare,
    ).toBe(true);
  });

  it("a DSD seat on an instructor caps later Open Water seats at the DSD ratio", () => {
    const dsd = {
      baseStudentsPerInstructor: 2,
      assistantBonusPerInstructor: 0,
      maxStudentsPerInstructor: 2,
    };
    const dsdSeat = { id: "A", sessionTripId: "s1", rule: dsd };
    const ow = ["B", "C", "D", "E", "F", "G", "H"].map((id) => ({
      id,
      sessionTripId: "s2",
      rule: entry,
    }));
    const room = trainingRoom({
      marked: [dsdSeat, ...ow],
      sessionCrew: crews,
      departureCrew: [teacher],
    });
    expect(room.seated.has("A")).toBe(true);
    expect(ow.filter((seat) => room.seated.has(seat.id))).toHaveLength(1);
    expect(room.seated.size).toBe(2);
    // A later, tighter DSD mark is considered before looser Open Water marks.
    const reversed = trainingRoom({
      marked: [...ow, dsdSeat],
      sessionCrew: crews,
      departureCrew: [teacher],
    });
    expect([...reversed.seated].sort()).toEqual([...room.seated].sort());
    expect(reversed.seated.has("A")).toBe(true);
    expect(reversed.seated.size).toBe(2);
  });

  it("applies a later DSD mark's tighter cap before deciding which Open Water marks clear", () => {
    const dsd = {
      baseStudentsPerInstructor: 2,
      assistantBonusPerInstructor: 0,
      maxStudentsPerInstructor: 2,
    };
    const dsdSeat = { id: "dsd", sessionTripId: "s1", rule: dsd };
    const owSeats = seats("s2", 7);
    const room = trainingRoom({
      marked: [...owSeats, dsdSeat],
      sessionCrew: crews,
      departureCrew: [teacher],
    });
    const owCourse: TrainingDiveCourse = {
      minimumLevel: null,
      certifiesLevel: "open_water",
      intro: false,
    };
    const stateFor = (id: string): TrainingMarkState => ({
      valid: true,
      enrollmentBookingId: id,
      enrollmentTripId: "s2",
      enrollmentMinorDeclared: false,
      enrollmentCourseTitle: "Open Water Diver",
      enrollmentCourse: owCourse,
      courseInstructorAboard: room.seated.has(id),
    });
    const readinessFor = (id: string) =>
      calculateReadiness({
        requirement: {
          requiresWaiver: false,
          minimumCertificationLevel: null,
          requiredSpecialties: [],
          requiresNitrox: false,
        } as unknown as TripRequirement,
        siteRequirement: {
          minimumCertificationLevel: "open_water",
          requiredSpecialties: [],
          requiresNitrox: false,
        },
        waiver: null,
        certifications: [],
        participantType: "diver",
        trainingDive: trainingDiveLevel(stateFor(id)),
        now: new Date("2026-10-18T12:00:00.000Z"),
        timezone: "UTC",
      });

    // The tighter-marked DSD seat must take precedence over seven older OW
    // marks; only one OW seat can share that instructor's conservative cap.
    expect(room.seated.has("dsd")).toBe(true);
    expect(room.seated.size).toBe(2);
    expect(readinessFor("s2-0").status).toBe("ready");
    expect(readinessFor("s2-1").status).toBe("blocked");
  });

  it("keeps the DSD base cap across an instructor's mixed marked seats (#2830)", () => {
    const dsd = {
      baseStudentsPerInstructor: 2,
      assistantBonusPerInstructor: 0,
      maxStudentsPerInstructor: 2,
    };
    const dsdSeat = { id: "A", sessionTripId: "s1", rule: dsd };
    const ow = seats("s2", 6);
    // Actual underwater groups are not recorded, so this resolver gives no assistant bonus.
    const withDm = trainingRoom({
      marked: [dsdSeat, ...ow],
      sessionCrew: crews,
      departureCrew: [teacher, dm],
    });
    expect(withDm.seated.has("A")).toBe(true);
    expect(withDm.seated.size).toBe(2);
    expect([...withDm.overRatio].sort()).toEqual(["s2-1", "s2-2", "s2-3", "s2-4", "s2-5"]);
    // And no candidate Open Water seat is offered as spare once the DSD seat is on.
    const offer = trainingRoom({
      marked: [dsdSeat, ...seats("s2", 1)],
      candidate: { id: "new", sessionTripId: "s2", rule: entry },
      sessionCrew: crews,
      departureCrew: [teacher, dm],
    });
    expect(offer.spare).toBe(false);
    // A second instructor teaching only the Open Water session takes those seats at their own ratio.
    const split = trainingRoom({
      marked: [dsdSeat, ...ow],
      sessionCrew: new Map([
        ["s1", [teacher]],
        ["s2", [teacher2]],
      ]),
      departureCrew: [teacher, teacher2],
    });
    expect(split.seated.size).toBe(7);
  });

  it("tells a seat over the ratio from one with no instructor aboard", () => {
    const room = trainingRoom({
      marked: seats("s1", 9),
      sessionCrew: new Map([
        ["s1", [teacher]],
        ["s3", []],
      ]),
      departureCrew: [teacher],
    });
    expect(room.seated.size).toBe(8);
    expect([...room.overRatio]).toEqual(["s1-8"]);
    const none = trainingRoom({
      marked: [{ id: "x", sessionTripId: "s3", rule: entry }],
      sessionCrew: new Map([["s3", []]]),
      departureCrew: [teacher],
    });
    expect(none.overRatio.size).toBe(0);
  });
});

describe("mixed training depth advisory", () => {
  it("asks staff to check depth when introductory and other course students share a departure", () => {
    expect(mixedTrainingDepthAdvisory([{ intro: true }, { intro: false }])).toBe(true);
    expect(mixedTrainingDepthAdvisory([{ intro: false }, { intro: true }])).toBe(true);
  });

  it("prompts on older saved course marks whose type is unknown", () => {
    expect(mixedTrainingDepthAdvisory([{}, {}])).toBe(true);
    expect(mixedTrainingDepthAdvisory([{ intro: true }, {}])).toBe(true);
    expect(mixedTrainingDepthAdvisory([{ intro: false }, {}])).toBe(true);
    expect(mixedTrainingDepthAdvisory([{}])).toBe(false);
  });

  it("does not infer a mixed departure from an intro or other course alone", () => {
    expect(mixedTrainingDepthAdvisory([])).toBe(false);
    expect(mixedTrainingDepthAdvisory([{ intro: true }, { intro: true }])).toBe(false);
    expect(mixedTrainingDepthAdvisory([{ intro: false }, { intro: false }])).toBe(false);
  });
});
