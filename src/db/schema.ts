import {
  boolean,
  index,
  integer,
  jsonb,
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

/** Staff crewing a trip (captain, DM, instructor…). Roles live on person_roles. */
export const tripAssignments = pgTable(
  "trip_assignments",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
  },
  (table) => [primaryKey({ columns: [table.tripId, table.personId] })],
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
 * A template is versioned by insertion, never by mutation. A record captures
 * a text snapshot too, so even a later archive cannot alter signed history.
 */
export const waiverTemplates = pgTable(
  "waiver_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("waiver_templates_shop_title_version_unique").on(
      table.shopId,
      table.title,
      table.version,
    ),
    index("waiver_templates_shop_default_idx").on(table.shopId, table.isDefault),
  ],
);

export const waiverRecordStatus = pgEnum("waiver_record_status", [
  "pending",
  "completed",
  "medical_review",
]);

export type MedicalAnswers = {
  breathing: boolean;
  medication: boolean;
  recentIllness: boolean;
};

/**
 * One issued link gets one row. Pending rows may be superseded; completed rows
 * are immutable evidence and never updated or re-used for a new template.
 */
export const waiverRecords = pgTable(
  "waiver_records",
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
    templateTitle: text("template_title").notNull(),
    templateVersion: integer("template_version").notNull(),
    templateBody: text("template_body").notNull(),
    status: waiverRecordStatus("status").notNull().default("pending"),
    /** SHA-256 hash only — the raw bearer token is shown once when issued. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    draftSignerName: text("draft_signer_name"),
    draftAcknowledged: boolean("draft_acknowledged").notNull().default(false),
    draftMedicalAnswers: jsonb("draft_medical_answers").$type<MedicalAnswers>(),
    signedName: text("signed_name"),
    signatureMethod: text("signature_method"),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    medicalAnswers: jsonb("medical_answers").$type<MedicalAnswers>(),
    medicalReviewRequired: boolean("medical_review_required").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("waiver_records_booking_current_idx").on(table.bookingId, table.supersededAt),
    index("waiver_records_shop_status_idx").on(table.shopId, table.status),
  ],
);

export const certificationAgency = pgEnum("certification_agency", [
  "padi",
  "ssi",
  "naui",
  "sdi",
  "tdi",
  "other",
]);

/** Ordered in src/lib/readiness.ts — extend deliberately with the rank map. */
export const certificationLevel = pgEnum("certification_level", [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
]);

export const certificationStatus = pgEnum("certification_status", [
  "pending",
  "verified",
  "rejected",
]);

/** Evidence belongs to a person; requirements decide whether it is sufficient for a trip. */
export const certifications = pgTable(
  "certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    agency: certificationAgency("agency").notNull(),
    level: certificationLevel("level").notNull(),
    identifier: text("identifier").notNull(),
    /** Storage seam comes later; this is a provider-neutral durable reference. */
    cardImageUrl: text("card_image_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("certifications_shop_person_idx").on(table.shopId, table.personId),
    uniqueIndex("certifications_shop_agency_identifier_unique").on(
      table.shopId,
      table.agency,
      table.identifier,
    ),
  ],
);

/** One explicit requirement set per trip; absence is deliberately not treated as ready. */
export const tripRequirements = pgTable(
  "trip_requirements",
  {
    tripId: uuid("trip_id")
      .primaryKey()
      .references(() => trips.id),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    requiresWaiver: boolean("requires_waiver").notNull().default(true),
    minimumCertificationLevel: certificationLevel("minimum_certification_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trip_requirements_shop_idx").on(table.shopId)],
);

export type Shop = typeof shops.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type WaiverRecord = typeof waiverRecords.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type TripRequirement = typeof tripRequirements.$inferSelect;
