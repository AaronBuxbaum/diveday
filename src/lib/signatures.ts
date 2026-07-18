/**
 * The provider seam for signature capture. V1 keeps the evidence local and
 * deterministic; a vendor adapter must normalize into this shape (ADR 20260718).
 */
export type SignatureCaptureInput = {
  signerName: string;
  agreed: boolean;
  signedAt?: Date;
};

export type SignatureEvidence = {
  method: "typed_consent";
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
    const signedAt = input.signedAt ?? new Date();
    return {
      method: "typed_consent",
      signerName,
      consentedAt: signedAt,
      signedAt,
    };
  },
};
