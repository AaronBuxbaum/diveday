import { describe, expect, it } from "vitest";
import type { MedicalAnswers } from "@/db/schema";
import { localTypedConsentProvider } from "./signatures";
import { needsMedicalReview, waiverState } from "./waivers";

const clear: MedicalAnswers = { breathing: false, medication: false, recentIllness: false };

describe("waiver domain rules", () => {
  it("fails medical readiness closed when any referral answer is yes", () => {
    expect(needsMedicalReview(clear)).toBe(false);
    expect(needsMedicalReview({ ...clear, recentIllness: true })).toBe(true);
  });

  it("requires both a real typed name and affirmative consent", () => {
    expect(localTypedConsentProvider.capture({ signerName: "A", agreed: true })).toBeNull();
    expect(
      localTypedConsentProvider.capture({ signerName: "Nora Quinn", agreed: false }),
    ).toBeNull();
    expect(
      localTypedConsentProvider.capture({ signerName: "  Nora Quinn  ", agreed: true }),
    ).toMatchObject({
      method: "typed_consent",
      signerName: "Nora Quinn",
    });
  });

  it("treats a pending past-deadline record as expired rather than ready", () => {
    const record = {
      status: "pending",
      expiresAt: new Date("2026-07-18T00:00:00.000Z"),
    } as Parameters<typeof waiverState>[0];
    expect(waiverState(record, new Date("2026-07-18T00:00:01.000Z"))).toBe("expired");
  });
});
