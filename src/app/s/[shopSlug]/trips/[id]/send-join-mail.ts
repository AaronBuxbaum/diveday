import { issueBookingCapability } from "@/db/booking-capabilities";
import { getBookingForTrip } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { withErasureCoordinatedBookingSend } from "@/db/erasure-coordinated-send";
import { sendAndRecordNotification } from "@/db/notifications";
import type { shopBySlugCached } from "@/db/shops-cached";
import { getTripWithBooked } from "@/db/trips";
import { issueWaiverOnJoin, openJoinSignStep, settleJoinWaiverDelivery } from "@/db/waiver-issue";
import type { DiverLocale } from "@/i18n/settings";
import { readinessLinkPath, readinessWaiverLinkPath } from "@/lib/booking-capabilities";
import { readLearningMaterials } from "@/lib/courses";
import { packsLogbook } from "@/lib/diver-planning";
import { log } from "@/lib/log";
import {
  type Notification,
  notificationProviderSignal,
  publicAppUrl,
  recipientLocale,
} from "@/lib/notifications";
import { confirmationExtras } from "@/lib/notifications/confirmation-extras";
import type { ParticipantType } from "@/lib/participant-types";

function emailUrl(path: string): string | undefined {
  const origin = publicAppUrl();
  return origin ? new URL(path, `${origin}/`).toString() : undefined;
}

/**
 * Send the just-booked party's confirmation and any releases safely. The
 * lead's own release rides in the confirmation as the thread's Sign step, on
 * the readiness link it carries (issue #2743); every other seat's goes to
 * the address the lead typed for that member as a waiver-only door, never a
 * thread link (issues #3986, #4003).
 */
export async function sendJoinMail(
  db: AppDb,
  input: {
    shop: NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;
    trip: Awaited<ReturnType<typeof getTripWithBooked>>;
    lead: Awaited<ReturnType<typeof getBookingForTrip>>;
    primaryBookingId: string;
    bookings: readonly { bookingId: string; personId: string }[];
    ownLocale: DiverLocale | null;
    money: {
      chargesOnline: boolean;
      partyTypes: readonly ParticipantType[];
    };
  },
): Promise<void> {
  const { shop, trip, lead, primaryBookingId, bookings, ownLocale } = input;
  const { chargesOnline, partyTypes } = input.money;
  const leadPersonId =
    lead?.person.id ?? bookings.find((seat) => seat.bookingId === primaryBookingId)?.personId;
  let leadWaiver: Awaited<ReturnType<typeof openJoinSignStep>> = null;
  let confirmationSent = false;
  if (lead?.person.email && trip && leadPersonId) {
    try {
      const fenced = await withErasureCoordinatedBookingSend(
        db,
        {
          shopId: shop.id,
          bookingId: primaryBookingId,
          expectedPersonId: leadPersonId,
          expectedTripId: trip.id,
          expectedEmail: lead.person.email,
        },
        async (tx) => {
          const freshLead = await getBookingForTrip(tx, shop.id, trip.id, primaryBookingId);
          const freshTrip = await getTripWithBooked(tx, shop.id, trip.id);
          if (!freshLead?.person.email || !freshTrip) return null;
          const readiness = await issueBookingCapability(tx, {
            shopId: shop.id,
            bookingId: primaryBookingId,
            purpose: "readiness",
            expectedPersonId: leadPersonId,
            expectedTripId: trip.id,
            delivered: true,
          });
          if (publicAppUrl() && !readiness) return null;
          // No readiness link, no Sign step: it is that link's own page.
          const waiver = readiness ? await openJoinSignStep(tx, shop.id, primaryBookingId) : null;
          const delivery = await sendAndRecordNotification(
            tx,
            bookSpotConfirmation({
              shop,
              trip: freshTrip,
              confirmed: freshLead,
              to: freshLead.person.email,
              locale: recipientLocale(ownLocale ?? freshLead.person.locale, shop.defaultLocale),
              readinessUrl: readiness ? emailUrl(readinessLinkPath(readiness.token)) : undefined,
              waiverUrl:
                readiness && waiver
                  ? emailUrl(readinessWaiverLinkPath(readiness.token))
                  : undefined,
              chargesOnline,
              otherSeatTypes: partyTypes.slice(1),
            }),
            { signal: notificationProviderSignal() },
          );
          if (waiver && delivery.status === "sent") {
            await settleJoinWaiverDelivery(tx, {
              shopId: shop.id,
              bookingId: primaryBookingId,
              step: waiver,
              confirmationSent: true,
              confirmationProviderMessageId: delivery.providerMessageId,
            });
          }
          return { waiver, delivery };
        },
      );
      if (fenced) {
        leadWaiver = fenced.waiver;
        confirmationSent = fenced.delivery.status === "sent";
      }
      if (fenced?.delivery.status === "failed") {
        log("booking.confirmation_send_failed", "error", { bookingId: primaryBookingId });
      }
    } catch (error) {
      // Email must never turn a completed, capacity-safe booking into an error page.
      log("booking.waiver_link_failed", "error", {
        bookingId: primaryBookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
      log("booking.confirmation_prepare_failed", "error", {
        bookingId: primaryBookingId,
        errorCode: error instanceof Error ? error.name : "unknown_error",
      });
    }
  }

  await Promise.all(
    bookings.map(async ({ bookingId, personId }) => {
      try {
        if (bookingId === primaryBookingId && leadWaiver) {
          if (!confirmationSent)
            await settleJoinWaiverDelivery(db, {
              shopId: shop.id,
              bookingId,
              step: leadWaiver,
              confirmationSent: false,
            });
          return;
        }
        // The lead's own seat, when its confirmation could not carry the Sign
        // step, gets its thread link at the lead's own address. Every other
        // seat's address is one the lead typed: the send itself gives it a
        // waiver-only door, never a link that pays, cancels or moves the seat
        // (issues #3986, #4003).
        await issueWaiverOnJoin(db, shop.id, bookingId, {
          expectedPersonId: personId,
          expectedTripId: trip?.id,
        });
      } catch (error) {
        log("booking.waiver_on_join_failed", "error", {
          bookingId,
          errorCode: error instanceof Error ? error.name : "unknown_error",
        });
      }
    }),
  );
}

function bookSpotConfirmation(input: {
  shop: NonNullable<Awaited<ReturnType<typeof shopBySlugCached>>>;
  trip: NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
  confirmed: NonNullable<Awaited<ReturnType<typeof getBookingForTrip>>>;
  to: string;
  locale: DiverLocale;
  readinessUrl: string | undefined;
  /** The thread's Sign step on that same readiness link, when the lead owes a release. */
  waiverUrl: string | undefined;
  chargesOnline: boolean;
  otherSeatTypes: readonly ParticipantType[];
}): Notification {
  const { shop, trip, confirmed } = input;
  return {
    kind: "booking_confirmation",
    bookingId: confirmed.booking.id,
    shopId: shop.id,
    to: input.to,
    locale: input.locale,
    diverName: confirmed.person.fullName,
    shopName: shop.name,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    endsAt: trip.endsAt,
    timezone: shop.timezone,
    dockCallMinutes: shop.dockCallMinutes,
    readinessUrl: input.readinessUrl,
    waiverUrl: input.waiverUrl,
    packingList: shop.packingList,
    packingLogbook: packsLogbook({
      shopSuggests: shop.packingLogbook,
      introCourseSession: trip.course?.isIntroCourse === true,
      holdsCertification: false,
    }),
    learningMaterials: trip.course
      ? readLearningMaterials(trip.course.learningMaterials)
      : undefined,
    ...confirmationExtras({
      shop,
      trip,
      course: trip.course ?? null,
      participantType: confirmed.booking.participantType,
      partyTypes: input.otherSeatTypes,
      chargesOnline: input.chargesOnline,
      origin: publicAppUrl(),
    }),
  };
}
