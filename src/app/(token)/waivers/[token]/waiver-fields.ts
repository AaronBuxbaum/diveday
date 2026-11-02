import type { DiverMessageKey } from "@/i18n/messages";

export type WaiverInvalidField =
  | "medical"
  | "emergencyContactName"
  | "emergencyContactPhone"
  | "signerName"
  | "signerNameMismatch"
  | "acknowledged"
  | "guardianName"
  | "guardianNameIsDiver"
  | "guardianRelationship"
  | "guardianEmail"
  | "guardianAcknowledged"
  /** A shop question (glossary *Shop question*): required and left blank, or an answer its kind cannot hold. */
  | "shopQuestionRequired"
  | "shopQuestionInvalid"
  /** The medical alert for the crew: longer than the box allows, or a control character in it. */
  | "medicalAlert";

/** Copy and same-page anchor for each field a fallback submit can name as missing. */
export const WAIVER_FIELD_ERROR: Record<
  WaiverInvalidField,
  { textKey: DiverMessageKey; anchor: string }
> = {
  medical: { textKey: "waiver.errorMedical", anchor: "medical-questionnaire" },
  // The emergency contact's two boxes, refused on whichever one is empty.
  // One sentence for both: the fix is the same either way, and it is the
  // pair — not the box — that the crew needs (`readEmergencyContact`).
  emergencyContactName: {
    textKey: "waiver.errorContactPair",
    anchor: "emergencyContactName",
  },
  emergencyContactPhone: {
    textKey: "waiver.errorContactPair",
    anchor: "emergencyContactPhone",
  },
  signerName: { textKey: "waiver.errorName", anchor: "signerName" },
  // A typed name that isn't the diver's own — same field, different fix, so
  // it gets its own sentence rather than the generic "type your full name".
  signerNameMismatch: { textKey: "waiver.errorNameMismatch", anchor: "signerName" },
  acknowledged: { textKey: "waiver.errorAgreement", anchor: "acknowledged" },
  // The guardian's controls, refused one at a time on the control itself.
  guardianName: { textKey: "waiver.errorGuardianName", anchor: "guardianName" },
  // A guardian who typed the diver's own name: same field, different fix.
  guardianNameIsDiver: { textKey: "waiver.errorGuardianNameIsDiver", anchor: "guardianName" },
  guardianRelationship: {
    textKey: "waiver.errorGuardianRelationship",
    anchor: "guardianRelationship",
  },
  guardianEmail: { textKey: "waiver.errorGuardianEmail", anchor: "guardianEmail" },
  guardianAcknowledged: {
    textKey: "waiver.errorGuardianAgreement",
    anchor: "guardianAcknowledged",
  },
  // A shop question, refused on the question itself: the page swaps this
  // section anchor for the named question's own (`?q=`), when it is one the
  // record's version asks.
  shopQuestionRequired: { textKey: "waiver.errorShopQuestionRequired", anchor: "shop-questions" },
  shopQuestionInvalid: { textKey: "waiver.errorShopQuestionInvalid", anchor: "shop-questions" },
  // Refused on the box itself, for its shape and never for what it says.
  medicalAlert: { textKey: "waiver.errorMedicalAlert", anchor: "medicalAlert" },
};

/** One refused field's copy and anchor, as the page and its cards receive it. */
export type WaiverFieldError = (typeof WAIVER_FIELD_ERROR)[WaiverInvalidField];
