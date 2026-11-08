import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ConservationKind } from "@/lib/conservation";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { trips } from "./trips";

export const tripConservation = pgTable(
  "trip_conservation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    kind: text("kind").$type<ConservationKind>().notNull(),
    quantity: doublePrecision("quantity").notNull(),
    location: text("location").notNull().default(""),
    note: text("note").notNull().default(""),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    recordedAt: appNowTimestamp("recorded_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
    revision: integer("revision").notNull().default(1),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("trip_conservation_live_idx")
      .on(table.shopId, table.tripId)
      .where(sql`${table.deletedAt} is null`),
    check("trip_conservation_kind", sql`${table.kind} in ('litter_kg', 'litter_items', 'line_m')`),
    check(
      "trip_conservation_quantity",
      sql`${table.quantity} > 0 and ${table.quantity} <= 100000 and (${table.kind} <> 'litter_items' or ${table.quantity} = trunc(${table.quantity}::numeric))`,
    ),
  ],
);
