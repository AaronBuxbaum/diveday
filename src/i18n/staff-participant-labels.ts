import {
  hasNonDivers,
  joinedDiving,
  joinPassengerSplit,
  leftDiving,
  type NonDiverParticipantType,
  type ParticipantCounts,
  type ParticipantType,
} from "@/lib/participant-types";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * The words for who is aboard (ADR 20261007-participant-types). `src/lib`
 * hands back a `ParticipantType` code; this file picks the word, once per
 * bundle, so a snorkeler reads the same on the roster, the manifest, roll call
 * and the offline sheet.
 *
 * Every key is spelled out rather than built with a template literal, so the
 * message-key type checking stays static.
 */
export const STAFF_PARTICIPANT_TYPE_KEYS: Record<ParticipantType, StaffMessageKey> = {
  diver: "manifest.participantType.diver",
  snorkeler: "manifest.participantType.snorkeler",
  rider: "manifest.participantType.rider",
};

/** A seat's type as the crew reads it: "Diver", "Snorkeler", "Rider". */
export function staffParticipantTypeLabel(t: StaffTranslator, type: ParticipantType): string {
  return t(STAFF_PARTICIPANT_TYPE_KEYS[type]);
}

/**
 * A seat that left the water after it was sold to dive, in warning tone on
 * every crew surface: "Snorkeling, booked as diver" (`leftDiving`).
 */
export const STAFF_LEFT_DIVING_KEYS: Record<NonDiverParticipantType, StaffMessageKey> = {
  snorkeler: "manifest.participantType.bookedAsDiver.snorkeler",
  rider: "manifest.participantType.bookedAsDiver.rider",
};

export function staffLeftDivingLabel(t: StaffTranslator, type: NonDiverParticipantType): string {
  return t(STAFF_LEFT_DIVING_KEYS[type]);
}

/**
 * A seat diving now that was sold as something else, in the same warning
 * tone: "Diving, booked as snorkeler" (`joinedDiving`).
 */
export const STAFF_JOINED_DIVING_KEYS: Record<NonDiverParticipantType, StaffMessageKey> = {
  snorkeler: "manifest.participantType.bookedAsNonDiver.snorkeler",
  rider: "manifest.participantType.bookedAsNonDiver.rider",
};

export function staffJoinedDivingLabel(t: StaffTranslator, type: NonDiverParticipantType): string {
  return t(STAFF_JOINED_DIVING_KEYS[type]);
}

/**
 * The warning note a seat whose type moved since it was sold carries beside
 * its name, either direction, or null when it is doing what it was sold as.
 */
export function staffSeatTypeNote(
  t: StaffTranslator,
  seat: { participantType?: ParticipantType | null; bookedAs?: ParticipantType | null },
): string | null {
  const left = leftDiving(seat);
  if (left) return staffLeftDivingLabel(t, left);
  const joined = joinedDiving(seat);
  return joined ? staffJoinedDivingLabel(t, joined) : null;
}

/** One term of the passenger split, per type: "8 divers". */
export const STAFF_PASSENGER_COUNT_KEYS: Record<ParticipantType, StaffMessageKey> = {
  diver: "manifest.passengerDivers",
  snorkeler: "manifest.passengerSnorkelers",
  rider: "manifest.passengerRiders",
};

/** "8 divers · 3 snorkelers · 1 rider", leaving out a type nobody is. */
export function staffPassengerSplit(t: StaffTranslator, counts: ParticipantCounts): string {
  return joinPassengerSplit(counts, (type, count) =>
    t(STAFF_PASSENGER_COUNT_KEYS[type], { count }),
  );
}

/**
 * The printed manifest's souls-on-board line. Everyone the boat carries is a
 * passenger, divers or not (ADR 20261007-participant-types); the split is
 * printed when there is one, because "12" read over the radio is a different
 * number from "8 divers" to a rescuer counting heads in the water.
 */
export function staffSoulsOnBoardLine(
  t: StaffTranslator,
  summary: { totalDivers: number; byType?: ParticipantCounts },
  crew: number,
  physicalTotal: number = summary.totalDivers + crew,
): string {
  const counts = { passengers: summary.totalDivers, crew, souls: physicalTotal };
  const overlap = summary.totalDivers + crew - physicalTotal;
  const qualifier =
    overlap > 0 ? ` · ${t("manifest.soulsOnBoardOverlap", { count: overlap })}` : "";
  return (
    (summary.byType && hasNonDivers(summary.byType)
      ? t("manifest.soulsOnBoardLineSplit", {
          ...counts,
          split: staffPassengerSplit(t, summary.byType),
        })
      : t("manifest.soulsOnBoardLine", counts)) + qualifier
  );
}

/**
 * The incident record's passenger figure: the plain count, or the count with
 * who was diving when anybody aboard was not. A document written before the
 * split existed carries none, and prints the plain count.
 */
export function staffPassengerCount(
  t: StaffTranslator,
  summary: { totalDivers: number; byType?: unknown },
): number | string {
  const byType = summary.byType as ParticipantCounts | undefined;
  return byType && hasNonDivers(byType)
    ? t("manifest.passengersWithSplit", {
        passengers: summary.totalDivers,
        split: staffPassengerSplit(t, byType),
      })
    : summary.totalDivers;
}
