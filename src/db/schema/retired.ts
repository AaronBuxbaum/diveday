import { getTableName, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { courses } from "./courses";
import { trips } from "./trips";

/*
 * **Retired tables: no code reads or writes them, and they are not exported
 * from `index.ts`** (ADR 20261017-one-lead-with-a-scope). Their rows now live in
 * `leads`. The tables stay in the database for one release because the deploy in
 * flight still reads them; a declaration that `drizzle.config.ts` still sees
 * keeps `drizzle-kit generate` from writing the `DROP TABLE` early. The next
 * release deletes this file and the generated migration drops them, each with
 * its `-- diveday:allow-destructive` marker (H-49). Application code imports nothing
 * from here; the schema-exhaustive guards (`RETIRED_TABLE_NAMES`) do, to skip
 * tables that are still in the database but no longer in the model.
 */

/**
 * A diver who asked to be told if a full trip frees a seat. It is deliberately
 * separate from bookings: a wait-list entry never consumes capacity or appears
 * on a manifest. It is also **not a queue position** — `createdAt` records when
 * the diver asked, and the shop invites whoever fits the departure
 * (ADR 20260813-wait-list-is-a-lead-list).
 */
export const tripWaitlistEntries = pgTable(
  "trip_waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    createdAt: appNowTimestamp("created_at").notNull(),
    // When staff last invited this diver to grab a freed seat. Null until the
    // first invite; shown as "Invited 2h ago" so two staff don't double-invite.
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    // How many seats this lead waits for: the joiner and the people they are
    // diving with, who wait and are invited together, never split across dates
    // (fourth review, item 34; ADR 20260719-trip-waitlist, amended). The
    // public form's own ceiling bounds it.
    partySize: integer("party_size").notNull().default(1),
  },
  (table) => [
    check("trip_waitlist_entries_party_size_range", sql`${table.partySize} between 1 and 20`),
    uniqueIndex("trip_waitlist_entries_trip_person_unique").on(table.tripId, table.personId),
    index("trip_waitlist_entries_trip_created_idx").on(table.tripId, table.createdAt),
    index("trip_waitlist_entries_shop_trip_idx").on(table.shopId, table.tripId),
  ],
);

/**
 * A staff-selected invitation to a departure. This is deliberately not a
 * booking and not a wait-list position: it reserves no capacity, never enters
 * the manifest, and can be created for the same request on more than one trip.
 * The source discriminator separates a request-origin invitation from a direct
 * one without forcing those concepts to share a table's meaning (ADR
 * 20260816-trip-invitations).
 *
 * **`waitlist` was here and is gone** (issue #1616). The ADR left room for it
 * and nothing ever filled that room: no writer set the source, so no row ever
 * carried the `waitlist_entry_id` the branch required. What the dead column
 * *did* carry was a foreign key into `trip_waitlist_entries` with no
 * `onDelete`, and the erasure hard-deletes a diver's wait-list rows — so a
 * single populated row would have raised 23503 inside the erasure transaction
 * and rolled back every other redaction with it. `anonymizeDiver` catches
 * nothing and `eraseDiverAction` has no handler, so what an owner would have
 * met is a server-action error and an erasure that never happened — total and
 * opaque rather than silent. H-49 is the rule that applies: a column nothing
 * writes is dropped rather than defended, and dropping it removes the hazard
 * instead of sequencing around it.
 */
export const tripInvitationSource = pgEnum("trip_invitation_source", ["date_request", "direct"]);

export const tripInvitations = pgTable(
  "trip_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    source: tripInvitationSource("source").notNull(),
    /** Set for a request-origin invitation; the request carries its contact snapshot. */
    courseInquiryId: uuid("course_inquiry_id").references(() => courseInquiries.id),
    /** Set only for a direct existing-diver invitation. */
    personId: uuid("person_id").references(() => people.id),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    /** The staff outreach attempt; null means the invitation is still pending. */
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    /**
     * A cold (`direct`) invitation's last email, sent or still sending; null
     * when none went. Set by the send's claim and rolled back when the mail
     * does not go, so only mail that went holds the 24-hour window (#2133).
     */
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("trip_invitations_shop_trip_idx").on(table.shopId, table.tripId, table.createdAt),
    uniqueIndex("trip_invitations_trip_request_unique")
      .on(table.tripId, table.courseInquiryId)
      .where(sql`${table.courseInquiryId} is not null`),
    uniqueIndex("trip_invitations_trip_person_unique")
      .on(table.tripId, table.personId)
      .where(sql`${table.personId} is not null`),
    check(
      "trip_invitations_source_reference_check",
      sql`(
        (${table.source} = 'date_request' and ${table.courseInquiryId} is not null and ${table.personId} is null)
        or (${table.source} = 'direct' and ${table.courseInquiryId} is null and ${table.personId} is not null)
      )`,
    ),
  ],
);

/** Retired with `course_inquiries`: now `lead_experience` (`leads.ts`). */
export const courseInquiryExperience = pgEnum("course_inquiry_experience", [
  "never",
  "tried",
  "certified",
  "lapsed",
]);

/** Retired with `course_inquiries`: now `lead_closed_as` (`leads.ts`). */
export const courseInquiryOutcome = pgEnum("course_inquiry_outcome", ["booked", "done"]);

/**
 * A diver asking a shop to run something on a date that is not on the board.
 * Its rows are `leads` with `scope = 'date'` (ADR 20261017-one-lead-with-a-scope,
 * which supersedes 20260814-a-date-request-is-a-course-inquiry). The columns
 * map one to one: `divers` is `party_size`, `created_at` is `asked_at`,
 * `handled_at`/`handled_as` are `closed_at`/`closed_as`.
 */
export const courseInquiries = pgTable(
  "course_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    courseId: uuid("course_id").references(() => courses.id),
    interest: text("interest"),
    preferredDate: date("preferred_date", { mode: "string" }),
    alternateDate: date("alternate_date", { mode: "string" }),
    dateFlexible: boolean("date_flexible").notNull().default(false),
    personId: uuid("person_id").references(() => people.id),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    experienceLevel: courseInquiryExperience("experience_level"),
    timing: text("timing"),
    divers: integer("divers"),
    message: text("message"),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    handledAs: courseInquiryOutcome("handled_as"),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("course_inquiries_shop_created_idx").on(table.shopId, table.createdAt),
    index("course_inquiries_course_idx").on(table.courseId),
    index("course_inquiries_shop_preferred_date_idx").on(table.shopId, table.preferredDate),
    check(
      "course_inquiries_subject_present",
      sql`${table.courseId} is not null or length(btrim(coalesce(${table.interest}, ''))) > 0`,
    ),
    check(
      "course_inquiries_handled_together",
      sql`(${table.handledAt} is null) = (${table.handledAs} is null)`,
    ),
  ],
);

/** The tables above, by name: still in the database, no longer in the model. */
export const RETIRED_TABLE_NAMES: readonly string[] = [
  getTableName(tripWaitlistEntries),
  getTableName(tripInvitations),
  getTableName(courseInquiries),
];
