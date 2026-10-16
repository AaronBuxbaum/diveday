import { seatExistingDiverAction, seatNewDiverAction } from "@/app/actions/seat-diver";
import {
  addAgencyListedCardsAction,
  agencyCheckAction,
} from "@/app/shop/[shopSlug]/divers/[personId]/agency-check-actions";
import type { AppDb } from "@/db/client";
import { markPartyPaidAction, previewPartyPaymentAction } from "../party-payment-actions";
import {
  confirmDiverIdentityAction,
  saveRosterEmergencyContactAction,
  splitDiverIdentityAction,
} from "../roster-identity-actions";
import { markPaymentAction } from "../roster-payment-actions";
import {
  addToWaitlistAction,
  carryWaitlistAction,
  createDirectTripInvitationAction,
  invitePastDiverAction,
  recordTripInvitationAction,
  removeBookingAction,
  setParticipantTypeAction,
  undoRemoveBookingAction,
  updateBookingPickupAction,
} from "../roster-seating-actions";
import { markRosterWaiverInPersonAction, sendNewWaiverAction } from "../roster-waiver-actions";
import { courseRosterActions } from "./course-roster-actions";
import { noteRosterActions } from "./note-roster-actions";
import { seatMoveFor } from "./seat-move";

/**
 * Every server action the Divers tab's roster posts to, bound to this
 * departure, plus the one read it needs to offer them: the departures a seat
 * may move to (`seatMoveFor`). Out of the route file so the page only places
 * the roster.
 */
export async function tripRosterActions({
  db,
  shop,
  shopSlug,
  tripId,
  trip,
  locale,
  now,
  mayRetireRefusal,
}: {
  db: AppDb;
  shop: { id: string; timezone: string };
  shopSlug: string;
  tripId: string;
  trip: { startsAt: Date; course: unknown };
  locale: string;
  now: Date;
  mayRetireRefusal: boolean;
}) {
  return {
    addBookingAction: seatNewDiverAction.bind(null, "trip-guests", shopSlug),
    addExistingDiverAction: seatExistingDiverAction.bind(null, "trip-guests", shopSlug),
    addToWaitlistAction: addToWaitlistAction.bind(null, shopSlug, tripId),
    createDirectTripInvitationAction: createDirectTripInvitationAction.bind(null, shopSlug, tripId),
    invitePastDiverAction: invitePastDiverAction.bind(null, shopSlug, tripId),
    markRosterWaiverInPersonAction: markRosterWaiverInPersonAction.bind(null, shopSlug, tripId),
    markPaymentAction: markPaymentAction.bind(null, shopSlug, tripId),
    previewPartyPaymentAction: previewPartyPaymentAction.bind(null, shopSlug, tripId),
    markPartyPaidAction: markPartyPaidAction.bind(null, shopSlug, tripId),
    removeBookingAction: removeBookingAction.bind(null, shopSlug, tripId),
    setParticipantTypeAction: setParticipantTypeAction.bind(null, shopSlug, tripId),
    // One door on this tab, desk or not: the arrivals window opens 36 hours
    // ahead, so a confirm made inside it is no evidence the diver was standing
    // at the counter (dive-domain review 2026-10-05).
    confirmDiverIdentityAction: confirmDiverIdentityAction.bind(null, shopSlug, tripId),
    splitDiverIdentityAction: splitDiverIdentityAction.bind(null, shopSlug, tripId),
    sendNewWaiverAction: mayRetireRefusal
      ? sendNewWaiverAction.bind(null, shopSlug, tripId)
      : undefined,
    ...courseRosterActions(Boolean(trip.course), shopSlug, tripId),
    ...noteRosterActions(shopSlug, tripId),
    saveRosterEmergencyContactAction: saveRosterEmergencyContactAction.bind(null, shopSlug, tripId),
    updateBookingPickupAction: updateBookingPickupAction.bind(null, shopSlug, tripId),
    recordTripInvitationAction: recordTripInvitationAction.bind(null, shopSlug, tripId),
    undoRemoveBookingAction: undoRemoveBookingAction.bind(null, shopSlug, tripId),
    carryWaitlistAction: carryWaitlistAction.bind(null, shopSlug, tripId),
    // The diver record's own check, bound to the shop only: each card names
    // its diver, and the action re-proves card, diver and staffer as it does
    // there (H-105).
    agencyCheckAction: agencyCheckAction.bind(null, shopSlug),
    agencyListedAction: addAgencyListedCardsAction.bind(null, shopSlug),
    moveSeat: await seatMoveFor({
      db,
      shopId: shop.id,
      shopSlug,
      tripId,
      startsAt: trip.startsAt,
      timeZone: shop.timezone,
      locale,
      now,
    }),
  };
}
