import { and, eq, ne } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { log } from "@/lib/log";
import { type NotificationProvider, recipientLocale } from "@/lib/notifications";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import type { AppDb } from "./client";
import { sendNotification } from "./notifications";
import { bookings, people, shops, trips } from "./schema";

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
  input: { shopId: string; bookingId: string },
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
