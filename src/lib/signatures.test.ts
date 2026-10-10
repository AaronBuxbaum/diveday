import { describe, expect, it } from "vitest";
import { nowDate } from "./clock";
import {
  inPersonAttestationProvider,
  localTypedConsentProvider,
  namesakeAttestationProvider,
} from "./signatures";

const PROVIDERS = [
  ["typed consent", localTypedConsentProvider, "typed_consent"],
  ["in-person attestation", inPersonAttestationProvider, "in_person_attested"],
  ["namesake attestation", namesakeAttestationProvider, "in_person_attested_namesake"],
] as const;

const AT = new Date("2026-10-10T14:00:00.000Z");

describe.each(PROVIDERS)("the %s provider", (_label, provider, method) => {
  it("records the method, the trimmed name and one instant for consent and signature", () => {
    expect(provider.capture({ signerName: "  Rae Recap ", agreed: true, signedAt: AT })).toEqual({
      method,
      signerName: "Rae Recap",
      consentedAt: AT,
      signedAt: AT,
    });
  });

  it("captures nothing without agreement, however good the name", () => {
    expect(provider.capture({ signerName: "Rae Recap", agreed: false, signedAt: AT })).toBeNull();
  });

  it("captures nothing for a name shorter than two characters once trimmed", () => {
    for (const signerName of ["", " ", "R", "  R  ", "\t\n"]) {
      expect(provider.capture({ signerName, agreed: true, signedAt: AT })).toBeNull();
    }
  });

  it("takes the instant from the clock when none is given", () => {
    const evidence = provider.capture({ signerName: "Rae", agreed: true });
    expect(evidence?.signedAt.getTime()).toBe(nowDate().getTime());
    expect(evidence?.consentedAt).toBe(evidence?.signedAt);
  });
});
