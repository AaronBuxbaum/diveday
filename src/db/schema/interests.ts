import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings, tripLastMinutePromos } from "./bookings";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { courses } from "./courses";
import { trips } from "./trips";

/**
 * Everyone who wants a seat: one table, one lifecycle (ADR
 * 20261017-one-interest-with-a-scope). Staff see **Who wants in** and **Offer a
 * seat**, never the table's name.
 */

/**
 * What the interest asked for: `departure` (this boat), `date` (a day that is not
 * on the board) or `anytime` (the last-minute list, "tell me if something
 * opens"). Mirrors `InterestScope` in src/lib/interests.ts; keep both in sync.
 */
export const interestScope = pgEnum("interest_scope", ["departure", "date", "anytime"]);

/** `diver`: their own form, or staff taking their call. `shop`: cold outreach. */
export const interestAskedBy = pgEnum("interest_asked_by", ["diver", "shop"]);

/**
 * How an interest ended. `booked` is written only by staff seating someone *from* a
 * interest, after the seat commits (never by the booking transaction, ADR
 * 20261017-one-interest-with-a-scope, R1); `done` by a staffer's tick; `unsubscribed`
 * by the diver on an anytime interest.
 */
export const interestClosedAs = pgEnum("interest_closed_as", ["booked", "done", "unsubscribed"]);

/**
 * The one question that changes what the shop replies with to a date request:
 * enrollment, referral to an earlier course, or a card the desk reviews first.
 * Mirrors `CourseInquiryExperience` in src/lib/course-inquiry.ts.
 */
export const interestExperience = pgEnum("interest_experience", [
  "never",
  "tried",
  "certified",
  "lapsed",
]);

/**
 * A person who wants a seat. It is deliberately not a booking: an interest never
 * consumes capacity or appears on a manifest, and `bookings.ts` never reads or
 * writes it. `askedAt` is when they asked (a fact, not a queue position, ADR
 * 20260813-wait-list-is-a-lead-list); a carried row keeps the original.
 *
 * Each scope owns its columns and the checks below keep the others null. Every
 * offer is a **departure** row: offering a seat to a date or anytime interest
 * copies it to one, with `parentInterestId` pointing back.
 */
export const interests = pgTable(
  "interests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    scope: interestScope("scope").notNull(),
    askedBy: interestAskedBy("asked_by").notNull(),
    /**
     * The interest this row was copied from: a date interest attached to a new
     * departure, an anytime interest offered one, a departure interest carried or
     * rolled. `on delete set null`, or an erasure that deletes a parent would
     * raise 23503 and roll back every other redaction with it.
     */
    parentInterestId: uuid("parent_interest_id").references((): AnyPgColumn => interests.id, {
      onDelete: "set null",
    }),
    /**
     * Null only for a date interest (deliberately person-less, H-13: no person row
     * is made for a stranger's form) or a departure row copied from one.
     */
    personId: uuid("person_id").references(() => people.id),
    /** The contact snapshot a person-less interest keeps. */
    name: text("name"),
    email: text("email"),
    phone: text("phone"),

    // departure
    tripId: uuid("trip_id").references(() => trips.id),

    // date
    courseId: uuid("course_id").references(() => courses.id),
    /** What an ordinary dive request is about, in the diver's words. */
    interest: text("interest"),
    preferredDate: date("preferred_date", { mode: "string" }),
    alternateDate: date("alternate_date", { mode: "string" }),
    /** "Any of these, or near them" (`groupDateRequests`). */
    dateFlexible: boolean("date_flexible").notNull().default(false),
    experienceLevel: interestExperience("experience_level"),
    /** Free prose: "the week of 12 August". */
    timing: text("timing"),
    message: text("message"),

    // anytime
    availableFrom: date("available_from", { mode: "string" }),
    availableUntil: date("available_until", { mode: "string" }),

    // every scope
    /** The joiner and whoever dives with them, 1 to 20; required on a departure row. */
    partySize: integer("party_size"),
    askedAt: appNowTimestamp("asked_at").notNull(),
    /** Null is the diver's own form. */
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),

    // the offer (departure rows only)
    offeredAt: timestamp("offered_at", { withTimezone: true }),
    /**
     * An offer's last commercial email, sent or still sending; null when none
     * went. Taken by the send's claim and given back when the mail does not go,
     * so only mail that went holds the 24-hour window (#2133).
     */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    /** The deal this offer carried. */
    promoId: uuid("promo_id").references(() => tripLastMinutePromos.id),

    // the end
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedAs: interestClosedAs("closed_as"),
  },
  (table) => [
    check(
      "interests_scope_columns",
      sql`(
        (${table.scope} = 'departure'
          and ${table.tripId} is not null
          and ${table.courseId} is null
          and ${table.interest} is null
          and ${table.preferredDate} is null
          and ${table.alternateDate} is null
          and ${table.dateFlexible} = false
          and ${table.experienceLevel} is null
          and ${table.timing} is null
          and ${table.message} is null
          and ${table.availableFrom} is null
          and ${table.availableUntil} is null)
        or (${table.scope} = 'date'
          and ${table.tripId} is null
          and (${table.courseId} is not null or length(btrim(coalesce(${table.interest}, ''))) > 0)
          and ${table.availableFrom} is null
          and ${table.availableUntil} is null)
        or (${table.scope} = 'anytime'
          and ${table.tripId} is null
          and ${table.courseId} is null
          and ${table.interest} is null
          and ${table.preferredDate} is null
          and ${table.alternateDate} is null
          and ${table.dateFlexible} = false
          and ${table.experienceLevel} is null
          and ${table.timing} is null
          and ${table.message} is null
          and (${table.availableFrom} is null
            or ${table.availableUntil} is null
            or ${table.availableFrom} <= ${table.availableUntil}))
      )`,
    ),
    check(
      "interests_has_a_person",
      sql`${table.scope} = 'date' or ${table.personId} is not null or ${table.parentInterestId} is not null`,
    ),
    check(
      "interests_offer_is_a_departure",
      sql`${table.scope} = 'departure' or (${table.offeredAt} is null and ${table.promoId} is null)`,
    ),
    check(
      "interests_emailed_after_offer",
      sql`${table.emailedAt} is null or ${table.offeredAt} is not null`,
    ),
    check(
      "interests_closed_together",
      sql`(${table.closedAt} is null) = (${table.closedAs} is null)`,
    ),
    check(
      "interests_party_size_range",
      sql`(${table.partySize} is not null or ${table.scope} <> 'departure') and (${table.partySize} is null or ${table.partySize} between 1 and 20)`,
    ),
    // One row per person per departure: a diver who is waiting and is then
    // invited cold is the same row.
    uniqueIndex("interests_departure_person_unique")
      .on(table.tripId, table.personId)
      .where(sql`${table.scope} = 'departure' and ${table.personId} is not null`),
    // A date interest attached to a departure twice is one row.
    uniqueIndex("interests_departure_parent_unique")
      .on(table.tripId, table.parentInterestId)
      .where(sql`${table.scope} = 'departure' and ${table.parentInterestId} is not null`),
    uniqueIndex("interests_shop_id_id_unique").on(table.shopId, table.id),
    uniqueIndex("interests_anytime_shop_person_unique")
      .on(table.shopId, table.personId)
      .where(sql`${table.scope} = 'anytime'`),
    // The panel's first group.
    index("interests_departure_idx")
      .on(table.shopId, table.tripId, table.askedAt)
      .where(sql`${table.scope} = 'departure'`),
    // `/requests`, the board's "asked" row and the panel's "within reach" read.
    index("interests_date_preferred_idx")
      .on(table.shopId, table.preferredDate)
      .where(sql`${table.scope} = 'date' and ${table.closedAt} is null`),
    index("interests_date_alternate_idx")
      .on(table.shopId, table.alternateDate)
      .where(sql`${table.scope} = 'date' and ${table.closedAt} is null`),
    // The panel's third group and Today's last-minute count.
    index("interests_anytime_open_idx")
      .on(table.shopId)
      .where(sql`${table.scope} = 'anytime' and ${table.closedAt} is null`),
    // Foreign-key probes.
    index("interests_person_idx").on(table.personId),
    index("interests_created_by_person_idx").on(table.createdByPersonId),
    index("interests_parent_idx").on(table.parentInterestId),
    index("interests_course_idx").on(table.courseId),
    index("interests_promo_idx").on(table.promoId),
    // The weekly digest and new-interest alerts.
    index("interests_shop_asked_idx").on(table.shopId, table.askedAt),
  ],
);

export type Interest = typeof interests.$inferSelect;

/**
 * One successfully seated booking answering one seat of a specific anonymous
 * date-request offer. All bookings linked to the same request stay on the
 * departure selected by its first linked booking; cancellation frees its seat
 * but preserves that departure choice. A party can be seated in several
 * bookings; keeping one row per booking preserves the unseated part of its offer.
 */
export const dateRequestOfferBookings = pgTable(
  "date_request_offer_bookings",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    interestId: uuid("interest_id")
      .notNull()
      .references(() => interests.id, { onDelete: "cascade" }),
    /** A booking answers at most one offered request. */
    bookingId: uuid("booking_id").notNull().primaryKey(),
  },
  (table) => [
    foreignKey({
      name: "date_request_offer_bookings_shop_interest_fk",
      columns: [table.shopId, table.interestId],
      foreignColumns: [interests.shopId, interests.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "date_request_offer_bookings_shop_booking_fk",
      columns: [table.shopId, table.bookingId],
      foreignColumns: [bookings.shopId, bookings.id],
    }).onDelete("cascade"),
    index("date_request_offer_bookings_shop_interest_idx").on(table.shopId, table.interestId),
  ],
);

/**
 * A diver-facing, self-serve bearer link to unsubscribe one **anytime** interest
 * (the last-minute list; docs features/story-backlog.md "Leo — self-serve email
 * unsubscribe"). A fresh token is minted for every deal blast rather than one
 * stable token per interest (mirrors `bookingCapabilities`, not `calendarFeeds`), so
 * an old email's link keeps working even after a later blast mints another.
 * Deliberately never expires: an expired unsubscribe link would leave someone
 * unable to opt out, silently. Consuming a token only ever closes the interest as
 * `unsubscribed`, an idempotent write, so there is nothing to mark used or
 * revoke. Same semantics as the `last_minute_list_unsubscribe_tokens` it
 * replaces (ADR 20261017-one-interest-with-a-scope).
 */
export const interestUnsubscribeTokens = pgTable(
  "interest_unsubscribe_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    interestId: uuid("interest_id")
      .notNull()
      .references(() => interests.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: appNowTimestamp("issued_at").notNull(),
  },
  (table) => [index("interest_unsubscribe_tokens_interest_idx").on(table.interestId)],
);

export type InterestUnsubscribeToken = typeof interestUnsubscribeTokens.$inferSelect;
