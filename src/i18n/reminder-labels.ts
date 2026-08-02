import type { ReminderActionCode } from "@/lib/readiness-summary";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * Every `ReminderActionCode` `reminderReadiness()` (src/lib/readiness-summary.ts)
 * can name as a diver's outstanding to-do before the dock, resolved here —
 * never earlier. Consumed by the reminder email (`src/lib/notifications/email.ts`),
 * so the same imperative reads identically across all lead times (docs ADR
 * 20260731-notification-locale).
 */
const REMINDER_ACTION_KEYS: Record<ReminderActionCode, DiverMessageKey> = {
  waiver_pending: "notifications.reminderAction.waiverPending",
  certification_missing: "notifications.reminderAction.certificationMissing",
  certification_expired: "notifications.reminderAction.certificationExpired",
  certification_insufficient: "notifications.reminderAction.certificationInsufficient",
  specialty_missing: "notifications.reminderAction.specialtyMissing",
  specialty_expired: "notifications.reminderAction.specialtyExpired",
  nitrox_missing: "notifications.reminderAction.nitroxMissing",
  payment_due: "notifications.reminderAction.paymentDue",
};

/** A reminder's outstanding-item imperative, e.g. "Sign your waiver". */
export function reminderActionText(t: DiverTranslator, code: ReminderActionCode): string {
  return t(REMINDER_ACTION_KEYS[code]);
}
