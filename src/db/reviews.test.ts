import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ratingIsWithheld, reviewsToRepublishForRating } from "@/lib/reviews";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  countReviewsAwaitingModeration,
  getReviewForBooking,
  getShopReviewAggregate,
  listPublishedShopReviews,
  listShopReviewsForStaff,
  STAFF_REVIEW_PAGE_SIZE,
  setReviewPublished,
  setReviewsPublished,
  submitTripReview,
} from "./reviews";
import { bookings, people, reviewModerationEvents } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";

async function reviewContext(divers = ["Reviewing Diver"]) {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
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

describe("submitTripReview", () => {
  it("publishes a bare rating immediately and counts it toward the shop's average", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    const result = await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    expect(result).toEqual({ ok: true, published: true, updated: false });

    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 1,
      average: 5,
      suppressedCount: 0,
    });
  });

  it("holds a review carrying words until staff release it, and keeps it out of the average", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    const result = await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      comment: "Crew were superb",
    });
    expect(result).toEqual({ ok: true, published: false, updated: false });

    // Unmoderated words are neither listed nor counted — the number a visitor
    // sees always describes exactly the reviews shown under it.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 0,
      average: null,
      suppressedCount: 0,
    });
    expect(await listPublishedShopReviews(db, shop.id)).toEqual([]);
    expect(await countReviewsAwaitingModeration(db, shop.id)).toBe(1);
  });

  it("revises one review in place rather than stacking duplicates on a replayed submit", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    const second = await submitTripReview(db, { bookingId: bookingIds[0], rating: 3 });
    expect(second).toEqual({ ok: true, published: true, updated: true });

    // One row, at the revised rating — not two fives or a 5-and-3 average.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 1,
      average: 3,
      suppressedCount: 0,
    });
    expect(await getReviewForBooking(db, bookingIds[0])).toEqual({
      rating: 3,
      comment: null,
      isPublished: true,
    });
  });

  it("sends an already-published review back for moderation when words are added", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    await submitTripReview(db, {
      bookingId: bookingIds[0],
      rating: 5,
      comment: "Editing in something unreviewed",
    });

    // Otherwise "publish a bare rating, then edit freely" would be a way onto
    // the shop's public page without anyone reading the text.
    expect(await getReviewForBooking(db, bookingIds[0])).toMatchObject({ isPublished: false });
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 0,
      average: null,
      suppressedCount: 0,
    });
  });

  it("refuses a booking that never dived — cancelled or no-show", async () => {
    const { db, bookingIds } = await reviewContext(["Cancelled Diver", "No Show Diver"]);
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingIds[0]));
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, bookingIds[1]));

    expect(await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 })).toEqual({
      ok: false,
      reason: "did_not_dive",
    });
    expect(await submitTripReview(db, { bookingId: bookingIds[1], rating: 5 })).toEqual({
      ok: false,
      reason: "did_not_dive",
    });
  });

  it("refuses a booking that does not exist rather than inventing a shop for it", async () => {
    const { db } = await reviewContext();
    expect(await submitTripReview(db, { bookingId: OTHER_SHOP_ID, rating: 5 })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("public review reads", () => {
  it("lists released reviews newest first, signed with a first name and last initial", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext(["Marta Reyes", "Kai Nakamura"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "Unreal vis" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 4, comment: "Great briefing" });

    const staffQueue = await listShopReviewsForStaff(db, shop.id);
    for (const review of staffQueue.reviews)
      await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });

    const published = await listPublishedShopReviews(db, shop.id);
    expect(published.map((r) => r.reviewer).sort()).toEqual(["Kai N.", "Marta R."]);
    // Never the full surname on a public page.
    expect(published.some((r) => r.reviewer.includes("Reyes"))).toBe(false);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 2,
      average: 4.5,
      suppressedCount: 0,
    });
  });

  it("counts a bare rating in the average but leaves it off the list — an empty card says nothing", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext(["Silent Diver", "Chatty Diver"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Choppy day" });
    const queued = await listShopReviewsForStaff(db, shop.id);
    const withComment = queued.reviews.find((r) => r.comment !== null);
    if (!withComment) throw new Error("expected a review with a comment");
    await setReviewPublished(db, shop.id, withComment.id, true, { recordedByPersonId: ownerId });

    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 2,
      average: 4,
      suppressedCount: 0,
    });
    expect((await listPublishedShopReviews(db, shop.id)).map((r) => r.comment)).toEqual([
      "Choppy day",
    ]);
  });

  it("keeps every read shop-scoped", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });

    expect(await getShopReviewAggregate(db, OTHER_SHOP_ID)).toEqual({
      count: 0,
      average: null,
      suppressedCount: 0,
    });
    expect(await listPublishedShopReviews(db, OTHER_SHOP_ID)).toEqual([]);
    expect(await listShopReviewsForStaff(db, OTHER_SHOP_ID)).toEqual({
      reviews: [],
      page: 1,
      pageCount: 1,
      pageSize: STAFF_REVIEW_PAGE_SIZE,
      total: 0,
    });
    expect(await countReviewsAwaitingModeration(db, OTHER_SHOP_ID)).toBe(0);
    // …and the real shop still sees it, so the assertions above aren't vacuous.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 1,
      average: 5,
      suppressedCount: 0,
    });
  });
});

describe("listShopReviewsForStaff pagination", () => {
  it("pages by number and never repeats or skips a review", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "First review" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Second review" });

    const all = await listShopReviewsForStaff(db, shop.id);
    expect(all.pageCount).toBe(1);
    expect(all.total).toBe(2);
    expect(all.reviews).toHaveLength(2);

    const seen: string[] = [];
    for (let page = 1; page <= 2; page++) {
      const chunk = await listShopReviewsForStaff(db, shop.id, { page, limit: 1 });
      expect(chunk.page).toBe(page);
      expect(chunk.pageCount).toBe(2);
      expect(chunk.total).toBe(2);
      seen.push(...chunk.reviews.map((r) => r.id));
    }
    expect(seen).toEqual(all.reviews.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("goes back a page as well as forward", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "First review" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Second review" });

    const second = await listShopReviewsForStaff(db, shop.id, { page: 2, limit: 1 });
    const back = await listShopReviewsForStaff(db, shop.id, { page: second.page - 1, limit: 1 });
    const first = await listShopReviewsForStaff(db, shop.id, { page: 1, limit: 1 });
    expect(back.reviews.map((r) => r.id)).toEqual(first.reviews.map((r) => r.id));
  });

  it("clamps a nonsensical or out-of-range page rather than showing an empty queue", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "First review" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Second review" });

    const first = await listShopReviewsForStaff(db, shop.id, { page: 1, limit: 1 });
    for (const requested of [0, -3, Number.NaN]) {
      const clamped = await listShopReviewsForStaff(db, shop.id, { page: requested, limit: 1 });
      expect(clamped.page).toBe(1);
      expect(clamped.reviews.map((r) => r.id)).toEqual(first.reviews.map((r) => r.id));
    }

    const past = await listShopReviewsForStaff(db, shop.id, { page: 99, limit: 1 });
    expect(past.page).toBe(2);
    expect(past.reviews).toHaveLength(1);
  });
});

describe("setReviewPublished", () => {
  it("refuses to moderate another shop's review", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 4, comment: "Nice day out" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;

    expect(
      await setReviewPublished(db, OTHER_SHOP_ID, review.id, true, {
        recordedByPersonId: ownerId,
      }),
    ).toBe("not_found");
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 0,
      average: null,
      suppressedCount: 0,
    });
    expect(
      await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId }),
    ).toBe(true);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 1,
      average: 4,
      suppressedCount: 0,
    });
  });

  it("takes a review back down, dropping it from the list and the average", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 1, comment: "Not for me" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 1,
      average: 1,
      suppressedCount: 0,
    });

    await setReviewPublished(db, shop.id, review.id, false, {
      recordedByPersonId: ownerId,
      reason: "spam",
    });
    // Hidden by a recorded act, so it counts against the shop's suppression
    // share even though it is out of the average
    // (ADR 20260813-review-moderation-has-a-floor).
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 0,
      average: null,
      suppressedCount: 1,
    });
    expect(await listPublishedShopReviews(db, shop.id)).toEqual([]);
    expect(await countReviewsAwaitingModeration(db, shop.id)).toBe(1);
  });
});

describe("setReviewsPublished", () => {
  it("releases every held review in one call and counts what actually changed", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext([
      "Diver One",
      "Diver Two",
      "Diver Three",
    ]);
    for (const [index, bookingId] of bookingIds.entries()) {
      await submitTripReview(db, { bookingId, rating: 4, comment: `Words ${index}` });
    }
    const waiting = (await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true })).reviews;
    expect(waiting).toHaveLength(3);

    expect(
      await setReviewsPublished(
        db,
        shop.id,
        waiting.map((review) => review.id),
        ownerId,
      ),
    ).toBe(3);
    expect(await countReviewsAwaitingModeration(db, shop.id)).toBe(0);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 3,
      average: 4,
      suppressedCount: 0,
    });

    // Repeating the same selection changes nothing — already-published rows are
    // excluded, so a double submit cannot re-date the public list.
    expect(
      await setReviewsPublished(
        db,
        shop.id,
        waiting.map((review) => review.id),
        ownerId,
      ),
    ).toBe(0);
  });

  it("refuses another shop's ids, an empty selection, and anything not uuid-shaped", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 2, comment: "Held" });
    const [review] = (await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true })).reviews;

    expect(await setReviewsPublished(db, OTHER_SHOP_ID, [review.id], ownerId)).toBe(0);
    expect(await setReviewsPublished(db, shop.id, [], ownerId)).toBe(0);
    // A hand-crafted form post: a non-uuid is dropped before Postgres sees it,
    // so this is "nothing matched" rather than a 500.
    expect(await setReviewsPublished(db, shop.id, ["not-a-uuid", "'; drop table x"], ownerId)).toBe(
      0,
    );
    expect(await countReviewsAwaitingModeration(db, shop.id)).toBe(1);

    // …and the shop's own id still works, so none of the above was a false pass.
    expect(await setReviewsPublished(db, shop.id, [review.id, review.id], ownerId)).toBe(1);
  });
});

describe("listShopReviewsForStaff onlyWaiting filter", () => {
  it("narrows the queue to unpublished reviews and its total along with it", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 }); // bare rating, publishes
    await submitTripReview(db, {
      bookingId: bookingIds[1],
      rating: 3,
      comment: "Waiting on a read",
    });

    const all = await listShopReviewsForStaff(db, shop.id);
    expect(all.total).toBe(2);

    const waiting = await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true });
    expect(waiting.total).toBe(1);
    expect(waiting.reviews.every((r) => !r.isPublished)).toBe(true);
    expect(waiting.reviews.map((r) => r.comment)).toEqual(["Waiting on a read"]);
  });

  it("comes back empty once every review with words has been moderated", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 4, comment: "All caught up" });
    const [review] = (await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true })).reviews;
    await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });

    const waiting = await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true });
    expect(waiting).toEqual({
      reviews: [],
      page: 1,
      pageCount: 1,
      pageSize: STAFF_REVIEW_PAGE_SIZE,
      total: 0,
    });
  });
});

describe("getShopReviewAggregate since", () => {
  it("scopes the average to reviews published on or after the given instant", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    // Both bare ratings publish immediately, at whatever instant the test runs.
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3 });

    const past = new Date("2000-01-01T00:00:00.000Z");
    const future = new Date("2999-01-01T00:00:00.000Z");
    expect(await getShopReviewAggregate(db, shop.id, { since: past })).toEqual({
      count: 2,
      average: 4,
      suppressedCount: 0,
    });
    expect(await getShopReviewAggregate(db, shop.id, { since: future })).toEqual({
      count: 0,
      average: null,
      suppressedCount: 0,
    });
    // Omitted `since` keeps behaving as the all-time aggregate.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 2,
      average: 4,
      suppressedCount: 0,
    });
  });
});

/**
 * A hide is a recorded act with a stated case, and what it records is what
 * decides whether DiveDay still vouches for the shop's average
 * (ADR 20260813-review-moderation-has-a-floor).
 */
describe("review moderation is recorded", () => {
  it("refuses to hide a review without a reason, leaving it published", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 1, comment: "Not for me" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });

    expect(
      await setReviewPublished(db, shop.id, review.id, false, { recordedByPersonId: ownerId }),
    ).toBe("reason_required");
    // Nothing moved: the review is still up and still in the average.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({
      count: 1,
      average: 1,
      suppressedCount: 0,
    });
  });

  it("refuses “other” with no words, because that reason is the words", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 2, comment: "Odd one" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });

    expect(
      await setReviewPublished(db, shop.id, review.id, false, {
        recordedByPersonId: ownerId,
        reason: "other",
      }),
    ).toBe("note_required");
    expect(
      await setReviewPublished(db, shop.id, review.id, false, {
        recordedByPersonId: ownerId,
        reason: "other",
        reasonNote: "The diver asked us to take it down.",
      }),
    ).toBe(true);
  });

  it("writes the case to the trail, and writes none when releasing", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 1, comment: "Spam spam" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });
    await setReviewPublished(db, shop.id, review.id, false, {
      recordedByPersonId: ownerId,
      reason: "spam",
    });

    const trail = await db
      .select()
      .from(reviewModerationEvents)
      .where(eq(reviewModerationEvents.reviewId, review.id));
    expect(trail.map((row) => [row.action, row.reason])).toEqual([
      ["published", null],
      ["hidden", "spam"],
    ]);
    expect(trail.every((row) => row.recordedByPersonId === ownerId)).toBe(true);
  });

  it("counts a hidden review as suppressed, and stops once it is republished", async () => {
    const { db, shop, ownerId, bookingIds } = await reviewContext(["A Diver", "B Diver"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 1, comment: "Rough day" });
    const [held] = (await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true })).reviews;

    // Waiting on a read is not suppression — nobody has ruled on it yet.
    expect((await getShopReviewAggregate(db, shop.id)).suppressedCount).toBe(0);

    await setReviewPublished(db, shop.id, held.id, true, { recordedByPersonId: ownerId });
    await setReviewPublished(db, shop.id, held.id, false, {
      recordedByPersonId: ownerId,
      reason: "wrong_subject",
    });
    expect((await getShopReviewAggregate(db, shop.id)).suppressedCount).toBe(1);

    await setReviewPublished(db, shop.id, held.id, true, { recordedByPersonId: ownerId });
    expect((await getShopReviewAggregate(db, shop.id)).suppressedCount).toBe(0);
  });

  /**
   * The whole chain the staff Reviews page renders from, driven through the
   * real writer rather than a hand-built aggregate: hiding reviews writes the
   * trail, the trail feeds `suppressedCount`, and that decides whether DiveDay
   * is still publishing the shop's rating
   * (ADR 20260813-review-moderation-has-a-floor, amended 2026-08-14).
   */
  it("crosses the suppression line as a shop hides its record, and comes back when told to", async () => {
    const { db, shop, ownerId } = await reviewContext();
    // Ten reviews means ten seats, which is more than any one seeded departure
    // has left — so they spread across the board the way a real shop's record
    // does. Seats are taken from whatever is genuinely free rather than a
    // hard-coded trip, so a change to the seed's booked counts cannot silently
    // turn this into a `trip_full` failure.
    const bookingIds: string[] = [];
    for (const trip of await upcomingTripsWithCounts(db, shop.id, new Date(0))) {
      const free = Math.min(trip.capacity - trip.booked, 10 - bookingIds.length);
      if (free <= 0) continue;
      const party = await createBookingParty(
        db,
        Array.from({ length: free }, (_, i) => ({
          actor: "staff" as const,
          shopId: shop.id,
          tripId: trip.id,
          fullName: `Record Diver ${bookingIds.length + i}`,
          email: `record-diver-${bookingIds.length + i}@example.com`,
        })),
      );
      if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
      bookingIds.push(...party.bookings.map((b) => b.bookingId));
      if (bookingIds.length === 10) break;
    }
    expect(bookingIds).toHaveLength(10);

    // Every review carries words, so each one waits for staff and every
    // publish is a recorded act — the state a real moderating shop is in.
    for (const bookingId of bookingIds) {
      await submitTripReview(db, { bookingId, rating: 4, comment: "A day on the reef." });
    }
    const held = (await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true })).reviews;
    expect(held).toHaveLength(10);
    for (const review of held) {
      await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: ownerId });
    }

    const publishedEverything = await getShopReviewAggregate(db, shop.id);
    expect(publishedEverything.suppressedCount).toBe(0);
    expect(ratingIsWithheld(publishedEverything)).toBe(false);

    // Two hidden of ten judged is exactly one in five, which passes.
    for (const review of held.slice(0, 2)) {
      await setReviewPublished(db, shop.id, review.id, false, {
        recordedByPersonId: ownerId,
        reason: "spam",
      });
    }
    expect(ratingIsWithheld(await getShopReviewAggregate(db, shop.id))).toBe(false);

    // A third takes the shop over it. The denominator does not move — a hidden
    // review is still one the shop ruled on.
    await setReviewPublished(db, shop.id, held[2].id, false, {
      recordedByPersonId: ownerId,
      reason: "spam",
    });
    const curated = await getShopReviewAggregate(db, shop.id);
    expect(curated).toMatchObject({ count: 7, suppressedCount: 3 });
    expect(ratingIsWithheld(curated)).toBe(true);
    // And the page can tell the shop what it would take to undo — one review,
    // which is the number the warning banner interpolates.
    expect(reviewsToRepublishForRating(curated)).toBe(1);

    await setReviewPublished(db, shop.id, held[2].id, true, { recordedByPersonId: ownerId });
    expect(ratingIsWithheld(await getShopReviewAggregate(db, shop.id))).toBe(false);
  });
});
