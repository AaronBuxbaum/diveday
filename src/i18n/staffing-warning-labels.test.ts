import { describe, expect, it } from "vitest";
import type { StaffingWarning } from "@/lib/staffing-warnings";
import { staffTranslator } from "./staff-messages";
import { staffingWarningText } from "./staffing-warning-labels";

const WORDS: Record<string, string> = {
  liability_insurance: "Liability insurance",
  captains_licence: "Captain’s license",
  other: "Other",
};

function expired(kind: string, locale = "en-US"): string {
  const warning: StaffingWarning = {
    code: "credential_expired",
    personId: "p-1",
    name: "Keiko Tanaka",
    kind,
    renewsAt: "2026-09-30",
    tripId: "t-1",
    title: "1 pm reef",
  };
  return staffingWarningText(staffTranslator(locale), warning, {
    locale,
    timeZone: "America/New_York",
    credentialWord: (k) => WORDS[k] ?? k,
  });
}

describe("staffingWarningText: an expired credential", () => {
  it("names the credential where its label reads as a heading, not mid-sentence", () => {
    // The kind labels are list headings ("Liability insurance"); spliced into
    // a possessive they read as "Keiko Tanaka’s Liability insurance".
    const text = expired("liability_insurance");
    expect(text).toContain("Keiko Tanaka");
    expect(text).toContain("1 pm reef");
    expect(text).toContain("Liability insurance expired");
    expect(text).not.toContain("’s Liability");
  });

  it("never prints the bare word 'Other' as a credential", () => {
    expect(expired("other")).not.toMatch(/\bOther\b/);
    expect(expired("other")).toMatch(/credential/);
    expect(expired("other", "es-ES")).not.toMatch(/\bOtra\b/);
  });
});
