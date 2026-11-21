import { and, eq, isNull } from "drizzle-orm";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { bookings, people, shops, trips } from "@/db/schema";
import { livePerson, liveTrip, seatNotCancelled } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { issuePartySeatClaims } from "./store";

async function groupContext(db: AppDb, shopId: string, leadBookingId: string, now: Date) {
  const [row] = await db
    .select({
      personId: bookings.personId,
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      tripStatus: trips.status,
      shopName: shops.name,
      timezone: shops.timezone,
      defaultLocale: shops.defaultLocale,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId), liveTrip()))
    .innerJoin(
      people,
      and(eq(people.id, bookings.personId), eq(people.shopId, shopId), livePerson()),
    )
    .innerJoin(shops, eq(shops.id, bookings.shopId))
    .where(
      and(
        eq(bookings.id, leadBookingId),
        eq(bookings.shopId, shopId),
        seatNotCancelled,
        isNull(bookings.partyLeadBookingId),
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .limit(1);
  return row && row.tripStatus === "scheduled" && row.startsAt > now ? row : null;
}

/** The organizer shares this narrower capability, never their own readiness link. */
export async function issueGroupSeatClaim(
  db: AppDb,
  input: { shopId: string; leadBookingId: string },
) {
  const now = nowDate();
  const context = await groupContext(db, input.shopId, input.leadBookingId, now);
  if (!context) return null;
  const seats = await issuePartySeatClaims(db, { ...input, now, issueClaims: false });
  if (
    !seats.some(
      (seat) =>
        !seat.claimed && seat.seatHeld && !seat.differentDeparture && !seat.groupHoldExpired,
    )
  )
    return null;
  return issueBookingCapability(db, {
    shopId: input.shopId,
    bookingId: input.leadBookingId,
    purpose: "group_claim",
    expectedPersonId: context.personId,
    expectedTripId: context.tripId,
    now,
  });
}

/** Public group view: only names on available seats and their existing single-seat claim door. */
export async function getGroupClaimPageData(db: AppDb, token: string) {
  const now = nowDate();
  const capability = await verifyBookingCapability(db, { token, purpose: "group_claim", now });
  if (!capability) return null;
  const context = await groupContext(db, capability.shopId, capability.bookingId, now);
  if (!context) return null;
  const rows = await issuePartySeatClaims(db, {
    shopId: capability.shopId,
    leadBookingId: capability.bookingId,
    now,
  });
  return {
    shopName: context.shopName,
    title: context.title,
    startsAt: context.startsAt,
    endsAt: context.endsAt,
    timezone: context.timezone,
    defaultLocale: context.defaultLocale,
    seats: rows.flatMap((seat) =>
      !seat.claimed && !seat.differentDeparture && seat.claim
        ? [{ seatName: seat.seatName, claim: seat.claim }]
        : [],
    ),
  };
}
