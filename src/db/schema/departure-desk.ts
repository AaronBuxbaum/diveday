import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * Two small records a departure leaves behind at the desk (batch 4): what was
 * found aboard after it, and the operational notes sent to everyone on it.
 */

/**
 * Where a found item stands. `open` until it goes home with its owner
 * (`returned`) or the shop gives up on it (`discarded`). Both resolved states
 * are pruned after `RETENTION_DAYS.lost_items` (`src/features/retention/rules.ts`).
 */
export const lostItemStatus = pgEnum("lost_item_status", ["open", "returned", "discarded"]);

/** Which channel carried the "we found your…" message. */
export const lostItemToldChannel = pgEnum("lost_item_told_channel", ["email", "sms", "whatsapp"]);

/**
 * **Something left aboard** ("blue mask, seat 4"), recorded by the crew at the
 * close of a departure, optionally tied to the seat it was found at.
 *
 * `booking_id` and `person_id` travel together: both null for an item nobody
 * has claimed, both set when the crew knows whose it is. The person is who the
 * one-tap message goes to; an erasure deletes the row outright, because its
 * description is free text about that person's belongings.
 */
export const lostItems = pgTable(
  "lost_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    personId: uuid("person_id").references(() => people.id),
    description: text("description").notNull(),
    status: lostItemStatus("status").notNull().default("open"),
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    /** The last time the owner was told, and how. Null until somebody taps Tell. */
    toldAt: timestamp("told_at", { withTimezone: true }),
    toldChannel: lostItemToldChannel("told_channel"),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    index("lost_items_shop_status_idx").on(table.shopId, table.status, table.createdAt),
    index("lost_items_shop_trip_idx").on(table.shopId, table.tripId),
    // Erasure deletes a diver's found items by `(shop_id, person_id)`
    // (`anonymize.ts`), and the people FK is checked on every person write.
    index("lost_items_shop_person_idx")
      .on(table.shopId, table.personId)
      .where(sql`${table.personId} is not null`),
    check(
      "lost_items_description_length",
      sql`length(trim(${table.description})) between 1 and 120`,
    ),
    check(
      "lost_items_resolved_matches_status",
      sql`(${table.status} = 'open') = (${table.resolvedAt} is null)`,
    ),
    check(
      "lost_items_seat_and_person_together",
      sql`(${table.bookingId} is null) = (${table.personId} is null)`,
    ),
  ],
);

/**
 * **A note to everyone on a departure** ("Marina lot closed, park at the
 * Elks"): the record that it went, written once the held send leaves
 * (`src/db/departure-notes.ts`). An Undo inside the hold writes nothing here.
 *
 * The body is the staffer's own words, checked before it is held
 * (`departureNoteProblem`, `src/lib/departure-notes.ts`): one line, short, and
 * no link of their own.
 */
export const departureNotes = pgTable(
  "departure_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    body: text("body").notNull(),
    sentByPersonId: uuid("sent_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    /** Seats it was addressed to, and how many of them a provider accepted. */
    recipients: integer("recipients").notNull().default(0),
    delivered: integer("delivered").notNull().default(0),
    sentAt: appNowTimestamp("sent_at").notNull(),
  },
  (table) => [
    index("departure_notes_shop_trip_idx").on(table.shopId, table.tripId, table.sentAt),
    check("departure_notes_body_length", sql`length(trim(${table.body})) between 1 and 500`),
  ],
);

/**
 * Where a boarding observation stands (issue #4474). `pending` until the seat
 * allocation runs under the departure's lock; `applied` once the seat is held
 * again; `conflict` while the departure cannot take the diver back, which
 * keeps the observation open and counted until someone sorts it out;
 * `dismissed` when a staffer says it no longer stands.
 */
export const boardingObservationState = pgEnum("boarding_observation_state", [
  "pending",
  "applied",
  "conflict",
  "dismissed",
]);

/**
 * **"They're here": a released diver seen at the dock** (issue #4474).
 *
 * Intake and allocation are two steps. The desk's tap writes this row and
 * commits without waiting on the departure, the seat or any schedule write, so
 * the physical observation is never lost behind a move or a crew edit. The seat
 * is then allocated under the departure's lock (`settleBoardingObservations`,
 * `src/db/boarding-observations.ts`): at once when the lock is free, otherwise
 * by the retry after the response and the shop tick.
 *
 * While the row is open (`pending` or `conflict`) the seat counts as held in
 * every capacity gate (`heldSeatCounts`), so the freed seat cannot be sold
 * over the diver standing at the dock. A conflict stays open, on the departure
 * and on the board, until the seat comes back or a staffer dismisses it.
 *
 * `trip_id` and `booking_id` carry **no foreign key on purpose**: an insert
 * takes `FOR KEY SHARE` on every referenced row, and a move or a sale holds
 * that departure and seat `FOR UPDATE`, so a key would make the observation
 * wait behind exactly the schedule writes it must never wait behind. Both ids
 * are read and proven this shop's before the insert, and neither row is ever
 * hard-deleted.
 *
 * `client_key` makes intake idempotent: a retried or replayed tap names the
 * same key and writes nothing new; the same key for another seat is refused.
 */
export const boardingObservations = pgTable(
  "boarding_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    clientKey: text("client_key").notNull(),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    observedAt: appNowTimestamp("observed_at").notNull(),
    state: boardingObservationState("state").notNull().default("pending"),
    /** Why the departure cannot take the diver back, while `conflict`. A code, never a sentence. */
    conflictCode: text("conflict_code"),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    dismissedByPersonId: uuid("dismissed_by_person_id").references(() => people.id),
  },
  (table) => [
    uniqueIndex("boarding_observations_client_key_unique").on(table.shopId, table.clientKey),
    // One open observation per seat: a second staffer's tap joins the first.
    uniqueIndex("boarding_observations_open_seat_unique")
      .on(table.bookingId)
      .where(sql`${table.state} in ('pending', 'conflict')`),
    index("boarding_observations_open_trip_idx")
      .on(table.shopId, table.tripId)
      .where(sql`${table.state} in ('pending', 'conflict')`),
    check(
      "boarding_observations_client_key_length",
      sql`length(${table.clientKey}) between 8 and 100`,
    ),
    check(
      "boarding_observations_conflict_has_code",
      sql`(${table.state} = 'conflict') = (${table.conflictCode} is not null)`,
    ),
    check(
      "boarding_observations_settled_unless_pending",
      sql`(${table.state} = 'pending') = (${table.settledAt} is null)`,
    ),
    check(
      "boarding_observations_dismissed_by",
      sql`(${table.state} = 'dismissed') = (${table.dismissedByPersonId} is not null)`,
    ),
  ],
);

export type BoardingObservation = typeof boardingObservations.$inferSelect;
export type BoardingObservationState = (typeof boardingObservationState.enumValues)[number];
export type LostItem = typeof lostItems.$inferSelect;
export type LostItemStatus = (typeof lostItemStatus.enumValues)[number];
export type DepartureNote = typeof departureNotes.$inferSelect;
