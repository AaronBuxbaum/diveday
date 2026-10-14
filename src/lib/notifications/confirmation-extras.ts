import type { CoursePricing } from "@/lib/courses";
import {
  type CancellationTrip,
  cancellationDeadline,
  type DepositTrip,
  seatMoneyTerms,
} from "@/lib/deposits";
import { meetingPointForMessage, meetingPointOfRows } from "@/lib/meeting-point";
import { toShopCurrency } from "@/lib/money";
import type { ParticipantPricing, ParticipantType } from "@/lib/participant-types";
import { publicTripCalendarPath } from "@/lib/public-routes";
import type { Notification } from "./kinds";

type BookingConfirmation = Extract<Notification, { kind: "booking_confirmation" }>;

/**
 * **What a confirmation carries besides the time** (ux review 2026-10-11,
 * items 4 and 5): where to go, a calendar link, this seat's money and the
 * free-cancellation window — the four things a diver used to reopen the trip
 * page for. One composer, so the confirmation sent at booking and the one a
 * staffer re-sends cannot say different things.
 *
 * The calendar link is the departure's public `.ics`, a page anybody may open:
 * it carries no capability. Absent with no public origin configured.
 */
export function confirmationExtras(input: {
  shop: Parameters<typeof meetingPointOfRows>[0] & { slug: string; currency: string | null };
  trip: Parameters<typeof meetingPointOfRows>[1] &
    DepositTrip &
    ParticipantPricing &
    CancellationTrip & { id: string };
  course: CoursePricing | null;
  participantType: ParticipantType;
  /** Whether this booking went to a card checkout (the shop takes payment online). */
  chargesOnline: boolean;
  origin: string | null;
  /** What the party's completed card checkout settled (`settledPartyPayment`), when it has. */
  partyPaid?: BookingConfirmation["partyPaid"] | null;
}): Pick<
  BookingConfirmation,
  "meetingPoint" | "calendarUrl" | "money" | "partyPaid" | "freeCancellationUntil"
> {
  const { shop, trip } = input;
  const money = seatMoneyTerms(trip, input.course, input.participantType, input.chargesOnline);
  const freeCancellationUntil = cancellationDeadline(trip);
  return {
    meetingPoint: meetingPointForMessage(meetingPointOfRows(shop, trip)),
    ...(input.origin
      ? {
          calendarUrl: new URL(
            publicTripCalendarPath(shop.slug, trip.id),
            `${input.origin}/`,
          ).toString(),
        }
      : {}),
    ...(money ? { money: { ...money, currency: toShopCurrency(shop.currency) } } : {}),
    ...(input.partyPaid ? { partyPaid: input.partyPaid } : {}),
    ...(freeCancellationUntil ? { freeCancellationUntil } : {}),
  };
}
