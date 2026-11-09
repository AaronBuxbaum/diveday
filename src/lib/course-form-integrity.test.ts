import { describe, expect, it, vi } from "vitest";
import type { CourseFormRecord } from "@/db/schema";
import { courseFormSeal, verifyCourseFormIntegrity } from "./course-form-integrity";

const at = new Date("2026-11-09T00:00:00Z");
const record: Omit<CourseFormRecord, "integrityHash" | "integrityVersion"> = {
  id: "record",
  shopId: "shop",
  personId: "diver",
  bookingId: "booking",
  formId: "form",
  formVersionId: "form-version",
  formTitle: "Course form",
  formVersion: 1,
  formBody: "I agree",
  courseTitle: "Open Water",
  tripId: "trip",
  signedViaBookingId: null,
  instructorNames: "Instructor",
  paperSignedOn: null,
  signedName: "Diver",
  signatureMethod: "typed_consent",
  recordedByPersonId: null,
  consentedAt: at,
  signedAt: at,
  guardianName: null,
  guardianRelationship: null,
  guardianSignatureMethod: null,
  guardianConsentedAt: null,
  guardianSignedAt: null,
  anonymizedAt: null,
  anonymizedByPersonId: null,
  createdAt: at,
};

describe("course-form signing key history", () => {
  it("verifies signed and erased evidence after rotation without permitting restored names", () => {
    const first = "a".repeat(40);
    const second = "b".repeat(40);
    try {
      vi.stubEnv("WAIVER_INTEGRITY_KEYS", JSON.stringify({ active: "first", keys: { first } }));
      const signed = { ...record, ...courseFormSeal(record, 1) };
      const erasedFields = {
        ...record,
        signedName: null,
        anonymizedAt: at,
        anonymizedByPersonId: "owner",
      };
      const erased = { ...erasedFields, ...courseFormSeal(erasedFields, 2) };
      vi.stubEnv(
        "WAIVER_INTEGRITY_KEYS",
        JSON.stringify({ active: "second", keys: { first, second } }),
      );
      expect(verifyCourseFormIntegrity(signed)).toBe("valid");
      expect(verifyCourseFormIntegrity(erased)).toBe("valid");
      expect(verifyCourseFormIntegrity({ ...erased, signedName: "restored" })).toBe("invalid");
      expect(verifyCourseFormIntegrity({ ...signed, formBody: "changed" })).toBe("invalid");
      vi.stubEnv("WAIVER_INTEGRITY_KEYS", JSON.stringify({ active: "second", keys: { second } }));
      expect(verifyCourseFormIntegrity(signed)).toBe("invalid");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
