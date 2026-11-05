import { describe, expect, it } from "vitest";
import { parseReferralPaper, REFERRAL_PAPERS, referralPapersOwed } from "./referral-student";

/** Loop 5, row 10: what the desk still owes for a referral student. */
describe("referralPapersOwed", () => {
  const at = new Date("2026-11-05T15:00:00Z");

  it("owes nothing for a seat that is not a referral", () => {
    expect(
      referralPapersOwed({ referredInAt: null, referralFormAt: null, referralRecordAt: null }),
    ).toEqual([]);
  });

  it("owes the referral form and the eLearning record until each is collected", () => {
    expect(
      referralPapersOwed({ referredInAt: at, referralFormAt: null, referralRecordAt: null }),
    ).toEqual(["form", "record"]);
    expect(
      referralPapersOwed({ referredInAt: at, referralFormAt: at, referralRecordAt: null }),
    ).toEqual(["record"]);
    expect(
      referralPapersOwed({ referredInAt: at, referralFormAt: at, referralRecordAt: at }),
    ).toEqual([]);
  });

  it("names its two papers and reads nothing else from a form", () => {
    expect(REFERRAL_PAPERS).toEqual(["form", "record"]);
    expect(parseReferralPaper("form")).toBe("form");
    expect(parseReferralPaper("record")).toBe("record");
    expect(parseReferralPaper("medical")).toBeNull();
    expect(parseReferralPaper(undefined)).toBeNull();
  });
});
