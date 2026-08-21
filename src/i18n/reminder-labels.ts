import type { ReminderActionCode } from "@/lib/readiness-summary";
import type { DiverMessageKey, DiverTranslator } from "./messages";

/**
 * Every `ReminderActionCode` `reminderReadiness()` (src/lib/readiness-summary.ts)
 * can name as a diver's outstanding to-do before the dock, resolved here —
 * never earlier. Consumed by both the reminder email
 * (`src/lib/notifications/email.ts`) and the reminder SMS (`src/db/reminders.ts`),
 * so the same imperative reads identically in both channels (docs ADR
 * 20260731-notification-locale).
 */
const REMINDER_ACTION_KEYS: Record<ReminderActionCode, DiverMessageKey> = {
  waiver_pending: "notifications.reminderAction.waiverPending",
  // Names the expiry rather than repeating "Sign your waiver": the diver is
  // holding a link they may already have found dead, and a reminder that
  // ignores that reads as the shop not having noticed. The fresh link lives one
  // tap away on the readiness page the same message links to — never in the
  // reminder itself (see `REMINDER_ACTION_CODES`).
  waiver_expired: "notifications.reminderAction.waiverExpired",
  certification_missing: "notifications.reminderAction.certificationMissing",
  certification_insufficient: "notifications.reminderAction.certificationInsufficient",
  certification_self_declared: "notifications.reminderAction.certificationSelfDeclared",
  nitrox_self_declared: "notifications.reminderAction.nitroxSelfDeclared",
  specialty_missing: "notifications.reminderAction.specialtyMissing",
  nitrox_missing: "notifications.reminderAction.nitroxMissing",
  payment_due: "notifications.reminderAction.paymentDue",
};

/** A reminder's outstanding-item imperative, e.g. "Sign your waiver". */
export function reminderActionText(t: DiverTranslator, code: ReminderActionCode): string {
  return t(REMINDER_ACTION_KEYS[code]);
}
