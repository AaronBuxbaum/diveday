import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import {
  countReviewsAwaitingModeration,
  getReviewForBooking,
  getShopReviewAggregate,
  listPublishedShopReviews,
  listShopReviewsForStaff,
  setReviewPublished,
  submitTripReview,
} from "./reviews";
import { bookings } from "./schema";
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
  return { db, shop, tripId: reef.id, bookingIds: party.bookings.map((b) => b.bookingId) };
}

describe("submitTripReview", () => {
  it("publishes a bare rating immediately and counts it toward the shop's average", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    const result = await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    expect(result).toEqual({ ok: true, published: true, updated: false });

    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 1, average: 5 });
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
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 0, average: null });
    expect(await listPublishedShopReviews(db, shop.id)).toEqual([]);
    expect(await countReviewsAwaitingModeration(db, shop.id)).toBe(1);
  });

  it("revises one review in place rather than stacking duplicates on a replayed submit", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    const second = await submitTripReview(db, { bookingId: bookingIds[0], rating: 3 });
    expect(second).toEqual({ ok: true, published: true, updated: true });

    // One row, at the revised rating — not two fives or a 5-and-3 average.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 1, average: 3 });
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
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 0, average: null });
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
    const { db, shop, bookingIds } = await reviewContext(["Marta Reyes", "Kai Nakamura"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "Unreal vis" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 4, comment: "Great briefing" });

    const staffQueue = await listShopReviewsForStaff(db, shop.id);
    for (const review of staffQueue.reviews) await setReviewPublished(db, shop.id, review.id, true);

    const published = await listPublishedShopReviews(db, shop.id);
    expect(published.map((r) => r.reviewer).sort()).toEqual(["Kai N.", "Marta R."]);
    // Never the full surname on a public page.
    expect(published.some((r) => r.reviewer.includes("Reyes"))).toBe(false);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 2, average: 4.5 });
  });

  it("counts a bare rating in the average but leaves it off the list — an empty card says nothing", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Silent Diver", "Chatty Diver"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Choppy day" });
    const queued = await listShopReviewsForStaff(db, shop.id);
    const withComment = queued.reviews.find((r) => r.comment !== null);
    if (!withComment) throw new Error("expected a review with a comment");
    await setReviewPublished(db, shop.id, withComment.id, true);

    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 2, average: 4 });
    expect((await listPublishedShopReviews(db, shop.id)).map((r) => r.comment)).toEqual([
      "Choppy day",
    ]);
  });

  it("keeps every read shop-scoped", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5 });

    expect(await getShopReviewAggregate(db, OTHER_SHOP_ID)).toEqual({ count: 0, average: null });
    expect(await listPublishedShopReviews(db, OTHER_SHOP_ID)).toEqual([]);
    expect(await listShopReviewsForStaff(db, OTHER_SHOP_ID)).toEqual({
      reviews: [],
      nextCursor: null,
      total: 0,
    });
    expect(await countReviewsAwaitingModeration(db, OTHER_SHOP_ID)).toBe(0);
    // …and the real shop still sees it, so the assertions above aren't vacuous.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 1, average: 5 });
  });
});

describe("listShopReviewsForStaff pagination", () => {
  it("pages with a keyset cursor and never repeats or skips a review", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "First review" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Second review" });

    const all = await listShopReviewsForStaff(db, shop.id);
    expect(all.nextCursor).toBeNull();
    expect(all.total).toBe(2);
    expect(all.reviews).toHaveLength(2);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let hops = 0; hops < 3; hops++) {
      const page = await listShopReviewsForStaff(db, shop.id, { cursor, limit: 1 });
      expect(page.reviews.length).toBeLessThanOrEqual(1);
      expect(page.total).toBe(2);
      seen.push(...page.reviews.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(all.reviews.map((r) => r.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("treats a mangled cursor as the first page", async () => {
    const { db, shop, bookingIds } = await reviewContext(["Diver One", "Diver Two"]);
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 5, comment: "First review" });
    await submitTripReview(db, { bookingId: bookingIds[1], rating: 3, comment: "Second review" });

    const all = await listShopReviewsForStaff(db, shop.id);
    const mangled = await listShopReviewsForStaff(db, shop.id, { cursor: "not-a-real-cursor" });
    expect(mangled.reviews.map((r) => r.id)).toEqual(all.reviews.map((r) => r.id));
  });
});

describe("setReviewPublished", () => {
  it("refuses to moderate another shop's review", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 4, comment: "Nice day out" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;

    expect(await setReviewPublished(db, OTHER_SHOP_ID, review.id, true)).toBe(false);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 0, average: null });
    expect(await setReviewPublished(db, shop.id, review.id, true)).toBe(true);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 1, average: 4 });
  });

  it("takes a review back down, dropping it from the list and the average", async () => {
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 1, comment: "Not for me" });
    const [review] = (await listShopReviewsForStaff(db, shop.id)).reviews;
    await setReviewPublished(db, shop.id, review.id, true);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 1, average: 1 });

    await setReviewPublished(db, shop.id, review.id, false);
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 0, average: null });
    expect(await listPublishedShopReviews(db, shop.id)).toEqual([]);
    expect(await countReviewsAwaitingModeration(db, shop.id)).toBe(1);
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
    const { db, shop, bookingIds } = await reviewContext();
    await submitTripReview(db, { bookingId: bookingIds[0], rating: 4, comment: "All caught up" });
    const [review] = (await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true })).reviews;
    await setReviewPublished(db, shop.id, review.id, true);

    const waiting = await listShopReviewsForStaff(db, shop.id, { onlyWaiting: true });
    expect(waiting).toEqual({ reviews: [], nextCursor: null, total: 0 });
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
    });
    expect(await getShopReviewAggregate(db, shop.id, { since: future })).toEqual({
      count: 0,
      average: null,
    });
    // Omitted `since` keeps behaving as the all-time aggregate.
    expect(await getShopReviewAggregate(db, shop.id)).toEqual({ count: 2, average: 4 });
  });
});
