import { and, eq } from "drizzle-orm";
import { createBookingParty } from "../../db/bookings";
import { people } from "../../db/schema/index";
import { livePerson, upcomingTripsWithCounts } from "../../db/trips";
import type { fileScopedShopContext } from "../../test/db";

export async function buildReviewContext(
  ctx: ReturnType<typeof fileScopedShopContext>,
  divers = ["Reviewing Diver"],
) {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const bookableCharters = trips.filter((trip) => !trip.course);
  const reef =
    bookableCharters.find(
      (trip) =>
        trip.title.startsWith("Two-Tank Reef — Molasses") &&
        trip.capacity - trip.booked >= divers.length,
    ) ?? bookableCharters.find((trip) => trip.capacity - trip.booked >= divers.length);
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(
    db,
    divers.map((fullName, index) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName,
      email: `review-diver-${index}@example.com`,
    })),
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  // Every moderation act names who made it, so these tests need a real staff
  // person (ADR 20260813-review-moderation-has-a-floor).
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes"), livePerson()))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  return {
    db,
    shop,
    ownerId: owner.id,
    tripId: reef.id,
    bookingIds: party.bookings.map((b) => b.bookingId),
  };
}
