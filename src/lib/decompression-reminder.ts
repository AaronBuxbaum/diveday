import { isDiver, type ParticipantType } from "./participant-types";

/**
 * **Whether a decompression departure owes its crew the card reminder** (H-144,
 * issue #2384). One reminder per departure, never one per diver: DiveDay
 * records the recreational ladder and five recreational specialties, and no
 * technical or decompression card at all (the importer declines them by name),
 * so it cannot say which diver holds one. It can only say the boat needs the
 * check.
 *
 * Shown when the shop marked the departure as past no-decompression limits
 * (`trips.exceeds_no_deco_limits`) and at least one booked person dives. A boat
 * of snorkelers and riders is not diving, so it reads nothing, as the depth
 * advisory does for them. **An advisory, never a gate**: `readiness.ts` and
 * `trip-admission.ts` do not read this.
 */
export function needsDecompressionCardReminder(
  exceedsNoDecoLimits: boolean | null | undefined,
  participantTypes: ReadonlyArray<ParticipantType | null | undefined>,
): boolean {
  return Boolean(exceedsNoDecoLimits) && participantTypes.some(isDiver);
}
