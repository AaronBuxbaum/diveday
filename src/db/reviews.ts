import { and, count, desc, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  EMPTY_REVIEW_AGGREGATE,
  normalizeReviewComment,
  publishesImmediately,
  type ReviewAggregate,
  reviewAggregate,
  reviewerDisplayName,
} from "@/lib/reviews";
import type { AppDb, DbExecutor } from "./client";
import { decodeCursor, encodeCursor } from "./cursor";
import { bookings, people, tripReviews, trips } from "./schema";

/**
 * Reviews from divers who provably dived. The write path is a booking's own
 * signed recap link, so shop, trip, and person are always derived from the
 * booking row here — never accepted from the caller — and a booking that never
 * sailed (cancelled or no-show) can't leave one at all
 * (docs ADR 20260729-verified-diver-reviews).
 */

export type SubmitReviewResult =
  | { ok: true; published: boolean; updated: boolean }
  | { ok: false; reason: "not_found" | "did_not_dive" };

/**
 * Record (or revise) one diver's review of their trip. The unique index on
 * `booking_id` makes this an upsert rather than an insert, so a double-submit
 * or a bookmarked form replayed weeks later revises the same row instead of
 * stacking duplicates onto the shop's average.
 *
 * Re-editing an already-published review with new words sends it back for
 * moderation — otherwise "publish once, edit freely" would be a way to get
 * unread text onto a shop's public page.
 */
export async function submitTripReview(
  db: AppDb,
  input: { bookingId: string; rating: number; comment?: string | null },
): Promise<SubmitReviewResult> {
  const comment = normalizeReviewComment(input.comment);
  const publish = publishesImmediately(comment);
  const now = nowDate();

  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        shopId: bookings.shopId,
        tripId: bookings.tripId,
        personId: bookings.personId,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) return { ok: false, reason: "not_found" };
    // Same fail-closed treatment the rest of the recap surface gives these two:
    // neither was on the boat, so neither has a dive to rate.
    if (booking.status === "cancelled" || booking.status === "no_show") {
      return { ok: false, reason: "did_not_dive" };
    }

    const [existing] = await tx
      .select({ id: tripReviews.id })
      .from(tripReviews)
      .where(eq(tripReviews.bookingId, input.bookingId))
      .limit(1);

    const values = {
      shopId: booking.shopId,
      bookingId: input.bookingId,
      tripId: booking.tripId,
      personId: booking.personId,
      rating: input.rating,
      comment,
      isPublished: publish,
      publishedAt: publish ? now : null,
      updatedAt: now,
    };

    if (existing) {
      await tx.update(tripReviews).set(values).where(eq(tripReviews.id, existing.id));
    } else {
      await tx.insert(tripReviews).values(values);
    }
    return { ok: true, published: publish, updated: Boolean(existing) };
  });
}

export type OwnReview = { rating: number; comment: string | null; isPublished: boolean };

/** The diver's own review of this booking, so the recap form opens on what they already said. */
export async function getReviewForBooking(
  db: DbExecutor,
  bookingId: string,
): Promise<OwnReview | null> {
  const [row] = await db
    .select({
      rating: tripReviews.rating,
      comment: tripReviews.comment,
      isPublished: tripReviews.isPublished,
    })
    .from(tripReviews)
    .where(eq(tripReviews.bookingId, bookingId))
    .limit(1);
  return row ?? null;
}

/**
 * The shop's published rating, counted in the database. Published rows only —
 * the same set the public list renders, so the number and the reviews under it
 * can never describe different things.
 */
export async function getShopReviewAggregate(
  db: DbExecutor,
  shopId: string,
): Promise<ReviewAggregate> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      sum: sql<number>`coalesce(sum(${tripReviews.rating}), 0)::int`,
    })
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.isPublished, true)));
  return row ? reviewAggregate(row.count, row.sum) : EMPTY_REVIEW_AGGREGATE;
}

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  /** First name and last initial — the most a public page should say (`reviewerDisplayName`). */
  reviewer: string;
  tripTitle: string;
  divedAt: Date;
  publishedAt: Date;
};

/** How many reviews the public page shows at once — a taste, not an archive. */
export const PUBLIC_REVIEW_PAGE_SIZE = 6;

/**
 * The shop's published reviews, newest first. Only rows carrying words are
 * listed: a bare 5-star rating counts toward the average but renders as an
 * empty card, so showing it would pad the list without telling a visitor
 * anything.
 */
export async function listPublishedShopReviews(
  db: DbExecutor,
  shopId: string,
  limit = PUBLIC_REVIEW_PAGE_SIZE,
): Promise<PublicReview[]> {
  const rows = await db
    .select({
      id: tripReviews.id,
      rating: tripReviews.rating,
      comment: tripReviews.comment,
      fullName: people.fullName,
      tripTitle: trips.title,
      divedAt: trips.startsAt,
      publishedAt: tripReviews.publishedAt,
    })
    .from(tripReviews)
    .innerJoin(people, eq(people.id, tripReviews.personId))
    .innerJoin(trips, eq(trips.id, tripReviews.tripId))
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        isNotNull(tripReviews.comment),
        isNotNull(tripReviews.publishedAt),
      ),
    )
    .orderBy(desc(tripReviews.publishedAt))
    .limit(limit);

  return rows.flatMap((row) =>
    row.publishedAt
      ? [
          {
            id: row.id,
            rating: row.rating,
            comment: row.comment,
            reviewer: reviewerDisplayName(row.fullName),
            tripTitle: row.tripTitle,
            divedAt: row.divedAt,
            publishedAt: row.publishedAt,
          },
        ]
      : [],
  );
}

export type StaffReview = {
  id: string;
  rating: number;
  comment: string | null;
  isPublished: boolean;
  /** Staff see who actually wrote it — the abbreviation is a public-page rule, not an internal one. */
  diverName: string;
  tripId: string;
  tripTitle: string;
  divedAt: Date;
  createdAt: Date;
};

/** How many reviews the moderation queue shows per page before "Show more". */
export const STAFF_REVIEW_PAGE_SIZE = 50;

export type StaffReviewPage = {
  reviews: StaffReview[];
  nextCursor: string | null;
  total: number;
};

/**
 * The moderation queue: this shop's reviews, newest first, held ones
 * included — one keyset page at a time (ordered by creation, then id for a
 * stable tiebreak), same idiom as `pagedUpcomingTripsWithCounts` and
 * `listDiverSummaries` so a shop with years of trips costs one page, not the
 * whole table.
 */
export async function listShopReviewsForStaff(
  db: DbExecutor,
  shopId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<StaffReviewPage> {
  const limit = options.limit ?? STAFF_REVIEW_PAGE_SIZE;
  const after = decodeCursor(options.cursor);
  const afterDate = after ? new Date(after[0]) : null;
  const scope = eq(tripReviews.shopId, shopId);

  const [rows, [counted]] = await Promise.all([
    db
      .select({
        id: tripReviews.id,
        rating: tripReviews.rating,
        comment: tripReviews.comment,
        isPublished: tripReviews.isPublished,
        diverName: people.fullName,
        tripId: tripReviews.tripId,
        tripTitle: trips.title,
        divedAt: trips.startsAt,
        createdAt: tripReviews.createdAt,
      })
      .from(tripReviews)
      .innerJoin(people, eq(people.id, tripReviews.personId))
      .innerJoin(trips, eq(trips.id, tripReviews.tripId))
      .where(
        and(
          scope,
          afterDate && after && !Number.isNaN(afterDate.getTime())
            ? or(
                lt(tripReviews.createdAt, afterDate),
                and(eq(tripReviews.createdAt, afterDate), lt(tripReviews.id, after[1])),
              )
            : undefined,
        ),
      )
      .orderBy(desc(tripReviews.createdAt), desc(tripReviews.id))
      .limit(limit + 1),
    db.select({ total: count() }).from(tripReviews).where(scope),
  ]);

  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    reviews: pageRows,
    nextCursor:
      rows.length > limit && last ? encodeCursor(last.createdAt.toISOString(), last.id) : null,
    total: counted?.total ?? 0,
  };
}

/**
 * Publish or hide one review, shop-scoped. Hiding clears `publishedAt` so a
 * later re-publish sorts by when it was actually released rather than by a
 * stale first release — a review taken down and restored belongs at the top of
 * the list it rejoins, not buried where it used to be.
 */
export async function setReviewPublished(
  db: AppDb,
  shopId: string,
  reviewId: string,
  isPublished: boolean,
): Promise<boolean> {
  const [updated] = await db
    .update(tripReviews)
    .set({
      isPublished,
      publishedAt: isPublished ? nowDate() : null,
      updatedAt: nowDate(),
    })
    .where(and(eq(tripReviews.id, reviewId), eq(tripReviews.shopId, shopId)))
    .returning({ id: tripReviews.id });
  return Boolean(updated);
}

/** How many reviews are waiting on staff — the badge on the moderation nav entry. */
export async function countReviewsAwaitingModeration(
  db: DbExecutor,
  shopId: string,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.isPublished, false)));
  return row?.count ?? 0;
}
