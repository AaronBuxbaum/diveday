/** Complimentary classroom recovery never changes a seat, payment, or course evidence. */
export type RecoveryActivitySnapshot = {
  title: string;
  startsAt: string;
  endsAt: string;
  location: string;
  revision: number;
};
const RECOVERY_ACTIVITY_EVENT_CODES = [
  "identity_merged",
  "created",
  "offer_prepared",
  "place_confirmed",
  "place_cancelled",
  "activity_cancelled",
  "capacity_changed",
] as const;
export type RecoveryActivityEventCode = (typeof RECOVERY_ACTIVITY_EVENT_CODES)[number];
export function validRecoveryActivity(
  input: { title: string; location: string; startsAt: Date; endsAt: Date; capacity: number },
  now: Date,
): boolean {
  return (
    input.title.trim().length > 0 &&
    input.title.trim().length <= 120 &&
    input.location.trim().length > 0 &&
    input.location.trim().length <= 300 &&
    Number.isFinite(input.startsAt.getTime()) &&
    Number.isFinite(input.endsAt.getTime()) &&
    input.startsAt > now &&
    input.endsAt > input.startsAt &&
    Number.isSafeInteger(input.capacity) &&
    input.capacity >= 1 &&
    input.capacity <= 500
  );
}
