import { describe, expect, it } from "vitest";
import { DIVER_MESSAGES } from "@/i18n/messages";
import { COMPANY_LEGAL_NAME, COMPANY_POSTAL_ADDRESS, FOUNDER_NAME } from "./rules";

describe("who DiveDay is, as a matter of record", () => {
  it("holds the facts Aaron supplied on 2026-11-11", () => {
    expect(COMPANY_LEGAL_NAME).toBe("Pseudorandom LLC");
    expect(COMPANY_POSTAL_ADDRESS).toBe("12851 Capital St, Suite 100, Oak Park, MI 48237");
    expect(FOUNDER_NAME).toBe("Aaron Buxbaum");
  });

  it.each(Object.entries(DIVER_MESSAGES))(
    "reaches a sentence as a parameter and is never typed into the %s bundle",
    (_locale, messages) => {
      for (const page of [messages.marketing.terms, messages.marketing.privacy]) {
        expect(page.contact.operator).toContain("{company}");
        expect(page.contact.operator).toContain("{postalAddress}");
      }
      const published = JSON.stringify(messages.marketing);
      expect(published).not.toContain("Pseudorandom");
      expect(published).not.toContain("Buxbaum");
    },
  );
});
