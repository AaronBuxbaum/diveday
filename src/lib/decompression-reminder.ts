import { isDiver, type ParticipantType } from "./participant-types";

/** The rostered jobs and standing ratings that put crew in the water. */
const DIVING_CREW_ROLES = ["instructor", "assistant_instructor", "divemaster"] as const;

/** One booked seat, as the reminder reads it. */
export type DecompressionSeat = {
  participantType?: ParticipantType | null;
  /** The desk released the seat (no-show, turned away): it will not dive. */
  released?: boolean;
};

/** Whether any crew member's roles put them in the water (`effectiveCrewRoles`). */
export function crewDives(crew: ReadonlyArray<{ roles: readonly string[] }>): boolean {
  return crew.some((member) =>
    member.roles.some((role) => DIVING_CREW_ROLES.some((r) => r === role)),
  );
}

/**
 * **Whether a decompression departure owes its crew the card reminder** (H-20261017-decompression-departure-reminds-crew,
 * issue #2384). One reminder per departure, never one per diver: DiveDay
 * records the recreational ladder and five recreational specialties, and no
 * technical or decompression card at all (the importer declines them by name),
 * so it cannot say who holds one. It can only say the boat needs the check.
 *
 * Shown when the shop marked the departure as past no-decompression limits
 * (`trips.exceeds_no_deco_limits`) and someone aboard dives: a booked diver
 * whose seat is still held, or a guide in the water. A boat of snorkelers and
 * riders, or one whose last diver was released, reads nothing, as the depth
 * advisory does. **An advisory, never a gate**: `readiness.ts`,
 * `trip-admission.ts` and the roll-call readiness do not read this.
 */
export function needsDecompressionCardReminder({
  exceedsNoDecoLimits,
  seats,
  divingCrew = false,
}: {
  exceedsNoDecoLimits: boolean | null | undefined;
  seats: readonly DecompressionSeat[];
  divingCrew?: boolean;
}): boolean {
  if (!exceedsNoDecoLimits) return false;
  return divingCrew || seats.some((seat) => !seat.released && isDiver(seat.participantType));
}
