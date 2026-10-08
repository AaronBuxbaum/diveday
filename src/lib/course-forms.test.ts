import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import {
  COURSE_FORMS_BLOCK_BOARDING,
  type CourseFormSignature,
  courseFormAwaitingText,
  courseFormTextChanged,
  outstandingCourseForms,
  type RequiredCourseForm,
} from "./course-forms";
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
const adult = { dateOfBirth: "1990-01-01", timezone: "America/New_York" };
const minor = { dateOfBirth: "2012-05-01", timezone: "America/New_York" };

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

function owed(signatures: CourseFormSignature[], signer = adult, required = [release]) {
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
    const turning = { dateOfBirth: "2008-10-08", timezone: "UTC" };
    const dayBefore = new Date("2026-10-07T12:00:00.000Z");
    expect(owed([signed({ signedAt: dayBefore })], turning)).toEqual(["form-release"]);
  });

  it("reads an unknown date of birth as an adult (H-08's fail-open)", () => {
    expect(owed([signed()], { dateOfBirth: null, timezone: "UTC" } as never)).toEqual([]);
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

  it("stays blocked on a minor's form with no guardian beside it", () => {
    const result = calculateReadiness({
      ...base,
      // The release itself is co-signed, so the only blocker is the form's.
      waiver: { ...waiver, guardianSignedAt: now } as WaiverRecord,
      dateOfBirth: minor.dateOfBirth,
      courseForms: courseForms([signed()], [release]),
    });
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(["course_form_unsigned"]);
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
