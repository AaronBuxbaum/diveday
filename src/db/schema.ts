import {
  boolean,
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

export const accountStatus = pgEnum("account_status", ["active", "disabled"]);

/**
 * A login method attached to a person — not an identity. Roles stay on
 * person_roles; staff-ness is derived, never stored here (ADR-0006).
 */
export const userAccounts = pgTable(
  "user_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    email: text("email").notNull(),
    hashedPassword: text("hashed_password").notNull(),
    status: accountStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_accounts_email_unique").on(table.email),
    uniqueIndex("user_accounts_person_unique").on(table.personId),
  ],
);

/**
 * Waivers (M3). A shop offers a versioned liability release; each booking gets
 * one waiver, signed pre-arrival via an opaque link. The RSTC medical statement
 * rides along — a "yes" answer means physician referral is required before the
 * diver may board, a blocking state, not a checkbox (docs/product/glossary.md).
 */
export const waiverTemplates = pgTable(
  "waiver_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    /** Full liability-release text shown to the signer (plain paragraphs). */
    body: text("body").notNull(),
    /** Attaches the medical statement — health questions appear on signing. */
    requiresMedical: boolean("requires_medical").notNull().default(true),
    /** The template offered for new signings; superseded ones stay for records. */
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("waiver_templates_shop_idx").on(table.shopId)],
);

export const waiverStatus = pgEnum("waiver_status", ["pending", "signed", "physician_required"]);

export const waivers = pgTable(
  "waivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    templateId: uuid("template_id")
      .notNull()
      .references(() => waiverTemplates.id),
    /** Opaque token for the pre-arrival signing URL (/waiver/<token>). */
    token: text("token").notNull(),
    status: waiverStatus("status").notNull().default("pending"),
    /** Typed full name = the e-signature (ADR-0007). Null until signed. */
    signedName: text("signed_name"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    /** Any "yes" on the medical statement flags physician referral. */
    medicalFlagged: boolean("medical_flagged").notNull().default(false),
    /** Flagged question ids (comma-joined) so the desk knows what to ask about. */
    medicalNotes: text("medical_notes"),
    /** Staff records physician sign-off here; lifts the block to "signed". */
    physicianClearedAt: timestamp("physician_cleared_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("waivers_token_unique").on(table.token),
    uniqueIndex("waivers_booking_unique").on(table.bookingId),
    index("waivers_shop_idx").on(table.shopId),
  ],
);

export type Shop = typeof shops.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type Waiver = typeof waivers.$inferSelect;
