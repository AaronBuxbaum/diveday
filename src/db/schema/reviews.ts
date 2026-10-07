import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * After the dive: recap photos, reviews and their moderation, recap pulses.
 */

/**
 * A photo a diver attaches to their own post-trip recap page. The recap link is
 * a per-booking signed token (public, noindex), so an upload is scoped to that
 * booking and a diver only ever sees the shots on their own page. Staff see a
 * trip's diver photos on the roster so the shop can reuse them and take down
 * anything inappropriate — the moderation seam is a delete, mirroring the opt-in
 * `dive_site_moments` shape (20260723-post-trip-recap follow-up).
 */
export const recapPhotos = pgTable(
  "recap_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    imageUrl: text("image_url").notNull(),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recap_photos_booking_idx").on(table.bookingId, table.createdAt),
    index("recap_photos_trip_idx").on(table.tripId, table.createdAt),
  ],
);

/**
 * A crew-owned image kept with a departure's close-out. Unlike `recapPhotos`,
 * it has no diver booking because one upload is shared with every diver on
 * the completed departure's recap.
 */
export const tripRecapPhotos = pgTable(
  "trip_recap_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    imageUrl: text("image_url").notNull(),
    uploadedByPersonId: uuid("uploaded_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_recap_photos_shop_trip_idx").on(table.shopId, table.tripId, table.createdAt),
  ],
);

/**
 * A star rating (and optional words) from a diver who provably dived — the row
 * is only ever written through that booking's own signed recap link, so unlike
 * an open web form there is no way to leave one without having been on the
 * boat. Unique on `booking_id`: a diver revises their own review rather than
 * stacking several, and a replayed submit can't inflate a shop's average.
 *
 * `isPublished` is the moderation seam, same shape as `diveSiteMoments`. A
 * bare rating carries no text to moderate and publishes immediately; a review
 * *with* a comment waits for staff, because the comment lands on the shop's
 * public schedule page. Aggregates are computed over published rows only, so
 * the number a visitor sees and the reviews under it always describe the same
 * set (docs ADR 20260729-verified-diver-reviews).
 */
export const tripReviews = pgTable(
  "trip_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    /** Staff curation flag for the public review selection. */
    isStandout: boolean("is_standout").notNull().default(false),
    isPublished: boolean("is_published").notNull().default(false),
    /** Null until published; drives "newest published first" on the public list. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_reviews_booking_unique").on(table.bookingId),
    // The public aggregate and list query verbatim: this shop's published rows,
    // newest first, so a shop with years of reviews still renders from an index.
    index("trip_reviews_shop_published_idx")
      .on(table.shopId, table.publishedAt)
      .where(sql`${table.isPublished}`),
    // The staff moderation queue: everything for the shop, newest first.
    index("trip_reviews_shop_created_idx").on(table.shopId, table.createdAt),
    check("trip_reviews_rating_range", sql`${table.rating} between 1 and 5`),
  ],
);

/**
 * Why a shop took a review down. A code, never a sentence — the UI picks the
 * words (ADR 20260731-domain-layer-copy-leaks) — and a deliberately short list,
 * because the list *is* the constraint: an unconstrained hide button plus a
 * machine-readable `aggregateRating` is how a curated set gets published as an
 * impartial measurement (ADR 20260813-review-moderation-has-a-floor).
 *
 * `other` exists so a shop facing a case these four do not describe is never
 * stuck, and it is the one value that requires `reason_note` to be filled in.
 */
export const reviewModerationReason = pgEnum("review_moderation_reason", [
  /** Abusive or harassing — aimed at a person rather than the diving. */
  "abusive",
  /** Names a member of staff or another diver. */
  "names_a_person",
  /** About a different trip, a different shop, or plainly not this dive. */
  "wrong_subject",
  /** Spam, an advertisement, or a test submission. */
  "spam",
  /** Something else, stated in `reason_note`. */
  "other",
]);

export const reviewModerationAction = pgEnum("review_moderation_action", ["published", "hidden"]);

/**
 * Every publish and hide, append-only — the trail
 * ADR 20260813-review-moderation-has-a-floor added, shaped like
 * `buddy_team_events` and the roll-call trails beside it.
 *
 * It exists for two reasons and the second is the load-bearing one. It records
 * what a shop asserted when it recorded an unverified declaration; and it is what makes
 * "how much of this shop's record has been suppressed?" answerable, which
 * decides whether DiveDay will still vouch for the shop's average in JSON-LD.
 * A review sitting unpublished because it carries words nobody has read yet is
 * *not* suppressed, and only a recorded `hidden` act tells the two apart.
 */
export const reviewModerationEvents = pgTable(
  "review_moderation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => tripReviews.id),
    action: reviewModerationAction("action").notNull(),
    /** Null on a publish: releasing a review states no case. */
    reason: reviewModerationReason("reason"),
    /** The shop's own words, required when `reason` is `other`. */
    reasonNote: text("reason_note"),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("review_moderation_events_shop_idx").on(table.shopId, table.occurredAt),
    index("review_moderation_events_review_idx").on(table.reviewId),
    // A hide states a case or it does not happen; `other` states it in words.
    check(
      "review_moderation_events_hidden_has_reason",
      sql`${table.action} <> 'hidden' or ${table.reason} is not null`,
    ),
    check(
      "review_moderation_events_other_has_note",
      sql`${table.reason} <> 'other' or length(trim(coalesce(${table.reasonNote}, ''))) > 0`,
    ),
  ],
);

/**
 * **What a diver's private pulse was about** — a code, never a sentence, so the
 * shop reads it in its own language and the diver picked it in theirs (ADR
 * 20260731-domain-layer-copy-leaks).
 *
 * Five, and deliberately short. The list *is* the design: an open box asking
 * "how was it?" the evening after a dive gets either nothing or an essay, and a
 * shop reading essays fixes nothing. Four name the things a dive day goes wrong
 * at and a shop can change by Tuesday; `other` exists so a diver with a fifth
 * thing is never stuck, and `note` is where they say it.
 */
export const recapPulseCategory = pgEnum("recap_pulse_category", [
  /** Rental kit: fit, condition, what was missing. */
  "gear",
  /** The dive brief and what it did or did not cover. */
  "briefing",
  /** The vessel itself: space, shade, the head, the ladder. */
  "boat",
  /** When things happened against when they were said to. */
  "timing",
  /** Anything these four do not describe; `note` carries it. */
  "other",
]);

/**
 * **The private twin of a review** (delight report D40, issue #1200) — which is
 * why it sits directly under `trip_reviews` and its moderation trail rather
 * than off in a concern of its own.
 *
 * A diver who had a thin day has exactly one door on the recap today, and it is
 * the public one. So the shop either learns nothing or learns it in front of
 * everybody. This is the other door: **just for the shop, never on the review,
 * never public.** Nothing here may reach `listPublishedShopReviews`, the JSON-LD
 * aggregate, or the suppression share `countSuppressedReviews` computes — a
 * pulse is not a review and counts as one in neither direction.
 *
 * `shop_id`, `trip_id` and `person_id` are derived from the booking by
 * `submitRecapPulse` and never accepted from the form: the recap token resolves
 * to a booking, and the booking is the only thing that says whose pulse this is
 * (the rule `submitTripReview` already keeps).
 */
export const recapPulses = pgTable(
  "recap_pulses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** One or more category codes — the jsonb-array shape `trip_requirements.required_specialties` uses. */
    categories: jsonb("categories")
      .$type<(typeof recapPulseCategory.enumValues)[number][]>()
      .notNull()
      .default([]),
    /** The diver's own words, optional, bounded at `MAX_RECAP_PULSE_NOTE_LENGTH` server-side. */
    note: text("note"),
    /** Stamped when a staffer marks it dealt with. Null is the open state. */
    addressedAt: timestamp("addressed_at", { withTimezone: true }),
    addressedByPersonId: uuid("addressed_by_person_id").references(() => people.id),
    /**
     * **The diver's way back.** Clearing every category takes the pulse back,
     * and that delete is soft like every other (ADR
     * 20260820-every-delete-is-soft): the row stays, the shop stops seeing it.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One live pulse per booking. Partial, over the live rows only, so a
    // withdrawn pulse does not block the diver writing a new one.
    uniqueIndex("recap_pulses_booking_live_unique")
      .on(table.bookingId)
      .where(sql`${table.deletedAt} is null`),
    // The staff panel's query verbatim: this shop's open items, newest first.
    index("recap_pulses_shop_open_idx")
      .on(table.shopId, table.createdAt)
      .where(sql`${table.addressedAt} is null and ${table.deletedAt} is null`),
    // A live pulse is about something. An empty one is a withdrawal, and a
    // withdrawal is a deleted row, so this cannot be satisfied by an empty array.
    check(
      "recap_pulses_live_has_category",
      sql`${table.deletedAt} is not null or jsonb_array_length(${table.categories}) > 0`,
    ),
    // Who marked it addressed is recorded with the fact, or neither is.
    check(
      "recap_pulses_addressed_has_actor",
      sql`(${table.addressedAt} is null) = (${table.addressedByPersonId} is null)`,
    ),
  ],
);
