import { describe, expect, it, vi } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import type { CourseFormSignature, RequiredCourseForm } from "./course-forms";

/**
 * A course form marked medical screening keeps blocking boarding whatever
 * `COURSE_FORMS_BLOCK_BOARDING` says (issue #2337, ADR 20261008-course-forms).
 * The switch is a module constant, so each case sets it before importing
 * readiness afresh.
 */

const SHOP = "00000000-0000-4000-8000-000000000001";
const BOOKING = "00000000-0000-4000-8000-0000000000b1";
const PERSON = "00000000-0000-4000-8000-0000000000a1";
const now = new Date("2026-10-08T15:00:00.000Z");

const release: RequiredCourseForm = {
  shopId: SHOP,
  formId: "form-release",
  versionId: "release-v1",
  version: 1,
  title: "Liability release",
  position: 0,
};
const medical: RequiredCourseForm = {
  shopId: SHOP,
  formId: "form-medical",
  versionId: "medical-v1",
  version: 1,
  title: "Medical questionnaire",
  position: 1,
  medicalScreening: true,
};

const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: null,
  requiredSpecialties: [],
} as unknown as TripRequirement;
const waiver = {
  status: "completed",
  signedAt: now,
  completedAt: now,
  expiresAt: new Date("2026-10-15T00:00:00.000Z"),
} as WaiverRecord;

function signed(form: RequiredCourseForm): CourseFormSignature {
  return {
    shopId: SHOP,
    bookingId: BOOKING,
    personId: PERSON,
    formVersionId: form.versionId,
    signedAt: now,
    guardianSignedAt: null,
  };
}

async function readinessWith(
  blocks: boolean,
  signatures: CourseFormSignature[],
  participantType?: "diver" | "snorkeler" | "rider",
) {
  vi.resetModules();
  vi.doMock("./course-forms", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./course-forms")>()),
    COURSE_FORMS_BLOCK_BOARDING: blocks,
  }));
  const { calculateReadiness } = await import("./readiness");
  return calculateReadiness({
    requirement,
    waiver,
    certifications: [],
    now,
    timezone: "America/New_York",
    dateOfBirth: "1990-01-01",
    participantType,
    courseForms: {
      shopId: SHOP,
      bookingId: BOOKING,
      personId: PERSON,
      required: [release, medical],
      signatures,
      timezone: "America/New_York",
    },
  });
}

describe("medical-screening course forms (#2337)", () => {
  it("with the switch on, every unsigned form blocks, medical or not", async () => {
    const result = await readinessWith(true, []);
    expect(result.blockers.map((b) => b.params?.formTitle)).toEqual([
      "Liability release",
      "Medical questionnaire",
    ]);
  });

  it("with the switch off, an unsigned medical form still blocks and the plain one only warns", async () => {
    const result = await readinessWith(false, []);
    expect(result.status).toBe("blocked");
    expect(result.blockers).toEqual([
      { code: "course_form_unsigned", params: { formTitle: "Medical questionnaire" } },
    ]);
  });

  it("asks no course form of a snorkeler or rider on the session, medical or not (#2226)", async () => {
    for (const type of ["snorkeler", "rider"] as const) {
      const result = await readinessWith(true, [], type);
      expect(result.blockers.filter((b) => b.code.startsWith("course_form_"))).toEqual([]);
    }
  });

  it("with the switch off, signing the medical form clears it", async () => {
    const result = await readinessWith(false, [signed(medical)]);
    expect(result).toEqual({ status: "ready", blockers: [] });
  });

  it("with the switch off, signing only the plain form leaves the medical one blocking", async () => {
    const result = await readinessWith(false, [signed(release)]);
    expect(result.blockers.map((b) => b.params?.formTitle)).toEqual(["Medical questionnaire"]);
  });

  it("with the switch off, a medical form signed at an older version still blocks", async () => {
    const result = await readinessWith(false, [
      { ...signed(medical), formVersionId: "medical-v0" },
    ]);
    expect(result.blockers).toHaveLength(1);
  });
});

/**
 * **A medical statement is asked of everyone** (agency review G3 of #2265): an
 * age bound on a medical-screening form is never honoured, whoever wrote it.
 */
describe("a medical-screening form with an age bound", () => {
  it("is still asked of an adult", async () => {
    const { outstandingCourseForms } = await import("./course-forms");
    const bounded = { ...medical, maxAgeYears: 11, sessionFirstDay: "2026-10-20" };
    expect(
      outstandingCourseForms({
        shopId: SHOP,
        bookingId: BOOKING,
        personId: PERSON,
        required: [bounded],
        signatures: [],
        signer: { dateOfBirth: "1990-01-01", minorDeclared: false, timezone: "UTC" },
      }).map((form) => form.formId),
    ).toEqual([medical.formId]);
  });
});
