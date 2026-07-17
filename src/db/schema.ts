import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The domain spine. Multi-tenant from day one: every domain table carries
 * shop_id (ADR-0005, docs/architecture/overview.md). People get roles, not
 * types — a person can be staff and a customer (docs/product/glossary.md).
 */

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** IANA timezone of the physical shop — all schedule display uses this. */
  timezone: text("timezone").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const personRole = pgEnum("person_role", [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
  "customer",
]);

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    fullName: text("full_name").notNull(),
    /** Nullable: walk-ups may not have one on file yet. */
    email: text("email"),
    phone: text("phone"),
    /** Manifests require these; nullable until collected at booking/check-in. */
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("people_shop_idx").on(table.shopId)],
);

export const personRoles = pgTable(
  "person_roles",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    role: personRole("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.personId, table.role] })],
);

export const tripStatus = pgEnum("trip_status", ["scheduled", "cancelled"]);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    status: tripStatus("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trips_shop_starts_idx").on(table.shopId, table.startsAt)],
);

export const bookingStatus = pgEnum("booking_status", [
  "booked",
  "checked_in",
  "cancelled",
  "no_show",
]);

export const bookings = pgTable(
  "bookings",
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
    status: bookingStatus("status").notNull().default("booked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_trip_person_unique").on(table.tripId, table.personId),
    index("bookings_trip_idx").on(table.tripId),
  ],
);

export type Shop = typeof shops.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
