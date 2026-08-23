import { describe, expect, it } from "vitest";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { counterBlockerDisclosure } from "./blocker-disclosure";

/**
 * The counter's three-way call about how a blocked row says why. Tested
 * directly rather than only through the page because every branch is a
 * *judgment about who is standing there* rather than a rendering detail, and
 * two of the three came out of incidents — a lobby reading a diver's
 * outstanding payment (#716), and the row a staffer must act on saying only
 * "Why: 1 reason" with the diver in front of them (#759).
 *
 * The real translator throughout (repo convention): a key that never landed in
 * the bundle fails here instead of rendering raw on a front desk.
 */
describe("counterBlockerDisclosure", () => {
  const t = staffTranslator("en-US");
  const es = staffTranslator("es-ES");

  it("puts one sayable reason on the row, with no disclosure to open", () => {
    expect(counterBlockerDisclosure(t, [{ code: "waiver_not_sent" }])).toBeNull();
  });

  it("still hides one reason that is the diver's private business", () => {
    // The row #716 was really about. The badge above it still says Blocked.
    expect(counterBlockerDisclosure(t, [{ code: "payment_due" }])).toEqual({
      summary: "Why: 1 reason",
    });
    expect(counterBlockerDisclosure(t, [{ code: "medical_review" }])).toEqual({
      summary: "Why: 1 reason",
    });
  });

  it("names the first sayable reason and counts the rest", () => {
    expect(
      counterBlockerDisclosure(t, [
        { code: "waiver_not_sent" },
        { code: "certification_missing" },
        { code: "nitrox_missing" },
        { code: "specialty_missing", params: { specialty: "deep" } },
        { code: "payment_due" },
      ]),
    ).toEqual({ summary: "Waiver has not been sent. And 4 more reasons." });
  });

  it("counts every other reason, including the ones it skipped to find a sayable one", () => {
    // Two reasons, the money one first: the summary names the waiver and the
    // count is still 1, because it counts what stays behind the tap rather
    // than what came after the one it named.
    expect(
      counterBlockerDisclosure(t, [{ code: "payment_due" }, { code: "waiver_not_sent" }]),
    ).toEqual({ summary: "Waiver has not been sent. And 1 more reason." });
  });

  it("says nothing but a count when every reason is private", () => {
    expect(
      counterBlockerDisclosure(t, [
        { code: "payment_due" },
        { code: "medical_review" },
        { code: "under_minimum_age", params: { age: 11, minimumAge: 12 } },
      ]),
    ).toEqual({ summary: "Why: 3 reasons" });
  });

  it("renders the reason the diver's own record would show, params and all", () => {
    const blocker = {
      code: "certification_insufficient",
      params: { requiredLevel: "rescue" },
    } as const;
    const disclosure = counterBlockerDisclosure(t, [blocker, { code: "payment_due" }]);
    expect(disclosure?.summary).toContain(readinessBlockerText(t, blocker));
  });

  it("carries real ICU plural forms into Spanish, not a concatenated count", () => {
    const one = counterBlockerDisclosure(es, [
      { code: "waiver_not_sent" },
      { code: "payment_due" },
    ]);
    const many = counterBlockerDisclosure(es, [
      { code: "waiver_not_sent" },
      { code: "payment_due" },
      { code: "medical_review" },
    ]);
    expect(one?.summary).toContain("Y 1 motivo más.");
    expect(many?.summary).toContain("Y 2 motivos más.");
  });
});
