import { describe, expect, it } from "vitest";
import {
  flaggedMedicalIds,
  isMedicalFlagged,
  MEDICAL_QUESTIONS,
  newWaiverToken,
  statusAfterSigning,
  waiverReadiness,
} from "./waivers";

describe("medical statement screening", () => {
  it("treats an all-no screen as unflagged", () => {
    const answers = Object.fromEntries(MEDICAL_QUESTIONS.map((q) => [q.id, false]));
    expect(isMedicalFlagged(answers)).toBe(false);
    expect(flaggedMedicalIds(answers)).toEqual([]);
  });

  it("treats a blank screen (missing keys) as unflagged", () => {
    expect(isMedicalFlagged({})).toBe(false);
  });

  it("flags any single yes and reports which questions in order", () => {
    const answers = { breathing: true, heart: true };
    expect(isMedicalFlagged(answers)).toBe(true);
    // Reported in question order (heart before breathing), not answer order.
    expect(flaggedMedicalIds(answers)).toEqual(["heart", "breathing"]);
  });

  it("ignores unknown question ids", () => {
    expect(isMedicalFlagged({ nonsense: true })).toBe(false);
  });
});

describe("status after signing", () => {
  it("clean screen signs clear", () => {
    expect(statusAfterSigning(false)).toBe("signed");
  });

  it("flagged screen blocks on physician referral", () => {
    expect(statusAfterSigning(true)).toBe("physician_required");
  });
});

describe("waiver readiness roll-up", () => {
  it("no waiver yet is pending", () => {
    expect(waiverReadiness(null)).toBe("pending");
    expect(waiverReadiness(undefined)).toBe("pending");
  });

  it("signed is cleared, physician_required is blocked, pending stays pending", () => {
    expect(waiverReadiness({ status: "signed" })).toBe("cleared");
    expect(waiverReadiness({ status: "physician_required" })).toBe("blocked");
    expect(waiverReadiness({ status: "pending" })).toBe("pending");
  });
});

describe("waiver tokens", () => {
  it("are url-safe and unique across calls", () => {
    const a = newWaiverToken();
    const b = newWaiverToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(20);
  });
});
