import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * Two small records a departure leaves behind at the desk (batch 4): what was
 * found aboard after it, and the operational notes sent to everyone on it.
 */

/**
 * Where a found item stands. `open` until it goes home with its owner
 * (`returned`) or the shop gives up on it (`discarded`). Both resolved states
 * are pruned after `RETENTION_DAYS.lost_items` (`src/lib/retention.ts`).
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("departure_notes_shop_trip_idx").on(table.shopId, table.tripId, table.sentAt),
    check("departure_notes_body_length", sql`length(trim(${table.body})) between 1 and 200`),
  ],
);

export type LostItem = typeof lostItems.$inferSelect;
export type LostItemStatus = (typeof lostItemStatus.enumValues)[number];
export type DepartureNote = typeof departureNotes.$inferSelect;
