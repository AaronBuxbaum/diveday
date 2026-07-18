import { describe, expect, it } from "vitest";
import type { MedicalAnswers, WaiverRecord } from "@/db/schema";
import { localTypedConsentProvider } from "./signatures";
import { needsMedicalReview, waiverActivityTimeline, waiverState } from "./waivers";

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

  it("keeps an ordered staff timeline for replaced and medically blocked records", () => {
    const entries = waiverActivityTimeline([
      {
        status: "medical_review",
        templateTitle: "Release",
        templateVersion: 2,
        createdAt: new Date("2026-07-18T12:00:00.000Z"),
        startedAt: new Date("2026-07-18T12:01:00.000Z"),
        completedAt: new Date("2026-07-18T12:02:00.000Z"),
        supersededAt: null,
      } as WaiverRecord,
      {
        status: "pending",
        templateTitle: "Release",
        templateVersion: 1,
        createdAt: new Date("2026-07-18T11:00:00.000Z"),
        startedAt: null,
        completedAt: null,
        supersededAt: new Date("2026-07-18T11:30:00.000Z"),
      } as WaiverRecord,
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "issued",
      "superseded",
      "issued",
      "started",
      "medical_review",
    ]);
  });
});
