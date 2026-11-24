import { and, eq } from "drizzle-orm";
import { bookingRecipient } from "@/db/booking-address";
import { issueBookingCapability } from "@/db/booking-capabilities";
import type { DbExecutor } from "@/db/client";
import { withErasureCoordinatedBookingSend } from "@/db/erasure-coordinated-send";
import { recordNotificationDelivery } from "@/db/notifications";
import { bookings, people, shops, trips } from "@/db/schema";
import { stopListedSmsProvider } from "@/db/sms-opt-outs";
import { liveTrip, seatNotCancelled } from "@/db/trips";
import { whatsAppProvidersForShops } from "@/db/whatsapp-accounts";
import { readinessLinkPath, seatAddressIsLeadTyped } from "@/lib/booking-capabilities";
import {
  type CourtesyChannel,
  type CourtesyProviders,
  notificationProviderSignal,
  publicAppUrl,
  recipientLocale,
  seatConfirmationText,
  sendCourtesyMessage,
  smsProviderFromEnvironment,
  smsRecipient,
} from "@/lib/notifications";

/**
 * What became of the seat-confirmation text.
 *
 * - `sent`: it left, on `channel` (the shop's WhatsApp, else SMS).
 * - `no_number`: nothing on file a text can reach.
 * - `held`: nothing was meant to leave (a rehearsal or a demo shop), or the
 *   seat's number was typed by a party's lead and proves no one.
 * - `not_sent`: it was tried and did not go: no SMS set up, the number sent
 *   STOP, a provider failure. Never retried (the SMS budget is $50 a month).
 */
export type SeatConfirmationText =
  | { status: "sent"; channel: CourtesyChannel }
  | { status: "no_number" | "held" | "not_sent" };

/**
 * **A staff-seated diver with a phone gets their ready link by text** ("Try it
 * Saturday", item 3). The seat confirmation used to be email only, so a diver
 * a shop seated with a phone and no address got nothing at all and boarded
 * unsigned unless the desk handed them a QR. Now the seat's own readiness
 * link (the waiver, the cert card and the sizes all live on it) goes to their
 * phone, by the courtesy rule (`sendCourtesyMessage`: the shop's WhatsApp when
 * connected, otherwise SMS, never to a number on the STOP list, in the
 * diver's locale). One text per seating, never retried.
 *
 * The link is the same live `readiness` capability the email carries
 * (`issueBookingCapability` hands back the live one), so a diver with both
 * gets one link twice, not two links.
 *
 * Every sent text also writes a `seat_text` delivery holding the provider's message id: the SMS
 * receipt handler marks it failed when the carrier later rejects the message, and the roster then
 * stops counting the seat as reachable by text (`textableSeats`, issue #4958).
 *
 * `tracked` is the phone-only case: with no email, this text *is* the
 * confirmation, and a sent one writes the booking's `booking_confirmation`
 * row the email would have written. Only a sent one: a failed row would put
 * a "Resend confirmation" on Today that has no email to resend to.
 */
export async function textStaffSeatingConfirmation(
  db: DbExecutor,
  shopId: string,
  bookingId: string,
  options: { tracked: boolean; providers?: CourtesyProviders },
): Promise<SeatConfirmationText> {
  const read = (executor: DbExecutor) =>
    executor
      .select({
        person: bookingRecipient,
        tripId: trips.id,
        startsAt: trips.startsAt,
        isRehearsal: trips.isRehearsal,
        shopName: shops.name,
        isDemo: shops.isDemo,
        timezone: shops.timezone,
        defaultLocale: shops.defaultLocale,
        contactTypedByLeadAt: bookings.contactTypedByLeadAt,
        claimedAt: bookings.claimedAt,
      })
      .from(bookings)
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
      .innerJoin(shops, eq(shops.id, bookings.shopId))
      .where(
        and(eq(bookings.id, bookingId), eq(bookings.shopId, shopId), seatNotCancelled, liveTrip()),
      )
      .limit(1);

  const [observed] = await read(db);
  if (!observed || !smsRecipient(observed.person.phone)) return { status: "no_number" };
  // A rehearsal sends nothing to anyone (ADR 20261012-rehearsal-departures);
  // a demo shop's sends are held the same way, and a minor's number a party's
  // lead typed cannot prove a guardian (issue #4003).
  if (observed.isRehearsal || observed.isDemo || seatAddressIsLeadTyped(observed)) {
    return { status: "held" };
  }
  const origin = publicAppUrl();
  if (!origin) return { status: "not_sent" };

  const outcome = await withErasureCoordinatedBookingSend(
    db,
    {
      shopId,
      bookingId,
      expectedPersonId: observed.person.id,
      expectedTripId: observed.tripId,
      expectedPhone: observed.person.phone,
    },
    async (tx): Promise<SeatConfirmationText> => {
      const [row] = await read(tx);
      const to = smsRecipient(row?.person.phone);
      if (!row || !to) return { status: "no_number" };
      const capability = await issueBookingCapability(tx, {
        shopId,
        bookingId,
        purpose: "readiness",
        expectedPersonId: observed.person.id,
        expectedTripId: observed.tripId,
        delivered: true,
      });
      if (!capability) return { status: "not_sent" };
      const locale = recipientLocale(row.person.locale, row.defaultLocale);
      const providers = options.providers ?? (await textProviders(tx, shopId));
      const { channel, delivery } = await sendCourtesyMessage(
        {
          to,
          shopName: row.shopName,
          locale,
          body: seatConfirmationText({
            locale,
            shopName: row.shopName,
            startsAt: row.startsAt,
            timezone: row.timezone,
            readinessUrl: new URL(readinessLinkPath(capability.token), `${origin}/`).toString(),
          }),
        },
        providers,
        { signal: notificationProviderSignal() },
      );
      if (delivery.status !== "sent") return { status: "not_sent" };
      // Every sent text keeps its provider message id, so a carrier failure that
      // arrives later as an SMS receipt finds this seat (issue #4958).
      await recordNotificationDelivery(tx, { shopId, bookingId, kind: "seat_text", delivery });
      if (options.tracked) {
        await recordNotificationDelivery(tx, {
          shopId,
          bookingId,
          kind: "booking_confirmation",
          delivery,
        });
      }
      return { status: "sent", channel };
    },
  );
  return outcome ?? { status: "not_sent" };
}

/** The shop's own WhatsApp sender when it connected one, and platform SMS behind the STOP list. */
async function textProviders(db: DbExecutor, shopId: string): Promise<CourtesyProviders> {
  const senders = await whatsAppProvidersForShops(db, [shopId]);
  return {
    sms: stopListedSmsProvider(db, smsProviderFromEnvironment()),
    whatsapp: senders.get(shopId) ?? null,
  };
}
