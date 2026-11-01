import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import {
  COURSE_FORMS_BLOCK_BOARDING,
  type CourseFormSignature,
  courseFormAwaitingText,
  courseFormGaps,
  courseFormTextChanged,
  fillCourseFormText,
  outstandingCourseForms,
  type RequiredCourseForm,
} from "./course-forms";
import type { GuardianSigner } from "./guardian";
import { aboardBlockerKind, BLOCKER_CATEGORY, calculateReadiness } from "./readiness";
import { buildDiverChecklist } from "./readiness-summary";

const SHOP = "00000000-0000-4000-8000-000000000001";
const OTHER_SHOP = "00000000-0000-4000-8000-000000000002";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const OTHER_BOOKING = "00000000-0000-4000-8000-0000000000b2";
const PERSON = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PERSON = "00000000-0000-4000-8000-0000000000a2";

const release: RequiredCourseForm = {
  shopId: SHOP,
  formId: "form-release",
  versionId: "release-v2",
  version: 2,
  title: "Liability release",
  position: 0,
};
const practices: RequiredCourseForm = {
  shopId: SHOP,
  formId: "form-practices",
  versionId: "practices-v1",
  version: 1,
  title: "Safe diving practices",
  position: 1,
};

const now = new Date("2026-10-08T15:00:00.000Z");
const adult = { dateOfBirth: "1990-01-01", minorDeclared: false, timezone: "America/New_York" };
const minor = { dateOfBirth: "2012-05-01", minorDeclared: false, timezone: "America/New_York" };

function signed(overrides: Partial<CourseFormSignature> = {}): CourseFormSignature {
  return {
    shopId: SHOP,
    bookingId: BOOKING,
    personId: PERSON,
    formVersionId: release.versionId,
    signedAt: now,
    guardianSignedAt: null,
    ...overrides,
  };
}

function owed(
  signatures: CourseFormSignature[],
  signer: GuardianSigner = adult,
  required = [release],
) {
  return outstandingCourseForms({
    shopId: SHOP,
    bookingId: BOOKING,
    personId: PERSON,
    required,
    signatures,
    signer,
  }).map((form) => form.formId);
}

describe("outstandingCourseForms — which forms an enrollment still owes", () => {
  it("owes every required form when nothing is signed, in the course's order", () => {
    expect(owed([], adult, [practices, release])).toEqual(["form-release", "form-practices"]);
  });

  it("clears a form signed on this booking at its current version", () => {
    expect(owed([signed()])).toEqual([]);
  });

  it("still owes a form signed against an older version", () => {
    expect(owed([signed({ formVersionId: "release-v1" })])).toEqual(["form-release"]);
  });

  it("still owes a form signed by somebody else on this booking", () => {
    expect(owed([signed({ personId: OTHER_PERSON })])).toEqual(["form-release"]);
  });

  it("still owes a form signed on another enrollment (per booking, never carried)", () => {
    expect(owed([signed({ bookingId: OTHER_BOOKING })])).toEqual(["form-release"]);
  });

  it("still owes a form whose signature another shop holds", () => {
    expect(owed([signed({ shopId: OTHER_SHOP })])).toEqual(["form-release"]);
  });

  it("owes, never skips, a required form that belongs to another shop", () => {
    const foreign = { ...release, shopId: OTHER_SHOP };
    expect(owed([signed()], adult, [foreign])).toEqual(["form-release"]);
  });

  it("still owes a minor's form signed without a guardian", () => {
    expect(owed([signed()], minor)).toEqual(["form-release"]);
  });

  it("clears a minor's form the guardian co-signed", () => {
    expect(owed([signed({ guardianSignedAt: now })], minor)).toEqual([]);
  });

  it("measures the age on the day the form was signed, not today", () => {
    // Signed the day before an eighteenth birthday, alone: still owed after it.
    const turning = { dateOfBirth: "2008-10-08", minorDeclared: false, timezone: "UTC" };
    const dayBefore = new Date("2026-10-07T12:00:00.000Z");
    expect(owed([signed({ signedAt: dayBefore })], turning)).toEqual(["form-release"]);
  });

  it("reads an unknown date of birth as an adult (H-20260724-certification-levels-agency-rules's fail-open)", () => {
    expect(
      owed([signed()], { dateOfBirth: null, minorDeclared: false, timezone: "UTC" } as never),
    ).toEqual([]);
  });

  it("asks for the guardian on a seat its booker marked Under 18 with no date on file", () => {
    expect(
      owed([signed()], { dateOfBirth: null, minorDeclared: true, timezone: "UTC" } as never),
    ).toEqual(["form-release"]);
  });

  it("clears a form signed at the version a started session began with", () => {
    // The shop edited the form mid-course; the student signed the words in
    // force on the first morning, and that still counts for this session.
    const midCourse = { ...release, alsoAccepted: ["release-v1"] };
    expect(owed([signed({ formVersionId: "release-v1" })], adult, [midCourse])).toEqual([]);
  });

  it("measures a paper copy's age on the date written on it, not the day it was recorded", () => {
    const turning = { dateOfBirth: "2008-10-08", minorDeclared: false, timezone: "UTC" };
    // Recorded today, the student is eighteen; on the paper's date they were not.
    expect(owed([signed({ paperSignedOn: "2026-10-01" })], turning)).toEqual(["form-release"]);
    expect(owed([signed({ paperSignedOn: "2026-10-08" })], turning)).toEqual([]);
  });
});

/**
 * **A form for the youngest students only** (issue #2265, Aaron 2026-10-13):
 * PADI's Youth Diving acknowledgment (10615) is asked of a student aged 11
 * or younger on the session's first day, in the shop's zone, and of nobody
 * older. A child whose birthday the shop does not know is asked.
 */
describe("outstandingCourseForms — a form bound to an age", () => {
  const youth: RequiredCourseForm = {
    shopId: SHOP,
    formId: "form-youth",
    versionId: "youth-v1",
    version: 1,
    title: "Youth Diving: Responsibility and Risks Acknowledgment",
    position: 2,
    maxAgeYears: 11,
    sessionFirstDay: "2026-10-20",
  };
  const born = (dateOfBirth: string | null) => ({ ...adult, dateOfBirth });

  it("asks a student who turns 12 the day after the session starts", () => {
    expect(owed([], born("2014-10-21"), [youth])).toEqual([youth.formId]);
  });

  it("does not ask one who turned 12 that very morning, nor one the day before", () => {
    expect(owed([], born("2014-10-20"), [youth])).toEqual([]);
    expect(owed([], born("2014-10-19"), [youth])).toEqual([]);
  });

  it("never asks an adult on the same course, and still asks them the course's other forms", () => {
    expect(owed([], adult, [release, youth])).toEqual([release.formId]);
  });

  it("asks a student whose birthday the shop does not know", () => {
    expect(owed([], born(null), [youth])).toEqual([youth.formId]);
  });

  it("asks everyone a form with no bound", () => {
    expect(owed([], adult, [release])).toEqual([release.formId]);
  });

  // Dive-domain review H6: a youth form is a minor's paper, so a guardian
  // signs beside it whatever the record holds, and an unknown birthday is
  // the fix the desk is told about.
  it("asks a guardian beside a youth form, even with no birthday on file", () => {
    expect(owed([signed({ formVersionId: youth.versionId })], born(null), [youth])).toEqual([
      youth.formId,
    ]);
    expect(
      owed([signed({ formVersionId: youth.versionId, guardianSignedAt: now })], born(null), [
        youth,
      ]),
    ).toEqual([]);
  });

  it("names an unknown birthday as why a bounded form is asked", () => {
    const gaps = (signer: GuardianSigner) =>
      courseFormGaps({
        shopId: SHOP,
        bookingId: BOOKING,
        personId: PERSON,
        required: [youth, release],
        signatures: [],
        signer,
      }).map(({ form, ageUnknown }) => [form.formId, ageUnknown]);
    expect(gaps(born(null))).toEqual([
      [release.formId, false],
      [youth.formId, true],
    ]);
    expect(gaps(born("2016-01-01"))).toEqual([
      [release.formId, false],
      [youth.formId, false],
    ]);
    expect(gaps({ ...born(null), minorDeclared: true })).toEqual([
      [release.formId, false],
      [youth.formId, false],
    ]);
  });

  it("tells the dock a birthday is missing beside the form it asks", () => {
    const result = calculateReadiness({
      requirement: { requiresWaiver: false, requiredSpecialties: [] } as unknown as TripRequirement,
      waiver: null,
      certifications: [],
      now,
      timezone: "America/New_York",
      dateOfBirth: null,
      courseForms: {
        shopId: SHOP,
        bookingId: BOOKING,
        personId: PERSON,
        required: [youth],
        signatures: [],
        timezone: "America/New_York",
      },
    });
    expect(result.blockers).toContainEqual({
      code: "course_form_unsigned",
      params: { formTitle: youth.title, formMaxAge: 11 },
    });
  });

  it("says the birthday is the fix, in every staff language", () => {
    const blocker = {
      code: "course_form_unsigned" as const,
      params: { formTitle: "Youth form", formMaxAge: 11 },
    };
    expect(readinessBlockerText(staffTranslator("en-US"), blocker)).toBe(
      "Youth form is for students 11 and under, and there’s no date of birth on file. Add it, or have it signed with a parent or guardian.",
    );
    expect(readinessBlockerText(staffTranslator("es-ES"), blocker)).toContain(
      "fecha de nacimiento",
    );
  });
});

describe("courseFormGaps — what an owed form is missing", () => {
  const gaps = (signatures: CourseFormSignature[], signer = adult) =>
    courseFormGaps({
      shopId: SHOP,
      bookingId: BOOKING,
      personId: PERSON,
      required: [release],
      signatures,
      signer,
    }).map(({ gap }) => gap);

  it("is unsigned when the student has not signed", () => {
    expect(gaps([])).toEqual(["unsigned"]);
  });

  it("is the guardian's half when a minor signed alone", () => {
    expect(gaps([signed()], minor)).toEqual(["guardian_missing"]);
  });

  it("is unsigned, not the guardian's, when only another enrollment's signature exists", () => {
    expect(gaps([signed({ bookingId: OTHER_BOOKING })], minor)).toEqual(["unsigned"]);
  });
});

describe("fillCourseFormText — a form's blanks, filled at signing", () => {
  const context = {
    shopName: "Blue Mantis",
    courseTitle: "Open Water Diver",
    instructorNames: "Ana Ruiz, Ben Ode",
  };

  it("fills each placeholder, every time it appears", () => {
    expect(
      fillCourseFormText(
        "I, the student, release {shopName} and {instructorNames} for {courseTitle}. {shopName}.",
        context,
      ),
    ).toBe(
      "I, the student, release Blue Mantis and Ana Ruiz, Ben Ode for Open Water Diver. Blue Mantis.",
    );
  });

  it("leaves any other brace exactly as the shop typed it", () => {
    expect(fillCourseFormText("{shopname} {depth18} {}", context)).toBe("{shopname} {depth18} {}");
  });
});

describe("courseFormAwaitingText", () => {
  it("is waiting for an empty body, or one that is only whitespace", () => {
    expect(courseFormAwaitingText("")).toBe(true);
    expect(courseFormAwaitingText(" \r\n\t ")).toBe(true);
  });
  it("is not waiting once any text is in", () => {
    expect(courseFormAwaitingText("I agree.")).toBe(false);
  });
});

describe("courseFormTextChanged", () => {
  it("is a change for a new form", () => {
    expect(courseFormTextChanged(null, { title: "A", body: "B" })).toBe(true);
  });
  it("is no change when only surrounding whitespace differs", () => {
    expect(courseFormTextChanged({ title: "A", body: "B" }, { title: " A ", body: "B\n" })).toBe(
      false,
    );
  });
  it("is no change when only line endings or Unicode form differ, like the release", () => {
    const composed = "Café rules\nline two";
    const decomposedCrlf = "Café rules\r\nline two";
    expect(
      courseFormTextChanged({ title: "A", body: composed }, { title: "A", body: decomposedCrlf }),
    ).toBe(false);
  });
  it("is a change when the title or the body differs", () => {
    expect(courseFormTextChanged({ title: "A", body: "B" }, { title: "A2", body: "B" })).toBe(true);
    expect(courseFormTextChanged({ title: "A", body: "B" }, { title: "A", body: "B2" })).toBe(true);
  });
});

describe("calculateReadiness — course forms", () => {
  const requirement = {
    requiresWaiver: true,
    requiredSpecialties: [],
  } as unknown as TripRequirement;
  const waiver = {
    status: "completed",
    signedAt: now,
    completedAt: now,
    expiresAt: new Date("2026-10-15T00:00:00.000Z"),
  } as WaiverRecord;
  const base = { requirement, waiver, certifications: [], now, timezone: "America/New_York" };
  const courseForms = (signatures: CourseFormSignature[], required = [release, practices]) => ({
    shopId: SHOP,
    bookingId: BOOKING,
    personId: PERSON,
    required,
    signatures,
    timezone: "America/New_York",
  });

  it("is the shipped default: an unsigned form blocks boarding", () => {
    expect(COURSE_FORMS_BLOCK_BOARDING).toBe(true);
  });

  it("blocks with one blocker per unsigned form, each naming its form", () => {
    const result = calculateReadiness({ ...base, courseForms: courseForms([]) });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      { code: "course_form_unsigned", params: { formTitle: "Liability release" } },
      { code: "course_form_unsigned", params: { formTitle: "Safe diving practices" } },
    ]);
  });

  it("is ready once every form is signed at its current version", () => {
    const result = calculateReadiness({
      ...base,
      courseForms: courseForms([signed(), signed({ formVersionId: practices.versionId })]),
    });
    expect(result).toEqual({ status: "ready", blockers: [] });
  });

  it.each([
    ["an older version", signed({ formVersionId: "release-v1" })],
    ["the wrong person", signed({ personId: OTHER_PERSON })],
    ["another booking", signed({ bookingId: OTHER_BOOKING })],
    ["another shop", signed({ shopId: OTHER_SHOP })],
  ])("stays blocked on a signature from %s", (_label, signature) => {
    const result = calculateReadiness({
      ...base,
      courseForms: courseForms([signature], [release]),
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["course_form_unsigned"]);
  });

  it("stays blocked on a minor's form with no guardian beside it, naming the guardian as the fix", () => {
    const result = calculateReadiness({
      ...base,
      // The release itself is co-signed, so the only blocker is the form's.
      waiver: { ...waiver, guardianSignedAt: now } as WaiverRecord,
      dateOfBirth: minor.dateOfBirth,
      courseForms: courseForms([signed()], [release]),
    });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      { code: "course_form_guardian_missing", params: { formTitle: "Liability release" } },
    ]);
  });

  it("measures a minor in the shop's own zone, never UTC", () => {
    // Signed at 01:00 UTC on the eighteenth birthday: still the day before in
    // New York, so the guardian is owed there and would not be in UTC.
    const turning = "2008-10-08";
    const result = calculateReadiness({
      ...base,
      waiver: { ...waiver, guardianSignedAt: now } as WaiverRecord,
      dateOfBirth: turning,
      courseForms: courseForms(
        [signed({ signedAt: new Date("2026-10-08T01:00:00.000Z") })],
        [release],
      ),
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      "course_form_guardian_missing",
    ]);
  });

  it("asks for forms even on a departure whose waiver is switched off", () => {
    const result = calculateReadiness({
      ...base,
      requirement: { ...requirement, requiresWaiver: false } as TripRequirement,
      courseForms: courseForms([], [release]),
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["course_form_unsigned"]);
  });

  it("asks nothing of a booking whose course lists no forms", () => {
    expect(calculateReadiness(base)).toEqual({ status: "ready", blockers: [] });
  });

  it("files the blocker with the release, as nothing-on-file at the rail", () => {
    expect(BLOCKER_CATEGORY.course_form_unsigned).toBe("waiver");
    expect(aboardBlockerKind([{ code: "course_form_unsigned" }])).toBe("unknown");
  });

  it("puts it on the diver's sign step as theirs to do, after an unsigned release", () => {
    const result = calculateReadiness({
      ...base,
      waiver: null,
      courseForms: courseForms([], [release]),
    });
    const [item] = buildDiverChecklist(requirement, result);
    expect(item?.category).toBe("waiver");
    // The unsent release is the shop's to send; the form is the diver's own,
    // so the step reads as theirs and offers the form.
    expect(item?.state).toBe("action");
    expect(item?.code).toBe("course_form_unsigned");
    expect(item?.actionable.map((blocker) => blocker.code)).toEqual(["course_form_unsigned"]);
  });
});
