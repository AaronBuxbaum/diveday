import type { CoursePricing } from "@/lib/courses";
import { seatBalanceOwedCents, seatListPriceCents } from "@/lib/deposits";
import type { ParticipantPricing, ParticipantType } from "@/lib/participant-types";

/**
 * The balance for a seat represented by joined trip, course, and payment
 * columns. The course title is the join-presence sentinel; its price columns
 * remain independently nullable. Callers keep their joins and tenant scope.
 */
export function seatBalanceOwedCentsFromJoinedRow(input: {
  trip: { priceCents: number | null } & ParticipantPricing;
  participantType: ParticipantType;
  courseTitle: string | null;
  coursePriceCents: number | null;
  courseELearningPriceCents: number | null;
  paymentStatus: string | null;
  paymentAmountCents: number | null;
}): number | null {
  const course: CoursePricing | null =
    input.courseTitle !== null
      ? {
          title: input.courseTitle,
          priceCents: input.coursePriceCents,
          eLearningPriceCents: input.courseELearningPriceCents,
        }
      : null;
  const listPriceCents = seatListPriceCents(input.trip, course, input.participantType);
  return seatBalanceOwedCents(
    listPriceCents,
    input.paymentStatus
      ? { status: input.paymentStatus, amountCents: input.paymentAmountCents }
      : null,
  );
}
