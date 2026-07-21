import { nowDate } from "./clock";
/**
 * The provider seam for signature capture. V1 keeps the evidence local and
 * deterministic; a vendor adapter must normalize into this shape (ADR 20260718).
 */
export type SignatureCaptureInput = {
  signerName: string;
  agreed: boolean;
  signedAt?: Date;
};

export type SignatureMethod = "typed_consent" | "in_person_attested";

export type SignatureEvidence = {
  method: SignatureMethod;
  signerName: string;
  consentedAt: Date;
  signedAt: Date;
};

export interface SignatureProvider {
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
