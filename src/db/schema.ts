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

/**
 * Course definitions are the reusable instruction catalog. A course session
 * remains a trip so enrollment, capacity, crew, waivers, gear, and manifests
 * all share one operational spine.
 */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    description: text("description"),
    /** Null means an uncertified participant may enroll (for example, DSD/OW). */
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    /** A course session cannot take enrollments until an instructor is assigned. */
    requiresInstructor: boolean("requires_instructor").notNull().default(true),
    requiresWaiver: boolean("requires_waiver").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_shop_title_unique").on(table.shopId, table.title),
    index("courses_shop_active_idx").on(table.shopId, table.isActive),
  ],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Present only for a scheduled course session; ordinary charters leave this empty. */
    courseId: uuid("course_id").references(() => courses.id),
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
    /** Null deliberately means no existing C-card is required, never unknown. */
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trip_requirements_shop_idx").on(table.shopId)],
);

export const gearType = pgEnum("gear_type", [
  "bcd",
  "regulator",
  "wetsuit",
  "mask_fins",
  "weights",
  "tank",
]);

/** Service holds are a safety state, not a staff-facing warning that can be bypassed. */
export const gearState = pgEnum("gear_state", ["available", "assigned", "service_hold", "retired"]);

export const gearItems = pgTable(
  "gear_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    label: text("label").notNull(),
    type: gearType("type").notNull(),
    size: text("size"),
    state: gearState("state").notNull().default("available"),
    serviceDueAt: timestamp("service_due_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gear_items_shop_label_unique").on(table.shopId, table.label),
    index("gear_items_shop_type_state_idx").on(table.shopId, table.type, table.state),
  ],
);

export const gearAssignmentStatus = pgEnum("gear_assignment_status", ["assigned", "returned"]);

/** Immutable-ish operational history: only return timestamps/status are updated after assignment. */
export const gearAssignments = pgTable(
  "gear_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    gearItemId: uuid("gear_item_id")
      .notNull()
      .references(() => gearItems.id),
    status: gearAssignmentStatus("status").notNull().default("assigned"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
  },
  (table) => [
    index("gear_assignments_booking_status_idx").on(table.bookingId, table.status),
    index("gear_assignments_gear_status_idx").on(table.gearItemId, table.status),
  ],
);

/**
 * A diver's requested rental set for one booking. It is a planning input, not
 * an allocation: staff still chooses real, available inventory through
 * gear_assignments and confirms fit/weight at check-in.
 */
export const rentalGearRequests = pgTable(
  "rental_gear_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    bcd: boolean("bcd").notNull().default(true),
    regulator: boolean("regulator").notNull().default(true),
    wetsuit: boolean("wetsuit").notNull().default(true),
    maskFins: boolean("mask_fins").notNull().default(true),
    weights: boolean("weights").notNull().default(true),
    tank: boolean("tank").notNull().default(true),
    diveComputer: boolean("dive_computer").notNull().default(false),
    bcdSize: text("bcd_size"),
    wetsuitSize: text("wetsuit_size"),
    bootSize: text("boot_size"),
    finSize: text("fin_size"),
    weightPreference: text("weight_preference"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rental_gear_requests_booking_unique").on(table.bookingId),
    index("rental_gear_requests_shop_booking_idx").on(table.shopId, table.bookingId),
  ],
);

/**
 * A completed service event is durable operational history. It is distinct
 * from an item being on service hold: a hold prevents checkout; an event
 * records work that was actually completed and who released the item.
 */
export const gearServiceEvents = pgTable(
  "gear_service_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    gearItemId: uuid("gear_item_id")
      .notNull()
      .references(() => gearItems.id),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    serviceCompletedAt: timestamp("service_completed_at", { withTimezone: true }).notNull(),
    nextServiceDueAt: timestamp("next_service_due_at", { withTimezone: true }),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gear_service_events_shop_item_completed_idx").on(
      table.shopId,
      table.gearItemId,
      table.serviceCompletedAt,
    ),
  ],
);

/**
 * A nitrox (EANx) specialty card. Modeled separately from `certifications`
 * because that table is the recreational ladder (its `level` enum feeds the
 * readiness rank map); a specialty is a distinct yes/no gate, not a ladder
 * rung. Same capture→verify workflow: evidence starts pending and only a
 * verified card lets a diver receive an enriched-air fill.
 */
export const nitroxCertifications = pgTable(
  "nitrox_certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    agency: certificationAgency("agency").notNull(),
    identifier: text("identifier").notNull(),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("nitrox_certifications_shop_person_idx").on(table.shopId, table.personId),
    uniqueIndex("nitrox_certifications_shop_agency_identifier_unique").on(
      table.shopId,
      table.agency,
      table.identifier,
    ),
  ],
);

/**
 * A logged enriched-air fill for one diver's tank. Safety evidence: the diver
 * analyzed the mix and signed for it, the mix is within recreational EANx
 * limits, and — enforced at write time — the diver holds a verified nitrox
 * card. `maxDepthMeters` is the derived MOD at the stored ppO2 limit; a fill
 * is an append-only record, never mutated after logging.
 */
export const nitroxFills = pgTable(
  "nitrox_fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    gearItemId: uuid("gear_item_id")
      .notNull()
      .references(() => gearItems.id),
    /** Whole-percent O2 fraction of the enriched-air mix (e.g. 32 for EAN32). */
    oxygenPercent: integer("oxygen_percent").notNull(),
    /** Max operating depth in metres, derived from the mix and the ppO2 limit. */
    maxDepthMeters: integer("max_depth_meters").notNull(),
    /** ppO2 ceiling used for the MOD, in hundredths of a bar (140 = 1.4 bar). */
    maxPpO2Centibar: integer("max_ppo2_centibar").notNull(),
    /** The diver's typed confirmation that they personally analyzed the tank. */
    analyzerSignature: text("analyzer_signature").notNull(),
    filledByPersonId: uuid("filled_by_person_id")
      .notNull()
      .references(() => people.id),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("nitrox_fills_shop_booking_idx").on(table.shopId, table.bookingId),
    index("nitrox_fills_shop_gear_idx").on(table.shopId, table.gearItemId),
  ],
);

export const rollCallStatus = pgEnum("roll_call_status", ["boarded", "not_boarded"]);

/**
 * Append-only safety history. Absence means a diver is still awaiting roll
 * call; the newest event answers their current boarding state without
 * rewriting what staff recorded earlier.
 */
export const rollCallEvents = pgTable(
  "roll_call_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    status: rollCallStatus("status").notNull(),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("roll_call_events_shop_trip_booking_created_idx").on(
      table.shopId,
      table.tripId,
      table.bookingId,
      table.createdAt,
    ),
  ],
);

export type Shop = typeof shops.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type WaiverRecord = typeof waiverRecords.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type TripRequirement = typeof tripRequirements.$inferSelect;
export type GearItem = typeof gearItems.$inferSelect;
export type GearAssignment = typeof gearAssignments.$inferSelect;
export type RentalGearRequest = typeof rentalGearRequests.$inferSelect;
export type GearServiceEvent = typeof gearServiceEvents.$inferSelect;
export type RollCallEvent = typeof rollCallEvents.$inferSelect;
export type NitroxCertification = typeof nitroxCertifications.$inferSelect;
export type NitroxFill = typeof nitroxFills.$inferSelect;
