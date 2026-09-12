import { nowDate } from "./clock";

/**
 * The provider seam for signature capture. V1 keeps the evidence local and
 * deterministic; a vendor adapter must normalize into this shape (ADR 20260718).
 */
type SignatureCaptureInput = {
  signerName: string;
  agreed: boolean;
  signedAt?: Date;
};

/**
 * "imported" is not captured through this provider interface — a contact
 * import trusts a prior shop's own acceptance record rather than capturing a
 * new signature (ADR 20260724-import-waiver-acceptance) — but it shares the
 * column and every currency/display rule keyed on method, so it is declared
 * here alongside the two real providers.
 */
type SignatureMethod =
  | "typed_consent"
  | "in_person_attested"
  | "imported"
  /**
   * The paper path only, and only for a co-signer (ADR
   * 20260907-guardian-co-signature, decision 10; issue #1573). A parent whose
   * ID reads exactly like their child's is refused everywhere else, because
   * one name typed twice is one signature wearing two hats. On paper a named
   * staffer watched two people sign, and this is that staffer saying so —
   * `in_person_attested` with the assertion attached, so the distinction
   * survives in the seal and in the export bundle rather than being lost into
   * the ordinary method.
   */
  | "in_person_attested_namesake";

type SignatureEvidence = {
  method: SignatureMethod;
  signerName: string;
  consentedAt: Date;
  signedAt: Date;
};

interface SignatureProvider {
  capture(input: SignatureCaptureInput): SignatureEvidence | null;
}

export const localTypedConsentProvider: SignatureProvider = {
  capture(input) {
    const signerName = input.signerName.trim();
    if (!input.agreed || signerName.length < 2) return null;
    const signedAt = input.signedAt ?? nowDate();
    return {
      method: "typed_consent",
      signerName,
      consentedAt: signedAt,
      signedAt,
    };
  },
};

/**
 * A staff member recording that a diver signed a release on paper — in the shop
 * or on shore — where the app never sees the diver directly. The diver remains
 * the signer; which staff member attested is accountability the caller stores on
 * the record (waiver_records.recordedByPersonId), not in this evidence shape.
 */
export const inPersonAttestationProvider: SignatureProvider = {
  capture(input) {
    const signerName = input.signerName.trim();
    if (!input.agreed || signerName.length < 2) return null;
    const signedAt = input.signedAt ?? nowDate();
    return {
      method: "in_person_attested",
      signerName,
      consentedAt: signedAt,
      signedAt,
    };
  },
};

/**
 * **The namesake co-signature, and nothing else** (issue #1573, owner decision
 * 2026-09-10).
 *
 * Written by exactly one caller — `recordInPersonWaiver` in `src/db/waivers.ts`
 * — for exactly one case: a minor's *paper* release whose co-signer's name
 * reads as the diver's own, where the staffer recording it has ticked an
 * explicit confirmation that they watched two people sign. Three conditions,
 * all of them required:
 *
 * 1. the paper path (the online path refuses a namesake guardian outright and
 *    gains no way through — `guardianEvidence` is the enforcement, and its
 *    input shape has no field to carry this);
 * 2. the names actually match (a staffer who ticks the box on a form where
 *    they do not gets the ordinary `in_person_attested`, because the assertion
 *    is only meaningful for the case it names);
 * 3. the staffer's own tick, per release. The refusal stays the default; the
 *    checkbox is drawn only on the form that has already met it.
 *
 * The distinction lives in the method and nowhere else: no surface reads it,
 * readiness does not branch on it, and the record is a co-signed record like
 * any other. What it buys is auditability — the value is inside the v1
 * integrity seal and in the export bundle, so a shop or a regulator reading the
 * evidence can tell this release apart from one where two names differed.
 */
export const namesakeAttestationProvider: SignatureProvider = {
  capture(input) {
    const signerName = input.signerName.trim();
    if (!input.agreed || signerName.length < 2) return null;
    const signedAt = input.signedAt ?? nowDate();
    return {
      method: "in_person_attested_namesake",
      signerName,
      consentedAt: signedAt,
      signedAt,
    };
  },
};
