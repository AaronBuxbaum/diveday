import type { ParticipantType } from "@/lib/participant-types";
import type { DiverMessageKey, DiverTranslator } from "./messages";

export {
  STAFF_JOINED_DIVING_KEYS,
  STAFF_LEFT_DIVING_KEYS,
  STAFF_PARTICIPANT_TYPE_KEYS,
  STAFF_PASSENGER_COUNT_KEYS,
  staffJoinedDivingLabel,
  staffLeftDivingLabel,
  staffParticipantTypeLabel,
  staffPassengerCount,
  staffPassengerSplit,
  staffSeatTypeNote,
  staffSoulsOnBoardLine,
} from "./staff-participant-labels";

/** The same three words in the diver bundle. */
export const DIVER_PARTICIPANT_TYPE_KEYS: Record<ParticipantType, DiverMessageKey> = {
  diver: "participants.type.diver",
  snorkeler: "participants.type.snorkeler",
  rider: "participants.type.rider",
};

/**
 * The booking form's "Joining as" options, each carrying its price
 * (`{price}`, already formatted, or the word for free).
 */
export const DIVER_PARTICIPANT_CHOICE_KEYS: Record<ParticipantType, DiverMessageKey> = {
  diver: "participants.choice.diver",
  snorkeler: "participants.choice.snorkeler",
  rider: "participants.choice.rider",
};

/** The same options when the departure states no price for that seat. */
export const DIVER_PARTICIPANT_CHOICE_UNPRICED_KEYS: Record<ParticipantType, DiverMessageKey> = {
  diver: "participants.choiceUnpriced.diver",
  snorkeler: "participants.choiceUnpriced.snorkeler",
  rider: "participants.choiceUnpriced.rider",
};

/**
 * The words on one trip line of a Stripe checkout: the trip's title, marked
 * as a deposit when it is one, and naming the seat when it is not a diver's,
 * so a party of a diver and a rider reads as two different things on the
 * hosted page and the receipt.
 */
export function describeCheckoutLine(
  t: DiverTranslator,
  parts: { isDeposit: boolean; tripTitle: string; participantType?: ParticipantType },
): string {
  const { isDeposit, tripTitle, participantType } = parts;
  if (participantType && participantType !== "diver") {
    const type = t(DIVER_PARTICIPANT_TYPE_KEYS[participantType]);
    return isDeposit
      ? t("checkoutLine.seatDeposit", { tripTitle, type })
      : t("checkoutLine.seatFull", { tripTitle, type });
  }
  return isDeposit
    ? t("checkoutLine.deposit", { tripTitle })
    : t("checkoutLine.full", { tripTitle });
}
