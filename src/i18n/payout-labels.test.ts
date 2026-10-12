import { describe, expect, it } from "vitest";
import { payoutSentence } from "./payout-labels";
import { staffTranslator } from "./staff-messages";

const PAYOUT = {
  amountCents: 184_200,
  currency: "usd",
  status: "paid",
  // Stripe states the arrival day at UTC midnight.
  arrivalDate: new Date("2026-10-03T00:00:00Z"),
  coveredFrom: new Date("2026-09-27T14:00:00Z"),
  // 9 PM in Miami on Oct 1 is already Oct 2 in UTC.
  coveredTo: new Date("2026-10-02T01:00:00Z"),
};
const MIAMI = { locale: "en-US", timeZone: "America/New_York" };

/** A date's month and day are bound with a no-break space (`keepUnitsWhole`); read it as a space. */
function sentence(...args: Parameters<typeof payoutSentence>): string {
  return payoutSentence(...args).replaceAll("\u00A0", " ");
}

describe("payoutSentence", () => {
  it("names the amount, the arrival day and the span in the shop's own days", () => {
    expect(sentence(staffTranslator("en-US"), PAYOUT, MIAMI)).toBe(
      "Paid out $1,842.00 on October 3, covering September 27 to October 1",
    );
  });

  it("never moves the arrival day into the day before for a shop west of Greenwich", () => {
    const text = sentence(
      staffTranslator("en-US"),
      { ...PAYOUT, coveredFrom: null, coveredTo: null },
      { locale: "en-US", timeZone: "Pacific/Honolulu" },
    );
    expect(text).toBe("Paid out $1,842.00 on October 3");
  });

  it("one day of money says one day", () => {
    const text = sentence(
      staffTranslator("en-US"),
      { ...PAYOUT, coveredTo: PAYOUT.coveredFrom },
      MIAMI,
    );
    expect(text).toBe("Paid out $1,842.00 on October 3, covering September 27");
  });

  it("a failed payout tells the owner where to fix it, in Spanish too", () => {
    expect(sentence(staffTranslator("en-US"), { ...PAYOUT, status: "failed" }, MIAMI)).toBe(
      "A payout of $1,842.00 due October 3 failed. Check the bank account in Stripe.",
    );
    expect(
      sentence(
        staffTranslator("es-ES"),
        { ...PAYOUT, status: "failed" },
        {
          locale: "es-ES",
          timeZone: "America/New_York",
        },
      ),
    ).toContain("Revisa la cuenta bancaria en Stripe");
  });
});
