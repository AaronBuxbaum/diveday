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
 * types — a person can be staff and a diver (docs/product/glossary.md).
 */

/** Selects which diver medical questionnaire a shop presents (src/lib/medical.ts). */
export const medicalJurisdiction = pgEnum("medical_jurisdiction", ["rstc", "uk"]);

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** IANA timezone of the physical shop — all schedule display uses this. */
  timezone: text("timezone").notNull(),
  /** Which medical questionnaire the shop's waivers use; RSTC is the default. */
  jurisdiction: medicalJurisdiction("jurisdiction").notNull().default("rstc"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MedicalJurisdiction = (typeof medicalJurisdiction.enumValues)[number];

export const personRole = pgEnum("person_role", [
  "owner",
  "manager",
  "instructor",
  "divemaster",
  "captain",
  "crew",
  "diver",
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
 * Activity-gating specialties that attach to a site or trip ("this wreck
 * requires AOW + Deep"). Each is a distinct yes/no gate, never a ladder rung,
 * so they live apart from the recreational-level rank map in readiness.ts.
 * Nitrox is deliberately absent: it is gated per-tank at fill time
 * (nitrox_certifications / nitrox_fills), not per-site.
 */
export const diveSpecialty = pgEnum("dive_specialty", ["deep", "wreck", "night", "drysuit"]);

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

/**
 * A reusable, shop-owned briefing for one dive site. Trip conditions are
 * intentionally kept on the dated trip: a site library entry is evergreen,
 * while water temperature and visibility are not.
 */
export const diveSites = pgTable(
  "dive_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    sourceTemplateId: uuid("source_template_id"),
    sourceTemplateVersion: integer("source_template_version"),
    name: text("name").notNull(),
    description: text("description"),
    locationName: text("location_name"),
    satelliteImageUrl: text("satellite_image_url"),
    routeImageUrl: text("route_image_url"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    marineLife: text("marine_life"),
    marineLifeDescription: text("marine_life_description"),
    difficulty: text("difficulty"),
    depthRange: text("depth_range"),
    currentNote: text("current_note"),
    divePlan: text("dive_plan"),
    landmarks: jsonb("landmarks").$type<string[]>().notNull().default([]),
    /**
     * The site's inherent cert gate, composed into every trip that visits it
     * (readiness.ts takes the stricter of site and trip). Null means the site
     * imposes no level of its own — never "unknown".
     */
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    /** Specialties the site itself demands; unioned with the trip's own list. */
    requiredSpecialties: jsonb("required_specialties")
      .$type<(typeof diveSpecialty.enumValues)[number][]>()
      .notNull()
      .default([]),
    /**
     * Whether the site demands a verified nitrox card to board. Evidence lives
     * in nitrox_certifications (also the fill-time gate), so this is its own
     * flag, not a member of required_specialties.
     */
    requiresNitrox: boolean("requires_nitrox").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dive_sites_shop_name_unique").on(table.shopId, table.name),
    index("dive_sites_shop_name_idx").on(table.shopId, table.name),
  ],
);

/** Scuba-maintained common-site catalog; shops copy a published version into their own library. */
export const globalDiveSites = pgTable(
  "global_dive_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    currentVersion: integer("current_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("global_dive_sites_slug_idx").on(table.slug)],
);

/** Immutable published snapshots; a later correction never rewrites a shop's source evidence. */
export const globalDiveSiteVersions = pgTable(
  "global_dive_site_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    globalDiveSiteId: uuid("global_dive_site_id")
      .notNull()
      .references(() => globalDiveSites.id),
    version: integer("version").notNull(),
    briefing: jsonb("briefing")
      .$type<{
        name: string;
        description?: string;
        locationName?: string;
        satelliteImageUrl?: string;
        routeImageUrl?: string;
        imageUrls?: string[];
        marineLife?: string;
        marineLifeDescription?: string;
        difficulty?: string;
        depthRange?: string;
        currentNote?: string;
        divePlan?: string;
        landmarks?: string[];
      }>()
      .notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("global_dive_site_versions_unique").on(table.globalDiveSiteId, table.version),
  ],
);

/** Visual, educational field-card content a shop can tailor after import. */
export const diveSiteCreatures = pgTable(
  "dive_site_creatures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    diveSiteId: uuid("dive_site_id")
      .notNull()
      .references(() => diveSites.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    imageUrl: text("image_url"),
    description: text("description"),
    preparationTip: text("preparation_tip"),
  },
  (table) => [index("dive_site_creatures_site_idx").on(table.diveSiteId)],
);

/** Staff-moderated, opt-in moments from prior divers. */
export const diveSiteMoments = pgTable(
  "dive_site_moments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    diveSiteId: uuid("dive_site_id")
      .notNull()
      .references(() => diveSites.id),
    caption: text("caption").notNull(),
    imageUrl: text("image_url"),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("dive_site_moments_site_published_idx").on(table.diveSiteId, table.isPublished),
  ],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** One primary site for the public briefing; multi-site itineraries are a later slice. */
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id),
    /** Present only for a scheduled course session; ordinary charters leave this empty. */
    courseId: uuid("course_id").references(() => courses.id),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    status: tripStatus("status").notNull().default("scheduled"),
    conditionsSummary: text("conditions_summary"),
    waterTemperatureC: integer("water_temperature_c"),
    visibilityMeters: integer("visibility_meters"),
    surfaceConditions: text("surface_conditions"),
    conditionsUpdatedAt: timestamp("conditions_updated_at", { withTimezone: true }),
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
    buddyPreference: text("buddy_preference"),
    conditionsBriefedAt: timestamp("conditions_briefed_at", { withTimezone: true }),
    status: bookingStatus("status").notNull().default("booked"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_trip_person_unique").on(table.tripId, table.personId),
    index("bookings_trip_idx").on(table.tripId),
  ],
);

/** Latest outbound-email state per booking and notification purpose. */
export const notificationKind = pgEnum("notification_kind", [
  "booking_confirmation",
  "waiver_request",
]);

export const notificationDeliveryStatus = pgEnum("notification_delivery_status", [
  "sent",
  "failed",
  "not_configured",
]);

/**
 * A current operational status, not an append-only provider log. One row per
 * booking/purpose means a newly emailed waiver link replaces its prior state.
 */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    kind: notificationKind("kind").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("notification_deliveries_booking_kind_unique").on(table.bookingId, table.kind),
    index("notification_deliveries_shop_status_attempted_idx").on(
      table.shopId,
      table.status,
      table.attemptedAt,
    ),
  ],
);

/**
 * Append-only history of every send attempt — the durable record behind the
 * denormalized latest state in notification_deliveries. A retry adds a row
 * here; nothing is ever updated, so the full delivery trail survives.
 */
export const notificationDeliveryAttempts = pgTable(
  "notification_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    kind: notificationKind("kind").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    /** True when a staff member re-triggered the send from the dashboard. */
    isRetry: boolean("is_retry").notNull().default(false),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_delivery_attempts_booking_kind_idx").on(table.bookingId, table.kind),
    index("notification_delivery_attempts_shop_attempted_idx").on(table.shopId, table.attemptedAt),
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

/**
 * A completed diver medical questionnaire. Stores the questionnaire id and
 * version it was answered against (src/lib/medical.ts) so signed evidence is
 * never re-interpreted by a later edit to the question set; `responses` maps
 * each question id to the diver's yes(true)/no(false) answer.
 */
export type MedicalAnswers = {
  questionnaireId: string;
  questionnaireVersion: number;
  responses: Record<string, boolean>;
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

/**
 * A diver's specialty card (Deep, Wreck, Night, Drysuit). Structurally the
 * same capture→verify evidence as `certifications`, but carries a `specialty`
 * rather than a ladder `level`: a specialty is a yes/no gate, so it is checked
 * by kind, never by rank. Kept apart from the level ladder for the same reason
 * nitrox is (readiness.ts). Only a verified card can clear a specialty gate.
 */
export const specialtyCertifications = pgTable(
  "specialty_certifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    agency: certificationAgency("agency").notNull(),
    specialty: diveSpecialty("specialty").notNull(),
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
    index("specialty_certifications_shop_person_idx").on(table.shopId, table.personId),
    uniqueIndex("specialty_certifications_shop_agency_identifier_unique").on(
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
    /**
     * Trip-specific specialty gates on top of whatever the dive site demands.
     * The readiness service unions this with the site's requiredSpecialties.
     */
    requiredSpecialties: jsonb("required_specialties")
      .$type<(typeof diveSpecialty.enumValues)[number][]>()
      .notNull()
      .default([]),
    /** Trip-level nitrox gate; OR'd with the site's requiresNitrox. */
    requiresNitrox: boolean("requires_nitrox").notNull().default(false),
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
 * Reusable fit details for one diver at one shop. This is a planning aid, not
 * an equipment reservation or a substitute for a dock-side fit check.
 */
export const rentalGearProfiles = pgTable(
  "rental_gear_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    bcdSize: text("bcd_size"),
    wetsuitSize: text("wetsuit_size"),
    bootSize: text("boot_size"),
    finSize: text("fin_size"),
    weightPreference: text("weight_preference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rental_gear_profiles_shop_person_unique").on(table.shopId, table.personId),
    index("rental_gear_profiles_shop_person_idx").on(table.shopId, table.personId),
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
export type NotificationDeliveryRecord = typeof notificationDeliveries.$inferSelect;
export type NotificationDeliveryAttempt = typeof notificationDeliveryAttempts.$inferSelect;
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type WaiverRecord = typeof waiverRecords.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type SpecialtyCertification = typeof specialtyCertifications.$inferSelect;
export type DiveSpecialty = (typeof diveSpecialty.enumValues)[number];
export type DiveSite = typeof diveSites.$inferSelect;
export type TripRequirement = typeof tripRequirements.$inferSelect;
export type GearItem = typeof gearItems.$inferSelect;
export type GearAssignment = typeof gearAssignments.$inferSelect;
export type RentalGearRequest = typeof rentalGearRequests.$inferSelect;
export type RentalGearProfile = typeof rentalGearProfiles.$inferSelect;
export type GearServiceEvent = typeof gearServiceEvents.$inferSelect;
export type RollCallEvent = typeof rollCallEvents.$inferSelect;
export type NitroxCertification = typeof nitroxCertifications.$inferSelect;
export type NitroxFill = typeof nitroxFills.$inferSelect;
