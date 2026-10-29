import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import {
  bookings,
  dateRequestOfferBookings,
  interests,
  people,
  personRoles,
  trips,
} from "./schema";

const ctx = fileScopedShopContext({ history: true });

it("keeps the id-only offer booking link after erasure scrubs its date request", async () => {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("setup: owner or trip missing");

  const [diver] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Diver to erase", email: "erase-offer@example.com" })
    .returning({ id: people.id });
  if (!diver) throw new Error("setup: diver missing");
  await db.insert(personRoles).values({ personId: diver.id, role: "diver" });

  const [booking] = await db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: diver.id, bookedAs: "diver" })
    .returning({ id: bookings.id });
  if (!booking) throw new Error("setup: booking missing");

  const [request] = await db
    .insert(interests)
    .values({
      shopId: shop.id,
      scope: "date",
      askedBy: "diver",
      personId: diver.id,
      interest: "reef dive",
      name: "Diver to erase",
      email: "erase-offer@example.com",
    })
    .returning({ id: interests.id });
  if (!request) throw new Error("setup: date request missing");

  const [offer] = await db
    .insert(interests)
    .values({
      shopId: shop.id,
      scope: "departure",
      askedBy: "diver",
      tripId: trip.id,
      parentInterestId: request.id,
      partySize: 1,
      offeredAt: nowDate(),
    })
    .returning({ id: interests.id });
  if (!offer) throw new Error("setup: offer missing");
  await db.insert(dateRequestOfferBookings).values({
    shopId: shop.id,
    interestId: offer.id,
    bookingId: booking.id,
  });

  const erased = await anonymizeDiver(db, {
    shopId: shop.id,
    personId: diver.id,
    actorPersonId: owner.id,
  });
  expect(erased.ok).toBe(true);

  const [scrubbedRequest] = await db
    .select({ name: interests.name, email: interests.email, message: interests.message })
    .from(interests)
    .where(eq(interests.id, request.id));
  expect(scrubbedRequest).toEqual({ name: null, email: null, message: null });

  const [link] = await db
    .select({
      interestId: dateRequestOfferBookings.interestId,
      bookingId: dateRequestOfferBookings.bookingId,
    })
    .from(dateRequestOfferBookings)
    .where(eq(dateRequestOfferBookings.bookingId, booking.id));
  expect(link).toEqual({ interestId: offer.id, bookingId: booking.id });

  const [erasedPerson] = await db
    .select({ fullName: people.fullName, email: people.email, anonymizedAt: people.anonymizedAt })
    .from(people)
    .where(eq(people.id, diver.id));
  expect(erasedPerson).toMatchObject({ fullName: "[anonymized]", email: null });
  expect(erasedPerson?.anonymizedAt).not.toBeNull();
});
