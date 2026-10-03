import { describe, expect, it } from "vitest";
import { readinessBlockerText } from "@/i18n/readiness-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { counterBlockerDisclosure } from "./blocker-disclosure";

/**
 * The counter's call about how a blocked row says why. Tested directly rather
 * than only through the page because both branches came out of incidents: a
 * blocked row saying only "Why: 1 reason" with the diver in front of the
 * staffer (#759), and, before #890 settled it, a lobby reading a diver's
 * outstanding payment off the same row (#716) — the counter is a staff
 * surface like any other now, so it names the worst reason same as the rest.
 *
 * The real translator throughout (repo convention): a key that never landed in
 * the bundle fails here instead of rendering raw on a front desk.
 */
describe("counterBlockerDisclosure", () => {
  const t = staffTranslator("en-US");
  const es = staffTranslator("es-ES");

  it("puts the one reason on the row, with no disclosure to open", () => {
    expect(counterBlockerDisclosure(t, [{ code: "waiver_not_sent" }])).toBeNull();
  });

  it("names a private reason too — the counter is a staff surface (issue 890)", () => {
    expect(counterBlockerDisclosure(t, [{ code: "payment_due" }])).toBeNull();
    expect(counterBlockerDisclosure(t, [{ code: "medical_review" }])).toBeNull();
  });

  it("names the worst reason and counts the rest", () => {
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

  it("names the first reason and counts the rest, private ones included", () => {
    expect(
      counterBlockerDisclosure(t, [{ code: "payment_due" }, { code: "waiver_not_sent" }]),
    ).toEqual({ summary: "Payment is outstanding for this trip. And 1 more reason." });
  });

  it("names the worst reason even when every reason is private", () => {
    expect(
      counterBlockerDisclosure(t, [
        { code: "payment_due" },
        { code: "medical_review" },
        { code: "under_minimum_age", params: { age: 11, minimumAge: 12 } },
      ]),
    ).toEqual({ summary: "Payment is outstanding for this trip. And 2 more reasons." });
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
