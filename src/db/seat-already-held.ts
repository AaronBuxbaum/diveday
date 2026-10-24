import { and, eq, isNull, ne } from "drizzle-orm";
import type { DiverLocale } from "@/i18n/settings";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, recipientLocale } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import type { AppDb } from "./client";
import { sendNotification } from "./notifications";
import { bookings, people, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **Tell the holder of a seat that a claim link was tried with their address**
 * (#2381, Aaron's option b). The claim page answers a claim for an address that
 * already holds a seat on the trip exactly as it answers one that worked, so
 * the link holder learns nothing about the manifest. The only answer goes here:
 * to the address that owns it, naming the seat that address already holds.
 *
 * Says nothing about the seat the claim was for, the organizer, or who tried:
 * the holder learns only their own seat. Bounded per booking
 * (`readinessLinkResendByBooking`'s five an hour, in this note's own key space)
 * so a loop of claims cannot become a mail bomb to the holder. Carries no link,
 * so it mints no capability that could rotate out a link the holder is using.
 * Never throws: the claimant has been answered already, and a failed note is
 * nothing for them to see.
 */
export type SeatAlreadyHeldOutcome = "sent" | "not_sent" | "throttled" | "skipped";

export async function tellSeatAlreadyHeld(
  db: AppDb,
  input: { shopId: string; bookingId: string; attempt: "claim" | "booking" },
  options: { provider?: NotificationProvider; now?: Date } = {},
): Promise<SeatAlreadyHeldOutcome> {
  try {
    const [row] = await db
      .select({ booking: bookings, person: people, trip: trips, shop: shops })
      .from(bookings)
      .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
      .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
      .innerJoin(shops, eq(shops.id, bookings.shopId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          ne(bookings.status, "cancelled"),
        ),
      )
      .limit(1);
    if (!row?.person.email) return "skipped";
    const limit = await checkRateLimit(
      rateLimitKey("seat-already-held", input.bookingId),
      RATE_LIMITS.readinessLinkResendByBooking,
    );
    if (!limit.allowed) return "throttled";
    const delivery = await sendNotification(
      db,
      {
        kind: "seat_already_held",
        heldBookingId: row.booking.id,
        shopId: input.shopId,
        to: row.person.email,
        locale: recipientLocale(row.person.locale, row.shop.defaultLocale),
        diverName: row.person.fullName,
        shopName: row.shop.name,
        tripTitle: row.trip.title,
        startsAt: row.trip.startsAt,
        timezone: row.shop.timezone,
        requestedAt: options.now ?? nowDate(),
        attempt: input.attempt,
      },
      options.provider,
    );
    return delivery.status === "sent" ? "sent" : "not_sent";
  } catch (error) {
    log("seat_already_held.failed", "error", {
      bookingId: input.bookingId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return "not_sent";
  }
}

/**
 * The live seat an address already holds on a departure, for the note to its
 * holder (`tellSeatAlreadyHeld`). The public booking form's refusal says which
 * party member was refused, not which seat they hold, so it is found again
 * here, after the party rolled back. Null when it cannot be told: a member with
 * no address, or a duplicate inside the same party, whose seat rolled back too.
 */
export async function heldSeatOnTrip(
  db: AppDb,
  input: { shopId: string; tripId: string; email: string },
): Promise<{ shopId: string; bookingId: string } | null> {
  const address = input.email.trim().toLowerCase();
  if (!address) return null;
  const [held] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(people, and(eq(people.id, bookings.personId), eq(people.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        eq(people.email, address),
        isNull(people.deletedAt),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  return held ? { shopId: input.shopId, bookingId: held.id } : null;
}

/**
 * **Tell a party's lead that the party did not book** (#2691, Aaron's
 * 2026-10-24 decision). `createBookingParty` rolls back every seat when one
 * member already holds one, and the form answers with a neutral page that
 * names nobody, so the outcome goes to the lead's typed address instead, in
 * words that do not say which member holds the seat.
 *
 * Bounded per lead address and departure (five an hour, the held-seat note's
 * own allowance) so a loop of submissions cannot become a mail bomb to
 * whatever address was typed as the lead. Carries no link. Never throws: the
 * submitter has been answered already.
 */
export async function tellPartyNotBooked(
  db: AppDb,
  input: { shopId: string; tripId: string; to: string; leadName: string; locale: DiverLocale },
  options: { provider?: NotificationProvider; now?: Date } = {},
): Promise<SeatAlreadyHeldOutcome> {
  try {
    const [row] = await db
      .select({ trip: trips, shop: shops })
      .from(trips)
      .innerJoin(shops, eq(shops.id, trips.shopId))
      .where(and(liveTrip(), eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
      .limit(1);
    if (!row) return "skipped";
    const limit = await checkRateLimit(
      rateLimitKey("party-not-booked", input.shopId, input.tripId, input.to.trim().toLowerCase()),
      RATE_LIMITS.readinessLinkResendByBooking,
    );
    if (!limit.allowed) return "throttled";
    const delivery = await sendNotification(
      db,
      {
        kind: "party_not_booked",
        shopId: input.shopId,
        tripId: input.tripId,
        to: input.to.trim(),
        locale: input.locale,
        leadName: input.leadName,
        shopName: row.shop.name,
        tripTitle: row.trip.title,
        startsAt: row.trip.startsAt,
        timezone: row.shop.timezone,
        requestedAt: options.now ?? nowDate(),
      },
      options.provider,
    );
    return delivery.status === "sent" ? "sent" : "not_sent";
  } catch (error) {
    log("party_not_booked.failed", "error", {
      tripId: input.tripId,
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return "not_sent";
  }
}
