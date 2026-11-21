import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty } from "../../db/bookings";
import { bookings, people, personRoles, tripAssignments, tripReviews } from "../../db/schema/index";
import { upcomingTripsWithCounts } from "../../db/trips-queries.test-support";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import { anonymizeDiver } from "../records/anonymize";
import { readCrewThanks, ruleCrewThanks } from "./crew-thanks";
import { crewThanksChoice } from "./crew-thanks-choice";
import {
  getReviewForBooking,
  listPublishedShopReviews,
  listShopReviewsForStaff,
  readReviewsAwaitingModeration,
  submitTripReview,
} from "./reviews/store";

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

  /** The staff's tap in the review moderation queue (issue #4261). */
  async function rule(bookingId: string, ruling: "passed" | "held", ownerId: string) {
    const { db, shop } = ctx;
    const [row] = await db
      .select({ id: tripReviews.id })
      .from(tripReviews)
      .where(eq(tripReviews.bookingId, bookingId));
    return ruleCrewThanks(db, shop.id, row?.id ?? "", ruling, ownerId, nowDate());
  }

  it("keeps a thanks for a crew member of the departure, off the public page", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
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
    // Nothing reaches the crew until staff pass it on (issue #4261).
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect(await rule(bookingIds[0], "passed", ownerId)).toBe(true);
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

  it("drops a crafted post that names a crew member by person id (issue #3912)", async () => {
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

  it("drops a choice copied from another departure (issue #3912)", async () => {
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

  it("never hands the recap's form a person id (issue #3912)", async () => {
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

  it("keeps a one-tap thanks with no line, and takes it back when the revision names nobody", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "   " },
    });
    await rule(bookingIds[0], "passed", ownerId);
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([
      expect.objectContaining({ text: null }),
    ]);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: "", text: "Great day" },
    });
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect((await getReviewForBooking(db, bookingIds[0]))?.crewThanks).toBeNull();
  });

  it("never shows the crew words staff have not passed on (issue #4261)", async () => {
    const { db, shop, tripId, bookingIds, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    const thank = (text: string) =>
      submitTripReview(db, {
        bookingId: bookingIds[0],
        rating: 5,
        crewThanks: { choice: crewThanksChoice(tripId, crewId), text },
      });
    await thank("Great day");
    // Waiting: in the staff worklist and Today's count, never on the crew's Today.
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    const waiting = await listShopReviewsForStaff(db, shop.id, {
      scope: "waiting",
      withCrewThanks: true,
    });
    expect(waiting.reviews).toEqual([
      expect.objectContaining({ crewThanks: "Great day", crewThanksRuling: null }),
    ]);
    expect((await readReviewsAwaitingModeration(db, shop.id)).count).toBeGreaterThan(0);

    // Kept back: still never shown, and out of the worklist.
    expect(await rule(bookingIds[0], "held", ownerId)).toBe(true);
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect(
      (await listShopReviewsForStaff(db, shop.id, { scope: "waiting", withCrewThanks: true }))
        .reviews,
    ).toEqual([]);
    // The ruling records who made it.
    const [ruled] = await db
      .select({ by: tripReviews.crewThanksRuledByPersonId })
      .from(tripReviews)
      .where(eq(tripReviews.bookingId, bookingIds[0] ?? ""));
    expect(ruled?.by).toBe(ownerId);

    // Passed: shown. Resubmitting the same words keeps the ruling.
    await rule(bookingIds[0], "passed", ownerId);
    await thank("Great day");
    expect(await readCrewThanks(db, shop.id, crewId, since)).toHaveLength(1);

    // New words go back to waiting: the crew sees nothing until staff read them.
    await thank("Great day, and you owe me a beer");
    expect(await readCrewThanks(db, shop.id, crewId, since)).toEqual([]);
    expect(
      (await listShopReviewsForStaff(db, shop.id, { scope: "waiting", withCrewThanks: true }))
        .reviews,
    ).toEqual([expect.objectContaining({ crewThanksRuling: null })]);
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

  it("will not rule on another shop's thanks", async () => {
    const { db, tripId, bookingIds, shop, ownerId } = await reviewContext();
    const crewId = await crewMember(tripId);
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      crewThanks: { choice: crewThanksChoice(tripId, crewId), text: "Great day" },
    });
    const [review] = (await listShopReviewsForStaff(db, shop.id, { withCrewThanks: true })).reviews;
    expect(
      await ruleCrewThanks(db, OTHER_SHOP_ID, review?.id ?? "", "passed", ownerId, nowDate()),
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
    await rule(bookingIds[0], "passed", ownerId);
    expect(await readCrewThanks(db, shop.id, crewId, since)).toHaveLength(1);
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
  it("keeps the diver's words when the crew member they thank is erased (issue #3913)", async () => {
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
