import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { TripCreditKind, TripCreditReason } from "@/lib/trip-credit";
import { bookings } from "./bookings";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";

/** Economic entries never change. Audited identity merge may repoint only personId. */
export const tripCreditEntries = pgTable(
  "trip_credit_entries",
  {
    id: uuid("id").primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    currency: text("currency").notNull(),
    kind: text("kind").$type<TripCreditKind>().notNull(),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").$type<TripCreditReason>(),
    /** A redeem's or restore's seat; a referral grant's buddy seat. */
    bookingId: uuid("booking_id").references(() => bookings.id),
    restoresEntryId: uuid("restores_entry_id").references((): AnyPgColumn => tripCreditEntries.id),
    /** Who acted. A referral grant has none: the shop tick writes it. */
    actorPersonId: uuid("actor_person_id").references(() => people.id),
    occurredAt: appNowTimestamp("occurred_at").notNull(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    uniqueIndex("trip_credit_entries_scoped_id_unique").on(table.shopId, table.id),
    uniqueIndex("trip_credit_entries_restore_once").on(table.restoresEntryId),
    // A buddy's seat earns its referrer one credit (ADR 20261125-buddy-referral-trip-credit).
    uniqueIndex("trip_credit_entries_referral_once")
      .on(table.shopId, table.bookingId)
      .where(sql`${table.reason} = 'referral'`),
    index("trip_credit_entries_person_idx").on(table.personId, table.shopId),
    index("trip_credit_entries_actor_idx").on(table.actorPersonId, table.shopId),
    index("trip_credit_entries_balance_idx").on(
      table.shopId,
      table.personId,
      table.currency,
      table.seq,
    ),
    index("trip_credit_entries_booking_idx").on(table.shopId, table.bookingId),
    foreignKey({
      name: "trip_credit_entries_booking_shop_fk",
      columns: [table.shopId, table.bookingId],
      foreignColumns: [bookings.shopId, bookings.id],
    }),
    foreignKey({
      name: "trip_credit_entries_restore_shop_fk",
      columns: [table.shopId, table.restoresEntryId],
      foreignColumns: [table.shopId, table.id],
    }),
    check("trip_credit_entries_amount_positive", sql`${table.amountCents} > 0`),
    check("trip_credit_entries_currency", sql`${table.currency} ~ '^[a-z]{3}$'`),
    check(
      "trip_credit_entries_shape",
      sql`(
    (${table.kind} = 'grant' and ${table.reason} is not null and ${table.reason} in ('goodwill', 'promotion') and ${table.bookingId} is null and ${table.restoresEntryId} is null and ${table.actorPersonId} is not null)
    or (${table.kind} = 'grant' and ${table.reason} is not null and ${table.reason} = 'referral' and ${table.bookingId} is not null and ${table.restoresEntryId} is null and ${table.actorPersonId} is null)
    or (${table.kind} = 'redeem' and ${table.reason} is null and ${table.bookingId} is not null and ${table.restoresEntryId} is null and ${table.actorPersonId} is not null)
    or (${table.kind} = 'restore' and ${table.reason} is null and ${table.bookingId} is not null and ${table.restoresEntryId} is not null)
  )`,
    ),
  ],
);
