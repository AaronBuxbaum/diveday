import type { StaffMessageKey } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";

/** Where a refusal belongs: beside the person step, or beside the submit. */
type NoticeDefinition = {
  key: StaffMessageKey;
  step: "who" | "rent";
  /** The same sentence naming the unit, when the refusal carries one (`?unit=`). */
  named?: StaffMessageKey;
  tone?: NoticeTone;
};

export const RENT_OUT_NOTICES: Record<string, NoticeDefinition> = {
  invalid: { key: "counterRentals.new.notice.invalid", step: "rent" },
  duplicate: { key: "counterRentals.new.notice.duplicate", step: "who" },
  "invalid-window": { key: "counterRentals.new.notice.invalidWindow", step: "rent" },
  "starts-in-past": { key: "counterRentals.new.notice.startsInPast", step: "rent" },
  "window-too-long": { key: "counterRentals.new.notice.windowTooLong", step: "rent" },
  "no-units": { key: "counterRentals.new.notice.noUnits", step: "rent" },
  "too-many-units": { key: "counterRentals.new.notice.tooManyUnits", step: "rent" },
  "person-not-found": { key: "counterRentals.new.notice.personNotFound", step: "who" },
  "unit-not-found": { key: "counterRentals.new.notice.unitNotFound", step: "rent" },
  "unit-out-of-service": { key: "counterRentals.new.notice.unitOutOfService", step: "rent" },
  "unit-unavailable": {
    key: "counterRentals.new.notice.unitUnavailableUnnamed",
    named: "counterRentals.new.notice.unitUnavailable",
    step: "rent",
  },
  "unit-needs-service": {
    key: "counterRentals.new.notice.unitNeedsServiceUnnamed",
    named: "counterRentals.new.notice.unitNeedsService",
    step: "rent",
  },
  "unit-needs-confirm": {
    key: "counterRentals.new.notice.unitNeedsConfirmUnnamed",
    named: "counterRentals.new.notice.unitNeedsConfirm",
    step: "rent",
  },
  "not-certified": { key: "counterRentals.new.notice.notCertified", step: "who" },
  "no-drysuit-card": { key: "counterRentals.new.notice.noDrysuitCard", step: "who" },
  "card-recorded": { key: "counterRentals.new.notice.cardRecorded", step: "who", tone: "success" },
  "card-duplicate": { key: "counterRentals.new.notice.cardDuplicate", step: "who" },
  "card-not-recorded": { key: "counterRentals.new.notice.cardNotRecorded", step: "who" },
  "card-invalid": { key: "counterRentals.new.notice.cardInvalid", step: "who" },
  "not-authorized": { key: "counterRentals.new.notice.notAuthorized", step: "rent" },
  "payment-not-connected": { key: "counterRentals.new.notice.paymentNotConnected", step: "rent" },
  "needs-email": { key: "counterRentals.new.notice.needsEmail", step: "rent" },
  "needs-payment": { key: "counterRentals.new.notice.needsPayment", step: "rent" },
};
