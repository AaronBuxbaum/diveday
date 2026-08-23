import {
  and,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  max,
  not,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
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
import { offsetPage, PAGE_SIZE } from "./paging";
import {
  bookings,
  people,
  reviewModerationEvents,
  reviewModerationReason,
  shops,
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
  if (!isUuid(input.bookingId)) return { ok: false, reason: "not_found" };
  const comment = normalizeReviewComment(input.comment);
  const publish = publishesImmediately(comment);
  const submittedAt = nowDate();

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
      .select({ id: tripReviews.id, updatedAt: tripReviews.updatedAt })
      .from(tripReviews)
      .where(eq(tripReviews.bookingId, input.bookingId))
      .limit(1);

    // `updated_at` is the revision boundary used to distinguish an old hide
    // from the diver's new unread version. Keep it strictly monotonic even
    // when the app clock is frozen in tests or two writes share a millisecond.
    const [lastModeration] = existing
      ? await tx
          .select({ occurredAt: max(reviewModerationEvents.occurredAt) })
          .from(reviewModerationEvents)
          .where(eq(reviewModerationEvents.reviewId, existing.id))
      : [];
    const priorRevisionAt = [existing?.updatedAt, lastModeration?.occurredAt]
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    const now =
      priorRevisionAt && priorRevisionAt.getTime() >= submittedAt.getTime()
        ? new Date(priorRevisionAt.getTime() + 1)
        : submittedAt;

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

    // The read above is only for the user-facing `updated` flag. The write is
    // an actual database upsert so two recap submits racing on the unique
    // booking index converge on one review instead of one of them surfacing a
    // unique-constraint error.
    await tx
      .insert(tripReviews)
      .values(values)
      .onConflictDoUpdate({
        target: tripReviews.bookingId,
        set: { ...values, isStandout: false },
      });
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
 * the same set the public archive renders, so the number and the reviews under
 * it can never describe different things. Pass `since` to scope it to reviews
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
        publishedReviewScope(shopId),
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
 * Currently-unpublished **and** carrying a current recorded `hidden` act —
 * both halves matter. A review awaiting release has never been hidden, so it
 * is not counted; a review that was hidden and later republished is back in
 * the average, so it is not counted either. What is left is exactly the set a
 * shop chose to remove, which is what decides whether DiveDay still vouches
 * for its average (ADR 20260813-review-moderation-has-a-floor).
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
        hiddenReviewExists(db),
      ),
    );
  return row?.count ?? 0;
}

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  isStandout: boolean;
  /** First name and last initial — the most a public page should say (`reviewerDisplayName`). */
  reviewer: string;
  tripTitle: string;
  divedAt: Date;
  publishedAt: Date;
};

/** How many reviews the schedule shows at once — a curated 2x2 on wide screens. */
export const PUBLIC_REVIEW_PAGE_SIZE = PAGE_SIZE.preview;

/** The full archive is still bounded, but useful enough to browse one page at a time. */
export const PUBLIC_REVIEW_ARCHIVE_PAGE_SIZE = PAGE_SIZE.list;

/** Every review the shop has released, including a rating with no comment. */
function publishedReviewScope(shopId: string) {
  return and(
    eq(tripReviews.shopId, shopId),
    eq(tripReviews.isPublished, true),
    isNotNull(tripReviews.publishedAt),
  );
}

/** The schedule preview stays editorial: an empty card says nothing. */
function publicWrittenReviewScope(shopId: string) {
  return and(publishedReviewScope(shopId), isNotNull(tripReviews.comment));
}

/**
 * A current recorded hide distinguishes a suppressed unpublished review from
 * one awaiting a read. A prior hide is deliberately ignored after the diver
 * revises the review, because that new revision starts in Unread again.
 */
function hiddenReviewExists(db: DbExecutor) {
  return exists(
    db
      .select({ one: reviewModerationEvents.id })
      .from(reviewModerationEvents)
      .where(
        and(
          eq(reviewModerationEvents.reviewId, tripReviews.id),
          eq(reviewModerationEvents.action, "hidden"),
          gte(reviewModerationEvents.occurredAt, tripReviews.updatedAt),
        ),
      ),
  );
}

/** Newest review days first; on a shared day, the higher rating leads. */
function publicReviewOrder() {
  return [
    desc(sql`date_trunc('day', ${trips.startsAt} at time zone ${shops.timezone})`),
    desc(tripReviews.rating),
    desc(trips.startsAt),
    desc(tripReviews.publishedAt),
    desc(tripReviews.id),
  ] as const;
}

function publicReviewFromRow(row: {
  id: string;
  rating: number;
  comment: string | null;
  isStandout: boolean;
  fullName: string;
  tripTitle: string;
  divedAt: Date;
  publishedAt: Date | null;
}): PublicReview | null {
  if (!row.publishedAt) return null;
  return {
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    isStandout: row.isStandout,
    reviewer: reviewerDisplayName(row.fullName),
    tripTitle: row.tripTitle,
    divedAt: row.divedAt,
    publishedAt: row.publishedAt,
  };
}

async function fetchPublicReviewRows(
  db: DbExecutor,
  shopId: string,
  options: { limit?: number; offset?: number; includeBareRatings?: boolean } = {},
) {
  const scope = options.includeBareRatings
    ? publishedReviewScope(shopId)
    : publicWrittenReviewScope(shopId);
  return db
    .select({
      id: tripReviews.id,
      rating: tripReviews.rating,
      comment: tripReviews.comment,
      isStandout: tripReviews.isStandout,
      fullName: people.fullName,
      tripTitle: trips.title,
      divedAt: trips.startsAt,
      publishedAt: tripReviews.publishedAt,
    })
    .from(tripReviews)
    .innerJoin(people, eq(people.id, tripReviews.personId))
    .innerJoin(trips, eq(trips.id, tripReviews.tripId))
    .innerJoin(shops, eq(shops.id, tripReviews.shopId))
    .where(scope)
    .orderBy(...publicReviewOrder())
    .limit(options.limit ?? Number.MAX_SAFE_INTEGER)
    .offset(options.offset ?? 0);
}

/**
 * The schedule's curated preview, newest first. Only rows carrying words are
 * listed there: a bare rating counts toward the average, but the archive still
 * gives customers a complete view of every released rating.
 */
export async function listPublishedShopReviews(
  db: DbExecutor,
  shopId: string,
  limit = PUBLIC_REVIEW_PAGE_SIZE,
): Promise<PublicReview[]> {
  const rows = await fetchPublicReviewRows(db, shopId, { limit });
  return rows.flatMap((row) => {
    const review = publicReviewFromRow(row);
    return review ? [review] : [];
  });
}

export type PublicReviewPage = {
  reviews: PublicReview[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

/** Every public review, paged so the archive cannot make a page unbounded. */
export async function listPublishedShopReviewsPage(
  db: DbExecutor,
  shopId: string,
  options: { page?: number; limit?: number } = {},
): Promise<PublicReviewPage> {
  const pageSize = options.limit ?? PUBLIC_REVIEW_ARCHIVE_PAGE_SIZE;
  const scope = publishedReviewScope(shopId);
  const paged = await offsetPage({
    page: options.page,
    pageSize,
    countRows: async () => {
      const [row] = await db.select({ total: count() }).from(tripReviews).where(scope);
      return row?.total ?? 0;
    },
    fetchRows: async (offset, limit) =>
      fetchPublicReviewRows(db, shopId, {
        limit,
        offset,
        includeBareRatings: true,
      }),
  });
  return {
    reviews: paged.rows.flatMap((row) => {
      const review = publicReviewFromRow(row);
      return review ? [review] : [];
    }),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

export type StaffReview = {
  id: string;
  rating: number;
  comment: string | null;
  isStandout: boolean;
  isPublished: boolean;
  isHidden: boolean;
  /** The current recorded case for a hidden review, never a stale prior hide. */
  hiddenReason: ReviewModerationReason | null;
  hiddenReasonNote: string | null;
  hiddenAt: Date | null;
  hiddenBy: string | null;
  /** Staff see who actually wrote it — the abbreviation is a public-page rule, not an internal one. */
  diverName: string;
  personId: string;
  tripId: string;
  tripTitle: string;
  divedAt: Date;
  createdAt: Date;
};

/** How many reviews the moderation queue shows per page. */
export const STAFF_REVIEW_PAGE_SIZE = PAGE_SIZE.list;

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
 * `onlyWaiting` narrows the same query to unpublished rows with no current
 * hidden act — the "Waiting on you" tab. It stays a plain extra `where` clause
 * rather than a different sort order, applied to the count as well as the
 * page, so "page 2 of 4" means the same thing in both tabs.
 */
export async function listShopReviewsForStaff(
  db: DbExecutor,
  shopId: string,
  options: { page?: number; limit?: number; onlyWaiting?: boolean } = {},
): Promise<StaffReviewPage> {
  const hidden = hiddenReviewExists(db);
  const moderationActor = alias(people, "review_moderation_actor");
  const scope = and(
    eq(tripReviews.shopId, shopId),
    options.onlyWaiting ? and(eq(tripReviews.isPublished, false), not(hidden)) : undefined,
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
          isStandout: tripReviews.isStandout,
          isPublished: tripReviews.isPublished,
          isHidden: sql<boolean>`${tripReviews.isPublished} = false and ${hidden}`,
          diverName: people.fullName,
          personId: tripReviews.personId,
          tripId: tripReviews.tripId,
          tripTitle: trips.title,
          divedAt: trips.startsAt,
          createdAt: tripReviews.createdAt,
          updatedAt: tripReviews.updatedAt,
        })
        .from(tripReviews)
        .innerJoin(people, eq(people.id, tripReviews.personId))
        .innerJoin(trips, eq(trips.id, tripReviews.tripId))
        .where(scope)
        .orderBy(desc(tripReviews.createdAt), desc(tripReviews.id))
        .limit(limit)
        .offset(offset),
  });

  // A hidden review's reason lives in its audit trail rather than on the
  // review row. Read only the current hide (not a prior version that a diver
  // later revised), and only for this page, so the staff list can explain its
  // own state without turning one screen into an unbounded event history.
  const reviewIds = paged.rows.map((review) => review.id);
  const currentHides =
    reviewIds.length === 0
      ? []
      : await db
          .select({
            reviewId: reviewModerationEvents.reviewId,
            reason: reviewModerationEvents.reason,
            reasonNote: reviewModerationEvents.reasonNote,
            occurredAt: reviewModerationEvents.occurredAt,
            recordedByName: moderationActor.fullName,
          })
          .from(reviewModerationEvents)
          .innerJoin(tripReviews, eq(tripReviews.id, reviewModerationEvents.reviewId))
          .innerJoin(
            moderationActor,
            and(
              eq(moderationActor.id, reviewModerationEvents.recordedByPersonId),
              eq(moderationActor.shopId, shopId),
            ),
          )
          .where(
            and(
              inArray(reviewModerationEvents.reviewId, reviewIds),
              eq(reviewModerationEvents.action, "hidden"),
              gte(reviewModerationEvents.occurredAt, tripReviews.updatedAt),
            ),
          );
  const currentHideByReviewId = new Map(currentHides.map((hide) => [hide.reviewId, hide]));

  return {
    reviews: paged.rows.map(({ updatedAt: _updatedAt, ...review }) => {
      const hide = currentHideByReviewId.get(review.id);
      return {
        ...review,
        hiddenReason: hide?.reason ?? null,
        hiddenReasonNote: hide?.reasonNote ?? null,
        hiddenAt: hide?.occurredAt ?? null,
        hiddenBy: hide?.recordedByName ?? null,
      };
    }),
    page: paged.page,
    pageCount: paged.pageCount,
    pageSize: paged.pageSize,
    total: paged.total,
  };
}

/** The reason codes a hide may state, for narrowing a posted form value. */
export const REVIEW_MODERATION_REASONS = reviewModerationReason.enumValues;

export type ReviewModerationReason = (typeof reviewModerationReason.enumValues)[number];

export type SetReviewPublishedResult =
  | true
  | "not_found"
  | "not_published"
  | "reason_required"
  | "note_required"
  | "note_too_long";

/**
 * Publish or hide one review, shop-scoped, recording the act either way.
 *
 * Hiding clears `publishedAt` so a later re-publish sorts by when it was
 * actually released rather than by a stale first release — a review taken down
 * and restored belongs at the top of the list it rejoins, not buried where it
 * used to be. A review waiting for its first read may be hidden directly; it
 * remains unpublished and the recorded act is what moves it out of the
 * waiting queue.
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
  if (!isUuid(reviewId)) return "not_found";
  const note = moderation.reason === "other" ? moderation.reasonNote?.trim() || null : null;
  if (!isPublished) {
    if (!moderation.reason) return "reason_required";
    if (moderation.reason === "other" && !note) return "note_required";
    if (note && note.length > 200) return "note_too_long";
  }
  const now = moderation.now ?? nowDate();

  return db.transaction(async (tx) => {
    // The state predicate makes the transition compare-and-swap. A repeated
    // publish/hide or two staffers acting at once cannot append duplicate
    // moderation events or silently re-date a review that already won the
    // race. The live-person predicate also makes erasure terminal for public
    // review publication.
    const hidden = hiddenReviewExists(tx);
    const transitionState = isPublished
      ? eq(tripReviews.isPublished, false)
      : or(eq(tripReviews.isPublished, true), and(eq(tripReviews.isPublished, false), not(hidden)));
    const [updated] = await tx
      .update(tripReviews)
      // Standout is a public-only choice. Hiding removes it, and publishing a
      // previously hidden/unread review starts it as an ordinary published
      // review that staff can mark standout again if they still want to.
      .set({
        isPublished,
        isStandout: false,
        publishedAt: isPublished ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(tripReviews.id, reviewId),
          eq(tripReviews.shopId, shopId),
          transitionState,
          exists(
            tx
              .select({ one: people.id })
              .from(people)
              .where(and(eq(people.id, tripReviews.personId), isNull(people.anonymizedAt))),
          ),
        ),
      )
      .returning({ id: tripReviews.id });
    if (!updated) {
      const [current] = await tx
        .select({ isPublished: tripReviews.isPublished, anonymizedAt: people.anonymizedAt })
        .from(tripReviews)
        .innerJoin(people, eq(people.id, tripReviews.personId))
        .where(and(eq(tripReviews.id, reviewId), eq(tripReviews.shopId, shopId)))
        .limit(1);
      if (!current || current.anonymizedAt) return "not_found";
      // Publishing is idempotent. Hiding is intentionally not: a second hide
      // is a stale form submission, not a new recorded moderation act.
      return isPublished && current.isPublished ? true : "not_published";
    }

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

export type SetReviewStandoutResult = true | "not_found" | "not_published";

/** Mark or unmark a published review for the public curated set. */
export async function setReviewStandout(
  db: AppDb,
  shopId: string,
  reviewId: string,
  isStandout: boolean,
): Promise<SetReviewStandoutResult> {
  if (!isUuid(reviewId)) return "not_found";
  const [updated] = await db
    .update(tripReviews)
    .set({ isStandout, updatedAt: nowDate() })
    .where(
      and(
        eq(tripReviews.id, reviewId),
        eq(tripReviews.shopId, shopId),
        eq(tripReviews.isPublished, true),
        isNotNull(tripReviews.comment),
        exists(
          db
            .select({ one: people.id })
            .from(people)
            .where(and(eq(people.id, tripReviews.personId), isNull(people.anonymizedAt))),
        ),
      ),
    )
    .returning({ id: tripReviews.id });
  if (updated) return true;
  const [review] = await db
    .select({
      isPublished: tripReviews.isPublished,
      comment: tripReviews.comment,
      anonymizedAt: people.anonymizedAt,
    })
    .from(tripReviews)
    .innerJoin(people, eq(people.id, tripReviews.personId))
    .where(and(eq(tripReviews.id, reviewId), eq(tripReviews.shopId, shopId)))
    .limit(1);
  return review && !review.anonymizedAt && review.isPublished ? "not_published" : "not_found";
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
        isStandout: false,
        publishedAt: sql`coalesce(${tripReviews.publishedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(tripReviews.shopId, shopId),
          inArray(tripReviews.id, ids),
          eq(tripReviews.isPublished, false),
          exists(
            tx
              .select({ one: people.id })
              .from(people)
              .where(and(eq(people.id, tripReviews.personId), isNull(people.anonymizedAt))),
          ),
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

/** What is waiting on staff, and — when it is a single review — which one. */
export type ReviewsAwaitingModeration = {
  /** How many reviews are waiting on staff. */
  count: number;
  /**
   * The waiting review's id when there is exactly one, so Today's row can point
   * at it (`/shop/<slug>/reviews#review-<id>`). Null at every other count: with
   * several pending there is no "the" review to link to.
   */
  onlyId: string | null;
};

/**
 * What is waiting on staff: the count Today's row words itself with, plus the
 * one review's id when the count is exactly 1. Both come off the same aggregate
 * so the deep link costs no second query.
 */
export async function readReviewsAwaitingModeration(
  db: DbExecutor,
  shopId: string,
): Promise<ReviewsAwaitingModeration> {
  const hidden = hiddenReviewExists(db);
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      // Any one waiting id — only meaningful at a count of 1, which is the only
      // count it survives below. Cast to text so the aggregate does not depend
      // on min()/max() over uuid, which Postgres only grew in 16.
      anyId: sql<string | null>`min(${tripReviews.id}::text)`,
    })
    .from(tripReviews)
    .where(and(eq(tripReviews.shopId, shopId), eq(tripReviews.isPublished, false), not(hidden)));
  const count = row?.count ?? 0;
  return { count, onlyId: count === 1 ? (row?.anyId ?? null) : null };
}

/** How many reviews are waiting on staff — the badge on the moderation nav entry. */
export async function countReviewsAwaitingModeration(
  db: DbExecutor,
  shopId: string,
): Promise<number> {
  return (await readReviewsAwaitingModeration(db, shopId)).count;
}
