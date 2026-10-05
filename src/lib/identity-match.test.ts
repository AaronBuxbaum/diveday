import { describe, expect, it } from "vitest";
import { heldSeatBlockers } from "./identity-match";
import type { ReadinessBlocker } from "./readiness";

describe("heldSeatBlockers", () => {
  it("leaves an unheld seat's blockers alone", () => {
    const blockers: ReadinessBlocker[] = [
      { code: "waiver_not_sent" },
      { code: "certification_missing" },
    ];
    expect(heldSeatBlockers(blockers)).toEqual(blockers);
  });

  it("keeps only the identity question and the seat's own payment on a held seat", () => {
    expect(
      heldSeatBlockers([
        { code: "identity_unconfirmed" },
        { code: "medical_review" },
        { code: "certification_missing" },
        { code: "payment_due" },
      ]).map((blocker) => blocker.code),
    ).toEqual(["identity_unconfirmed", "payment_due"]);
  });
});
