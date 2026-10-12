import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { MAX_REVIEW_REPLY_LENGTH } from "@/lib/reviews";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { createBookingParty } from "./bookings";
import { deleteReviewReply, liveReviewReply, writeReviewReply } from "./review-replies";
import {
  listPublishedShopReviews,
  listShopReviewsForStaff,
  setReviewPublished,
  submitTripReview,
} from "./reviews";
import { activityEvents, bookings, people, reviewReplies } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The shop's public reply under a review** (batch 4, K2). One live reply per
 * review, under published reviews with words only, every act on the activity
 * trail, and nothing reachable from another shop.
 */

const OTHER_SHOP_ID = "00000000-0000-0000-0000-000000000000";
const ctx = fileScopedShopContext();

async function publishedReview(comment: string | null = "The crew found us a turtle.") {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => !trip.course && trip.capacity - trip.booked >= 1);
  if (!reef) throw new Error("no bookable charter in the seed");
  const party = await createBookingParty(db, [
    {
      actor: "staff" as const,
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Ana Lopez",
      email: "ana-reply@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const submitted = await submitTripReview(db, { bookingId, rating: 5, comment });
  if (!submitted.ok) throw new Error("review refused");
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  if (!owner) throw new Error("seeded owner missing");
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  const staff = await listShopReviewsForStaff(db, shop.id, { limit: 200 });
  const review = staff.reviews.find((candidate) => candidate.personId === row?.personId);
  if (!review) throw new Error("review missing from the staff queue");
  if (!review.isPublished) {
    await setReviewPublished(db, shop.id, review.id, true, { recordedByPersonId: owner.id });
  }
  return { db, shop, reviewId: review.id, ownerId: owner.id, diverId: row?.personId ?? "" };
}

describe("writeReviewReply", () => {
  it("writes one reply that every public read carries, signed with the shop's name", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    const written = await writeReviewReply(db, {
      shopId: shop.id,
      reviewId,
      personId: ownerId,
      body: "  Thank you,\n Ana! ",
    });
    expect(written).toEqual({ ok: true, effect: "replied" });

    const listed = await listPublishedShopReviews(db, shop.id, 200);
    const review = listed.find((candidate) => candidate.id === reviewId);
    expect(review?.reply).toEqual({ body: "Thank you, Ana!", shopName: shop.name });
  });

  it("edits the live reply rather than stacking a second one", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "First." });
    const edited = await writeReviewReply(db, {
      shopId: shop.id,
      reviewId,
      personId: ownerId,
      body: "Second.",
    });
    expect(edited).toEqual({ ok: true, effect: "edited" });
    const rows = await db.select().from(reviewReplies).where(eq(reviewReplies.reviewId, reviewId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Second.");
  });

  it("refuses a reply over the limit, and an empty one", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    const base = { shopId: shop.id, reviewId, personId: ownerId };
    expect(
      await writeReviewReply(db, { ...base, body: "a".repeat(MAX_REVIEW_REPLY_LENGTH + 1) }),
    ).toEqual({ ok: false, reason: "too_long" });
    expect(await writeReviewReply(db, { ...base, body: "  " })).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(await liveReviewReply(db, shop.id, reviewId)).toBeNull();
  });

  it("refuses a review that is not public with words", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview(null);
    expect(
      await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "Hi." }),
    ).toEqual({ ok: false, reason: "not_answerable" });
  });

  it("changes nothing for another shop's id", async () => {
    const { db, reviewId, ownerId } = await publishedReview();
    expect(
      await writeReviewReply(db, {
        shopId: OTHER_SHOP_ID,
        reviewId,
        personId: ownerId,
        body: "Hi.",
      }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("goes dark with the review when the review is hidden", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "Thanks!" });
    await setReviewPublished(db, shop.id, reviewId, false, {
      recordedByPersonId: ownerId,
      reason: "spam",
    });
    const listed = await listPublishedShopReviews(db, shop.id, 200);
    expect(listed.some((review) => review.reply?.body === "Thanks!")).toBe(false);
  });

  it("writes an activity line for each act, naming the staffer and no reviewer", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "One." });
    await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "Two." });
    await deleteReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId });
    const lines = await db
      .select({ code: activityEvents.code, params: activityEvents.params })
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.actorPersonId, ownerId)));
    const codes = lines.map((line) => line.code);
    expect(codes).toEqual(
      expect.arrayContaining(["review_replied", "review_reply_edited", "review_reply_deleted"]),
    );
    for (const line of lines.filter((l) => l.code.startsWith("review_repl"))) {
      expect(Object.keys(line.params)).toEqual(["actor"]);
    }
  });
});

describe("deleteReviewReply", () => {
  it("soft-deletes the reply, takes it off the public read, and lets a new one be written", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "Old." });
    expect(await deleteReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId })).toBe(
      true,
    );
    const rows = await db.select().from(reviewReplies).where(eq(reviewReplies.reviewId, reviewId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deletedAt).not.toBeNull();
    const listed = await listPublishedShopReviews(db, shop.id, 200);
    expect(listed.find((review) => review.id === reviewId)?.reply).toBeNull();

    expect(
      await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "New." }),
    ).toEqual({ ok: true, effect: "replied" });
  });

  it("answers false when there is nothing to delete, or the shop is not this one", async () => {
    const { db, shop, reviewId, ownerId } = await publishedReview();
    expect(await deleteReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId })).toBe(
      false,
    );
    await writeReviewReply(db, { shopId: shop.id, reviewId, personId: ownerId, body: "Hi." });
    expect(
      await deleteReviewReply(db, { shopId: OTHER_SHOP_ID, reviewId, personId: ownerId }),
    ).toBe(false);
    expect(await liveReviewReply(db, shop.id, reviewId)).not.toBeNull();
  });
});

describe("erasure", () => {
  it("blanks and deletes the reply under an erased diver's review", async () => {
    const { db, shop, reviewId, ownerId, diverId } = await publishedReview();
    await writeReviewReply(db, {
      shopId: shop.id,
      reviewId,
      personId: ownerId,
      body: "Thanks Ana Lopez!",
    });
    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: diverId,
      actorPersonId: ownerId,
    });
    expect(erased.ok).toBe(true);
    const rows = await db.select().from(reviewReplies).where(eq(reviewReplies.reviewId, reviewId));
    expect(rows[0]?.body).not.toContain("Ana");
    expect(rows[0]?.deletedAt).not.toBeNull();
  });
});
