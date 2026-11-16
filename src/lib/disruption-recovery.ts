/** Staff follow-up is independent of delivery, boarding readiness, and money. */
export const RECOVERY_OUTCOMES = ["pending", "contacted", "declined", "rebooked"] as const;
export type RecoveryOutcome = (typeof RECOVERY_OUTCOMES)[number];

/** Immutable entries appended under the cancellation row's lock. No names or free text. */
export type RecoveryEvent = {
  attemptId: string;
  actorPersonId: string;
  recordedAt: string;
  outcome: RecoveryOutcome;
  replacementBookingId: string | null;
};

export function isRecoveryOutcome(value: string): value is RecoveryOutcome {
  return RECOVERY_OUTCOMES.some((outcome) => outcome === value);
}
