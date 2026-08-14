import { and, count, desc, eq, exists, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import {
  EMPTY_REVIEW_AGGREGATE,
  normalizeReviewComment,
  publishesImmediately,
  type ReviewAggregate,
  reviewAggregate,
  reviewerDisplayName,
} from "@/lib/reviews";
import { isUuid } from "@/lib/uuid";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage } from "./paging";
import {
  bookings,
  people,
  reviewModerationEvents,
  reviewModerationReason,
  tripReviews,
  trips,
} from "./schema";

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
 * can never describe different things. Pass `since` to scope it to reviews
 * published on or after an instant (the moderation page's "this month" line);
 * omitted, it is the shop's all-time rating.
 */
export async function getShopReviewAggregate(
  db: DbExecutor,
  shopId: string,
  options: { since?: Date } = {},
): Promise<ReviewAggregate> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      sum: sql<number>`coalesce(sum(${tripReviews.rating}), 0)::int`,
    })
    .from(tripReviews)
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        options.since ? gte(tripReviews.publishedAt, options.since) : undefined,
      ),
    );
  const suppressedCount = await countSuppressedReviews(db, shopId);
  return row
    ? reviewAggregate(row.count, row.sum, suppressedCount)
    : { ...EMPTY_REVIEW_AGGREGATE, suppressedCount };
}

/**
 * How many of this shop's reviews are currently down by its own hand.
 *
 * Currently-unpublished **and** carrying a recorded `hidden` act — both halves
 * matter. A review awaiting release has never been hidden, so it is not
 * counted; a review that was hidden and later republished is back in the
 * average, so it is not counted either. What is left is exactly the set a shop
 * chose to remove, which is what decides whether DiveDay still vouches for its
 * average (ADR 20260813-review-moderation-has-a-floor).
 *
 * Not scoped by `since`: the moderation page's "this month" line is about
 * volume, and a shop's suppression share is a fact about its whole record.
 */
export async function countSuppressedReviews(db: DbExecutor, shopId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tripReviews)
    .where(
      and(
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, false),
        exists(
          db
            .select({ one: reviewModerationEvents.id })
            .from(reviewModerationEvents)
            .where(
              and(
                eq(reviewModerationEvents.reviewId, tripReviews.id),
                eq(reviewModerationEvents.action, "hidden"),
              ),
            ),
        ),
      ),
    );
  return row?.count ?? 0;
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
  personId: string;
  tripId: string;
  tripTitle: string;
  divedAt: Date;
  createdAt: Date;
};

/** How many reviews the moderation queue shows per page. */
export const STAFF_REVIEW_PAGE_SIZE = 20;

export type StaffReviewPage = {
  reviews: StaffReview[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/**
 * The moderation queue: this shop's reviews, newest first, held ones
 * included — one page at a time (ordered by creation, then id for a stable
 * tiebreak) so a shop with years of trips costs one page, not the whole table.
 *
 * Offset-paged, like the roster and the orders index. It was a forward-only
 * keyset cursor, which meant a staffer three pages into the queue had "Show
 * more" and "Back to top" and nothing in between — no way back one page, and
 * no way to see how much queue was left (ADR 20260803-one-pagination-model).
 *
 * `onlyWaiting` narrows the same query to unpublished rows only — the
 * "Waiting on you" tab. It stays a plain extra `where` clause rather than a
 * different sort order, applied to the count as well as the page, so "page 2
 * of 4" means the same thing in both tabs.
 */
export async function listShopReviewsForStaff(
  db: DbExecutor,
  shopId: string,
  options: { page?: number; limit?: number; onlyWaiting?: boolean } = {},
): Promise<StaffReviewPage> {
  const scope = and(
    eq(tripReviews.shopId, shopId),
    options.onlyWaiting ? eq(tripReviews.isPublished, false) : undefined,
  );

  const paged = await offsetPage({
    page: options.page,
    pageSize: options.limit ?? STAFF_REVIEW_PAGE_SIZE,
    countRows: async () => {
      const [counted] = await db.select({ total: count() }).from(tripReviews).where(scope);
      return counted?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      db
        .select({
          id: tripReviews.id,
          rating: tripReviews.rating,
          comment: tripReviews.comment,
          isPublished: tripReviews.isPublished,
          diverName: people.fullName,
          personId: tripReviews.personId,
          tripId: tripReviews.tripId,
          tripTitle: trips.title,
          divedAt: trips.startsAt,
          createdAt: tripReviews.createdAt,
        })
        .from(tripReviews)
        .innerJoin(people, eq(people.id, tripReviews.personId))
        .innerJoin(trips, eq(trips.id, tripReviews.tripId))
        .where(scope)
        .orderBy(desc(tripReviews.createdAt), desc(tripReviews.id))
        .limit(limit)
        .offset(offset),
  });

  return {
    reviews: paged.rows,
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/** The reason codes a hide may state, for narrowing a posted form value. */
export const REVIEW_MODERATION_REASONS = reviewModerationReason.enumValues;

export type ReviewModerationReason = (typeof reviewModerationReason.enumValues)[number];

export type SetReviewPublishedResult = true | "not_found" | "reason_required" | "note_required";

/**
 * Publish or hide one review, shop-scoped, recording the act either way.
 *
 * Hiding clears `publishedAt` so a later re-publish sorts by when it was
 * actually released rather than by a stale first release — a review taken down
 * and restored belongs at the top of the list it rejoins, not buried where it
 * used to be.
 *
 * **A hide states a case.** It carries a reason code, and `other` carries the
 * shop's own words; without them nothing is written at all. That is not
 * bureaucracy for its own sake — the same act moves the shop's public average,
 * and the trail is what lets DiveDay tell a curated record from a clean one
 * (ADR 20260813-review-moderation-has-a-floor). Publishing states nothing:
 * releasing a diver's words needs no justification.
 *
 * The update and its event land in one transaction, so the trail can never
 * disagree with the row it describes.
 */
export async function setReviewPublished(
  db: AppDb,
  shopId: string,
  reviewId: string,
  isPublished: boolean,
  moderation: {
    recordedByPersonId: string;
    reason?: ReviewModerationReason | null;
    reasonNote?: string | null;
    now?: Date;
  },
): Promise<SetReviewPublishedResult> {
  const note = moderation.reasonNote?.trim() || null;
  if (!isPublished) {
    if (!moderation.reason) return "reason_required";
    if (moderation.reason === "other" && !note) return "note_required";
  }
  const now = moderation.now ?? nowDate();

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tripReviews)
      .set({ isPublished, publishedAt: isPublished ? now : null, updatedAt: now })
      .where(and(eq(tripReviews.id, reviewId), eq(tripReviews.shopId, shopId)))
      .returning({ id: tripReviews.id });
    if (!updated) return "not_found";

    await tx.insert(reviewModerationEvents).values({
      shopId,
      reviewId,
      action: isPublished ? "published" : "hidden",
      // A publish states no case, so it carries no reason even if one arrived
      // on the form — the column means "why this was taken down".
      reason: isPublished ? null : (moderation.reason ?? null),
      reasonNote: isPublished ? null : note,
      recordedByPersonId: moderation.recordedByPersonId,
      occurredAt: now,
    });
    return true;
  });
}

/**
 * The most reviews one "Publish selected" may release. A moderation page shows
 * a bounded page of reviews, so a submission carrying more ids than this did
 * not come from the page — the excess is dropped rather than trusted.
 */
export const MAX_BULK_PUBLISH = 100;

/**
 * Publish several reviews at once — the moderation queue's "tick a few, then
 * publish". Shop-scoped and publish-only by design: releasing is additive and
 * safely repeated, while *hiding* takes a shop's own words off its public page
 * and stays a deliberate, per-review act with its own undo.
 *
 * `publishedAt` is set only where it is still null, so re-publishing a review
 * that is already live never re-dates it and never reorders the public list.
 * Returns how many rows actually changed, which is what lets the caller tell
 * "published four" from "that selection matched nothing here".
 *
 * Each release appends to the same trail the single toggle writes, in the same
 * transaction — a review released here may be one a shop took down earlier, and
 * a trail that recorded the hide but not the restore would read as a shop still
 * suppressing something it had put back
 * (ADR 20260813-review-moderation-has-a-floor).
 */
export async function setReviewsPublished(
  db: AppDb,
  shopId: string,
  reviewIds: readonly string[],
  recordedByPersonId: string,
): Promise<number> {
  // Ids arrive from a submitted form, so anything not shaped like a uuid is
  // dropped here rather than handed to Postgres, where it is a type error and
  // a 500 rather than the "nothing matched" this returns.
  const ids = [...new Set(reviewIds)].filter((id) => isUuid(id)).slice(0, MAX_BULK_PUBLISH);
  if (ids.length === 0) return 0;
  const now = nowDate();
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(tripReviews)
      .set({
        isPublished: true,
        publishedAt: sql`coalesce(${tripReviews.publishedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(tripReviews.shopId, shopId),
          inArray(tripReviews.id, ids),
          eq(tripReviews.isPublished, false),
        ),
      )
      .returning({ id: tripReviews.id });
    if (updated.length > 0) {
      await tx.insert(reviewModerationEvents).values(
        updated.map((row) => ({
          shopId,
          reviewId: row.id,
          action: "published" as const,
          recordedByPersonId,
          occurredAt: now,
        })),
      );
    }
    return updated.length;
  });
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
