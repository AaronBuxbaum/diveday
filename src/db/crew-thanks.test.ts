import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createBookingParty } from "./bookings";
import { readCrewThanks, setCrewThanksHidden } from "./crew-thanks";
import {
  getReviewForBooking,
  listPublishedShopReviews,
  listShopReviewsForStaff,
  submitTripReview,
} from "./reviews";
import { bookings, people, tripAssignments } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";
const ctx = fileScopedShopContext();

/** A seeded reef departure with one booked diver, and the seeded owner who reviews and moderates. */
async function reviewContext(divers = ["Reviewing Diver"]) {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => !trip.course && trip.capacity - trip.booked >= divers.length);
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(
    db,
    divers.map((fullName, index) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName,
      email: `thanks-diver-${index}@example.com`,
    })),
  );
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
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

describe("thanks to the crew (loop 5, row 6)", () => {
  async function crewMember(tripId: string) {
    const { db, shop } = ctx;
    const [person] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
      .limit(1);
    if (!person) throw new Error("seeded crew missing");
    await db.insert(tripAssignments).values({ tripId, personId: person.id }).onConflictDoNothing();
    return person.id;
  }

  const since = new Date(0);

  it("keeps a thanks for a crew member of the departure, off the public page", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    const result = await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "  Dana made my first wreck easy  " },
    });
    // A thanks is not review words: the bare rating still publishes at once.
    expect(result).toEqual({ ok: true, published: true, updated: false });
    expect(await getReviewForBooking(db, bookingIds[0])).toMatchObject({
      crewThanks: "Dana made my first wreck easy",
      crewThanksPersonId: crewId,
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([
      expect.objectContaining({ text: "Dana made my first wreck easy" }),
    ]);
    const published = await listPublishedShopReviews(db, shop.id);
    expect(JSON.stringify(published)).not.toContain("first wreck");
  });

  it("drops a thanks for somebody who was not on the departure's crew", async () => {
    const { db, shop, bookingIds, ownerId } = await reviewContext();
    // The owner is not rostered on this trip.
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 4,
      crewThanks: { crewPersonId: ownerId, text: "Thanks" },
    });
    expect((await getReviewForBooking(db, bookingIds[0]))?.crewThanks).toBeNull();
    expect(await readCrewThanks(db, shop.id, ownerId, since)).toEqual([]);
  });

  it("takes the thanks back when the revised review leaves it blank", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "Great day" },
    });
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "   " },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
  });

  it("lets staff hide a thanks from the crew, and a changed line comes back unhidden", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "Great day" },
    });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    expect(review).toMatchObject({ crewThanks: "Great day", crewThanksHidden: false });
    expect(await setCrewThanksHidden(db, shop.id, review?.id ?? "", true, nowDate())).toBe(true);
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect((await listShopReviewsForStaff(db, shop.id)).reviews[0]?.crewThanksHidden).toBe(true);

    // The same words stay hidden; new words are unread, so they show.
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "Great day" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "Even better" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toHaveLength(1);
  });

  it("will not hide another shop's thanks", async () => {
    const { db, tripId, bookingIds, shop } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "Great day" },
    });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    expect(await setCrewThanksHidden(db, OTHER_SHOP_ID, review?.id ?? "", true, nowDate())).toBe(
      "not_found",
    );
  });

  it("is gone with the diver's erasure", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { crewPersonId: crewId, text: "Great day" },
    });
    const [booking] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingIds[0] ?? ""));
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking?.personId ?? "",
      actorPersonId: ownerId,
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect((await getReviewForBooking(db, bookingIds[0]))?.crewThanks).toBeNull();
  });
});
