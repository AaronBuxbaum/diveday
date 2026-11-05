import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { crewThanksChoice } from "@/lib/crew-thanks-choice";
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
import { bookings, people, personRoles, tripAssignments, tripReviews } from "./schema";
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
      crewThanks: {
        choice: crewThanksChoice(tripId, crewId),
        text: "  Dana made my first wreck easy  ",
      },
    });
    // A thanks is not review words: the bare rating still publishes at once.
    expect(result).toEqual({ ok: true, published: true, updated: false });
    expect(await getReviewForBooking(db, bookingIds[0])).toMatchObject({
      crewThanks: "Dana made my first wreck easy",
      crewThanksChoice: crewThanksChoice(tripId, crewId),
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([
      expect.objectContaining({ text: "Dana made my first wreck easy" }),
    ]);
    const published = await listPublishedShopReviews(db, shop.id);
    expect(JSON.stringify(published)).not.toContain("first wreck");
  });

  it("drops a thanks for somebody who was not on the departure's crew", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    // The owner is not rostered on this trip.
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 4,
      crewThanks: { choice: crewThanksChoice(tripId, ownerId), text: "Thanks" },
    });
    expect((await getReviewForBooking(db, bookingIds[0]))?.crewThanks).toBeNull();
    expect(await readCrewThanks(db, shop.id, ownerId, since)).toEqual([]);
  });

  it("drops a crafted post that names a crew member by person id (#3912)", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 4,
      crewThanks: { choice: crewId, text: "Thanks" },
    });
    expect((await getReviewForBooking(db, bookingIds[0]))?.crewThanks).toBeNull();
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
  });

  it("drops a choice copied from another departure (#3912)", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    const otherTrip = (await upcomingTripsWithCounts(db, shop.id)).find((t) => t.id !== tripId);
    if (!otherTrip) throw new Error("second trip missing");
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 4,
      crewThanks: { choice: crewThanksChoice(otherTrip.id, crewId), text: "Thanks" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
  });

  it("never hands the recap's form a person id (#3912)", async () => {
    const { db, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    const own = await getReviewForBooking(db, bookingIds[0]);
    expect(own).toMatchObject({ crewThanksChoice: crewThanksChoice(tripId, crewId) });
    expect(JSON.stringify(own)).not.toContain(crewId);
  });

  it("takes the thanks back when the revised review leaves it blank", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "   " },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
  });

  it("lets staff hide a thanks from the crew, and a revision by the diver cannot undo it (M1)", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    const [review] = (await listShopReviewsForStaff(db, shop.id, { withCrewThanks: true })).reviews;
    expect(review).toMatchObject({ crewThanks: "Great day", crewThanksHidden: false });
    expect(await setCrewThanksHidden(db, shop.id, review?.id ?? "", true, ownerId, nowDate())).toBe(
      true,
    );
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect(
      (await listShopReviewsForStaff(db, shop.id, { withCrewThanks: true })).reviews[0]
        ?.crewThanksHidden,
    ).toBe(true);

    // The hide records who made it.
    const [hiddenRow] = await db
      .select({ by: tripReviews.crewThanksHiddenByPersonId })
      .from(tripReviews)
      .where(eq(tripReviews.id, review?.id ?? ""));
    expect(hiddenRow?.by).toBe(ownerId);

    // The same words stay hidden, and so do changed words: only staff show a line again.
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day!" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    // Taking the line back and writing a new one does not get round it either.
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Something else" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    // Staff showing it again is the one way back.
    expect(
      await setCrewThanksHidden(db, shop.id, review?.id ?? "", false, ownerId, nowDate()),
    ).toBe(true);
    expect(await readCrewThanks(db, shop.id, crewId, since)).toHaveLength(1);
  });

  it("shows the ledger's thanks only when the reader may see it (M3)", async () => {
    const { db, shop, tripId, bookingIds } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    const crewView = (await listShopReviewsForStaff(db, shop.id)).reviews[0];
    expect(crewView).toMatchObject({ crewThanks: null, crewThanksFor: null });
    const ownerView = (await listShopReviewsForStaff(db, shop.id, { withCrewThanks: true }))
      .reviews[0];
    expect(ownerView).toMatchObject({ crewThanks: "Great day" });
  });

  it("will not hide another shop's thanks", async () => {
    const { db, tripId, bookingIds, shop, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    const [review] = (await listShopReviewsForStaff(db, shop.id, { withCrewThanks: true })).reviews;
    expect(
      await setCrewThanksHidden(db, OTHER_SHOP_ID, review?.id ?? "", true, ownerId, nowDate()),
    ).toBe("not_found");
  });

  it("is gone with the diver's erasure", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
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

  // Aaron, 2026-11-05 (#3913, option B): the words are the diver's. Erasing the
  // crew member they name removes that person's own data and leaves the diver's
  // line and its pointer where they are.
  it("keeps the diver's words when the crew member they thank is erased (#3913)", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    const [crew] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Keiko Thanked" })
      .returning({ id: people.id });
    if (!crew) throw new Error("crew insert failed");
    await db.insert(personRoles).values({ personId: crew.id, role: "divemaster" });
    await db.insert(tripAssignments).values({ tripId, personId: crew.id });
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: {
        choice: crewThanksChoice(tripId, crew.id),
        text: "Keiko made my first wreck easy",
      },
    });
    // Offboarded first: a staff member is never erased while they hold a staff role.
    await db.delete(personRoles).where(eq(personRoles.personId, crew.id));
    await db.insert(personRoles).values({ personId: crew.id, role: "diver" });
    expect(
      await anonymizeDiver(db, { shopId: shop.id, personId: crew.id, actorPersonId: ownerId }),
    ).toMatchObject({ ok: true });
    const [review] = await db
      .select({ text: tripReviews.crewThanks, personId: tripReviews.crewThanksPersonId })
      .from(tripReviews)
      .where(eq(tripReviews.bookingId, bookingIds[0] ?? ""));
    expect(review).toEqual({ text: "Keiko made my first wreck easy", personId: crew.id });
  });
});
