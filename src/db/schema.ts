import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
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
import type { CourseFaq, CourseScheduleDay } from "@/lib/courses";
import type { Notification } from "@/lib/notifications";
import { DEFAULT_SHOP_RENTAL_ITEMS, type RentalPricing } from "@/lib/rentals";

/**
 * The domain spine. Multi-tenant from day one: every domain table carries
 * shop_id (ADR-0005, docs/architecture/overview.md). People get roles, not
 * types — a person can be staff and a diver (docs/product/glossary.md).
 */

/** Selects which diver medical questionnaire a shop presents (src/lib/medical.ts). */
export const medicalJurisdiction = pgEnum("medical_jurisdiction", ["rstc", "uk"]);

/** How a shop reads depth. Storage stays metres either way (src/lib/depth-units.ts). */
export const depthUnit = pgEnum("depth_unit", ["meters", "feet"]);

export const shops = pgTable(
  "shops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    /** IANA timezone of the physical shop — all schedule display uses this. */
    timezone: text("timezone").notNull(),
    /** BCP 47 locale for public and capability-page copy/formatting. */
    defaultLocale: text("default_locale").notNull().default("en-US"),
    /** Which medical questionnaire the shop's waivers use; RSTC is the default. */
    jurisdiction: medicalJurisdiction("jurisdiction").notNull().default("rstc"),
    /**
     * Whether this shop reads depths in metres or feet. Display and entry only —
     * `dive_sites.max_depth_meters` is always canonical metres, so switching the
     * unit reinterprets nothing and no stored number ever moves. Metres is the
     * default because the agency standards DiveDay encodes are stated in metres
     * (20260724-course-admission-standards); a US shop flips it once in settings.
     */
    depthUnit: depthUnit("depth_unit").notNull().default("meters"),
    /**
     * Where a diver who is not booking yet should write. Published on public
     * pages, so it is the shop's front-desk address rather than an owner's
     * personal one — nullable because a shop that has not chosen one must not
     * have a member of staff's address guessed on its behalf.
     */
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    /**
     * Where a post-trip review request sends a diver — a Google Business,
     * TripAdvisor, or Facebook review page the shop pastes in. Nullable: with
     * none set, the recap flow has nowhere to send a diver and skips the ask
     * entirely rather than guessing a platform (docs ADR
     * 20260726-post-trip-review-request).
     */
    reviewUrl: text("review_url"),
    /** Diver-facing suggestions shown on every trip; owners configure these once per shop. */
    packingList: jsonb("packing_list")
      .$type<string[]>()
      .notNull()
      .default(["Swimsuit and towel", "Reef-safe sun protection", "Logbook"]),
    /**
     * The gear and services this shop offers (ShopCatalogKind values,
     * src/lib/rentals.ts). Gates which items a diver can pick in the rental-fit
     * forms — a shop that doesn't rent GoPros never offers one — and, for
     * "nitrox", whether a diver can request enriched air at all
     * (shopOffersNitrox). Defaults to the core kit (which now includes the dive
     * computer); the GoPro and nitrox are opt-in — most shops don't fill nitrox.
     * Single-sourced from DEFAULT_SHOP_RENTAL_ITEMS so the stored default can
     * never drift from the canonical kit again.
     */
    rentalItems: jsonb("rental_items")
      .$type<string[]>()
      .notNull()
      .default([...DEFAULT_SHOP_RENTAL_ITEMS]),
    /**
     * What the shop charges for rental gear (minor units), src/lib/rentals.ts. A
     * set price for the full core kit, per-piece prices, and a per-dive nitrox
     * surcharge — all optional. Never inventory or an allocation, only what a diver
     * is quoted. Defaults to unpriced, which keeps the "ask the shop" behaviour.
     */
    rentalPricing: jsonb("rental_pricing")
      .$type<RentalPricing>()
      .notNull()
      .default({ setCents: null, perItemCents: {}, nitroxCents: null }),
    /**
     * How many minutes before departure divers are asked to be at the dock. The
     * shop's real muster time varies (gear setup, cert check, briefing), so it is
     * configurable rather than a hardcoded "30 minutes" in every confirmation and
     * reminder. Defaults to 30.
     */
    dockCallMinutes: integer("dock_call_minutes").notNull().default(30),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("shops_dock_call_minutes_nonnegative", sql`${table.dockCallMinutes} >= 0`)],
);

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
    /**
     * Date-only, no timezone (CR-009): a birthday is a calendar fact, not an
     * instant. Nullable and **fails open** by product decision (H-08, option B):
     * a course's `minimum_age` is enforced only for a diver who actually has a
     * date on file, so shipping this never blocks the divers already on the
     * books. Real age verification stays a dock-side ID check; this catches the
     * mis-aged booking early when the data happens to be there.
     */
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    /**
     * Dive-accident insurance the diver carries — DAN or another provider, as
     * free text ("DAN #12345"). A safety detail the crew wants on hand in an
     * incident, never a gate; null until the diver or staff records it
     * (docs/product/glossary.md — "DAN").
     */
    diveInsurance: text("dive_insurance"),
    /** Keeps history intact while removing a person from active shop workspaces. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("people_shop_idx").on(table.shopId),
    // Case-insensitive so "Nora@x.com" and "nora@x.com" can never split one
    // diver's cert/waiver/rental history into two rows (CR-008). Partial on
    // the live rows only, matching the archive-not-delete pattern elsewhere:
    // a soft-deleted person's email frees up for a genuinely new person, and
    // an undelete that would collide with an active row is refused
    // (src/db/people.ts — findOrCreatePerson, restoreDiver-style callers).
    uniqueIndex("people_shop_email_unique")
      .on(table.shopId, sql`lower(${table.email})`)
      .where(sql`${table.deletedAt} is null and ${table.email} is not null`),
    // Backs the command-palette/diver-roster leading-wildcard ILIKE search
    // (src/db/search.ts, src/db/divers.ts) — a plain btree can't serve
    // `ilike '%query%'`, only pg_trgm's GIN similarity index can (CR-018).
    index("people_full_name_trgm_idx").using("gin", sql`${table.fullName} gin_trgm_ops`),
    index("people_email_trgm_idx").using("gin", sql`${table.email} gin_trgm_ops`),
    index("people_phone_trgm_idx").using("gin", sql`${table.phone} gin_trgm_ops`),
  ],
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

/**
 * How a trip series repeats. Only weekly today (the shop's "every Saturday
 * two-tank"); the enum exists so a later monthly or daily cadence is an additive
 * migration, not a reshape. See 20260719-recurring-trip-series.
 */
export const tripRecurrenceFrequency = pgEnum("trip_recurrence_frequency", ["weekly"]);

/**
 * The template + cadence behind a set of repeating trips. A series does not run
 * on the boat — its instances do. Each instance is a real, independent `trips`
 * row (see `trips.series_id`) so bookings, manifests, waivers, and roll
 * call all use the one operational spine and an owner can edit or cancel a
 * single date without touching the rest. The series row is provenance and the
 * cadence description, not a live scheduler: instances are materialized once at
 * creation (docs/architecture/decisions/20260719-recurring-trip-series.md).
 */
export const tripSeries = pgTable(
  "trip_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    frequency: tripRecurrenceFrequency("frequency").notNull().default("weekly"),
    /** Weeks between instances: 1 for weekly, 2 for every other week, etc. */
    intervalWeeks: integer("interval_weeks").notNull().default(1),
    /**
     * How many instances the series has materialized — set at creation and
     * bumped when the horizon is rolled forward (see `extendTripSeries`). Drives
     * the staff-facing "Repeats weekly · N trips" summary.
     */
    occurrenceCount: integer("occurrence_count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trip_series_shop_idx").on(table.shopId)],
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

export const certificationStatus = pgEnum("certification_status", ["pending", "verified"]);

/**
 * Activity-gating specialties that attach to a site or trip ("this wreck
 * requires AOW + Deep"). Each is a distinct yes/no gate, never a ladder rung,
 * so they live apart from the recreational-level rank map in readiness.ts.
 * Nitrox is deliberately absent: nitrox_certifications gates the per-booking
 * mix request, not a site.
 */
export const diveSpecialty = pgEnum("dive_specialty", ["deep", "wreck", "night", "drysuit"]);

/**
 * Course definitions are the reusable instruction catalog. A course session
 * remains a trip so enrollment, capacity, crew, waivers, and manifests
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
    agency: text("agency").notNull().default("padi"),
    /** Short internal blurb shown in staff lists and pickers; not the marketing copy. */
    description: text("description"),
    /**
     * URL segment for the public course page. Shop-scoped rather than global so
     * two shops can both publish /courses/open-water-diver.
     */
    slug: text("slug").notNull(),
    /**
     * The diver-facing page. These fields only ever render — the operational
     * course facts (prices, cert gate, isActive) stay above. Shapes and parsers
     * live in src/lib/courses.ts.
     */
    summary: text("summary"),
    overview: text("overview"),
    heroImageUrl: text("hero_image_url"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    durationText: text("duration_text"),
    groupSizeText: text("group_size_text"),
    minimumAge: integer("minimum_age"),
    /** Prose beside the `minimum_certification_level` gate, never a substitute for it. */
    prerequisiteNote: text("prerequisite_note"),
    includes: jsonb("includes").$type<string[]>().notNull().default([]),
    excludes: jsonb("excludes").$type<string[]>().notNull().default([]),
    scheduleDays: jsonb("schedule_days").$type<CourseScheduleDay[]>().notNull().default([]),
    faqs: jsonb("faqs").$type<CourseFaq[]>().notNull().default([]),
    /**
     * Two additive amounts, not a price and a bundle total: an enrollment
     * invoices as `price_cents` + `e_learning_price_cents` on one bill, so
     * either line can be cleared or refunded on its own (a student who already
     * did the e-learning). See src/lib/courses.ts.
     */
    priceCents: integer("price_cents"),
    eLearningPriceCents: integer("e_learning_price_cents"),
    /**
     * Set by the certifying agency, not the shop: null means an uncertified
     * participant may enroll (for example, DSD/OW). Staff read it; nothing in
     * the app offers to edit it.
     */
    minimumCertificationLevel: certificationLevel("minimum_certification_level"),
    /**
     * The one visibility switch: hides the course from the session picker and
     * takes its public page down. There is no separate draft/publish state —
     * a course is either offered, or it is hidden.
     */
    isActive: boolean("is_active").notNull().default(true),
    /**
     * A no-certification-required taster session (Discover Scuba Diving, Try
     * Scuba, …), set by staff on the course editor rather than sniffed from
     * the title at render time — the booking page's "great gift" nudge reads
     * this instead of pattern-matching English words that would silently
     * miss a differently-worded or translated course title.
     */
    isIntroCourse: boolean("is_intro_course").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("courses_shop_title_unique").on(table.shopId, table.title),
    uniqueIndex("courses_shop_slug_unique").on(table.shopId, table.slug),
    index("courses_shop_active_idx").on(table.shopId, table.isActive),
  ],
);

/**
 * An ordered progression through the shop's own catalog — "Open Water →
 * Advanced → Rescue", "Wreck specialist", "From zero to Divemaster".
 *
 * A path is guidance, never a gate: admission to any single course is still
 * decided by that course's `minimum_certification_level`, and nothing here
 * grants or withholds a seat. What the path adds is the shop's own answer to
 * "what should I do next?", which the app previously guessed by string-matching
 * a course title for "advanced open water".
 */
export const coursePaths = pgTable(
  "course_paths",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    title: text("title").notNull(),
    /** URL segment under /courses/paths/, shop-scoped like `courses.slug`. */
    slug: text("slug").notNull(),
    /** One diver-facing line under the title; the courses carry the detail. */
    summary: text("summary"),
    /** Same single switch as a course: offered, or hidden from divers. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("course_paths_shop_title_unique").on(table.shopId, table.title),
    uniqueIndex("course_paths_shop_slug_unique").on(table.shopId, table.slug),
    index("course_paths_shop_active_idx").on(table.shopId, table.isActive),
  ],
);

/**
 * One rung of a path, pointing at a course in the same shop's catalog.
 *
 * `position` is dense and 0-based, and the whole step list is rewritten as a
 * unit on every save (src/db/course-paths.ts) — reordering a path is not a
 * sequence of per-row swaps that could leave a gap or a duplicate behind.
 * Both unique indexes hold because that rewrite happens inside one transaction.
 */
export const coursePathSteps = pgTable(
  "course_path_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => coursePaths.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** Why this rung, in the shop's words — "most divers wait a season here". */
    note: text("note"),
  },
  (table) => [
    uniqueIndex("course_path_steps_path_position_unique").on(table.pathId, table.position),
    uniqueIndex("course_path_steps_path_course_unique").on(table.pathId, table.courseId),
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
    /** Offshore coordinate selected by staff for the automated marine forecast. */
    forecastLatitude: doublePrecision("forecast_latitude"),
    forecastLongitude: doublePrecision("forecast_longitude"),
    satelliteImageUrl: text("satellite_image_url"),
    routeImageUrl: text("route_image_url"),
    imageUrls: jsonb("image_urls").$type<string[]>().notNull().default([]),
    marineLife: text("marine_life"),
    marineLifeDescription: text("marine_life_description"),
    difficulty: text("difficulty"),
    /**
     * Free-text prose for the briefing ("6–12 m", "shallow ledge to 18"). Kept
     * alongside `max_depth_meters` rather than replaced by it: it carries shape
     * and nuance a single number can't, and it is what the diver-facing site
     * card has always shown.
     */
    depthRange: text("depth_range"),
    /**
     * The site's deepest point, in metres — the one number a certification
     * ceiling can actually be compared against (H-08). Null means the shop
     * hasn't recorded one, and a null never produces a warning: this field
     * *advises*, it is not a gate, so an absent depth degrades to silence
     * rather than to a refusal.
     *
     * Always metres regardless of the shop's `depth_unit`, and floating-point
     * rather than integer for exactly that reason: a shop working in feet types
     * 60, which is 18.288 m, and must read 60 back — not the 59 an integer
     * metre would round it to.
     */
    maxDepthMeters: doublePrecision("max_depth_meters"),
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
     * in nitrox_certifications (also the mix-request gate), so this is its own
     * flag, not a member of required_specialties.
     */
    requiresNitrox: boolean("requires_nitrox").notNull().default(false),
    /** Archived briefings remain attached to historical trips but leave active pickers. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dive_sites_shop_name_unique").on(table.shopId, table.name),
    index("dive_sites_shop_name_idx").on(table.shopId, table.name),
    // Backs the command-palette leading-wildcard ILIKE search (src/db/search.ts, CR-018).
    index("dive_sites_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

/** DiveDay-maintained common-site catalog; shops copy a published version into their own library. */
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
        forecastLatitude?: number;
        forecastLongitude?: number;
        satelliteImageUrl?: string;
        routeImageUrl?: string;
        imageUrls?: string[];
        marineLife?: string;
        marineLifeDescription?: string;
        difficulty?: string;
        depthRange?: string;
        maxDepthMeters?: number;
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
    /**
     * Set when this trip was materialized from a recurring series; null for a
     * one-off charter. The instance stays fully editable on its own — the
     * pointer is provenance, never a live link that rewrites this row.
     */
    seriesId: uuid("series_id").references(() => tripSeries.id),
    /** Compatibility pointer to the first dive's site for readiness and forecast consumers. */
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id),
    /** Present only for a scheduled course session; ordinary charters leave this empty. */
    courseId: uuid("course_id").references(() => courses.id),
    title: text("title").notNull(),
    description: text("description"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    /** Drives the after-dive roll-call checkpoints; recreational charters are commonly two-tank. */
    plannedDives: integer("planned_dives").notNull().default(2),
    /** Per-diver price; null means unpriced — an order made from this trip needs a manual amount. */
    priceCents: integer("price_cents"),
    /**
     * Optional per-diver deposit taken at pay-at-booking checkout, in minor
     * units. Null (the default) charges the full fare, exactly as before. A
     * value below the per-diver price charges that much now and marks the
     * booking `deposit_paid` with the balance still due; a value at or above the
     * fare is treated as no deposit (charge full) rather than a bad request
     * (src/lib/deposits.ts). Provisional H-07 policy — off unless a shop opts in.
     */
    depositCents: integer("deposit_cents"),
    /**
     * Optional free-cancellation window, in hours before departure. Declarative
     * only: shown to divers at booking and surfaced to staff as a
     * "refund-eligible until" cue. Refunds stay staff-initiated — no automated
     * money movement in this slice. Null means the shop states no window (H-07).
     */
    cancellationWindowHours: integer("cancellation_window_hours"),
    status: tripStatus("status").notNull().default("scheduled"),
    /** Crew weather/conditions caution: the trip remains visible, but bookings pause for a final call. */
    conditionsHold: boolean("conditions_hold").notNull().default(false),
    conditionsSummary: text("conditions_summary"),
    waterTemperatureC: integer("water_temperature_c"),
    visibilityMeters: integer("visibility_meters"),
    surfaceConditions: text("surface_conditions"),
    conditionsUpdatedAt: timestamp("conditions_updated_at", { withTimezone: true }),
    /**
     * A short crew-authored note that rides along on every diver's post-trip
     * recap for this date ("Killer vis today — thanks for diving with us!").
     * Diver-facing and post-trip, distinct from the pre-trip conditions
     * briefing; null until the crew writes one
     * (20260723-post-trip-recap follow-up).
     */
    recapShoutout: text("recap_shoutout"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trips_shop_starts_idx").on(table.shopId, table.startsAt),
    index("trips_series_starts_idx").on(table.seriesId, table.startsAt),
    // Backs the command-palette leading-wildcard ILIKE search (src/db/search.ts, CR-018).
    index("trips_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    check("trips_capacity_range", sql`${table.capacity} between 1 and 60`),
    check("trips_planned_dives_range", sql`${table.plannedDives} between 1 and 4`),
    check("trips_price_nonnegative", sql`${table.priceCents} is null or ${table.priceCents} >= 0`),
    check(
      "trips_deposit_nonnegative",
      sql`${table.depositCents} is null or ${table.depositCents} >= 0`,
    ),
    check(
      "trips_cancellation_window_nonnegative",
      sql`${table.cancellationWindowHours} is null or ${table.cancellationWindowHours} >= 0`,
    ),
    check("trips_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

/** One real meeting window for a course or other multi-day session. */
export const tripScheduleDays = pgTable(
  "trip_schedule_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("trip_schedule_days_trip_day_unique").on(table.tripId, table.dayNumber),
    index("trip_schedule_days_trip_starts_idx").on(table.tripId, table.startsAt),
    check("trip_schedule_days_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

/**
 * Optional, ordered briefings within a trip. The trip owns the shared
 * schedule, price, conditions, and description; these rows only add detail
 * when a shop has it. A blank row is intentional — "2 tank dive" is a useful
 * published plan even when the crew has not chosen the individual sites yet.
 */
export const tripDives = pgTable(
  "trip_dives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    diveNumber: integer("dive_number").notNull(),
    title: text("title"),
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_dives_trip_number_unique").on(table.tripId, table.diveNumber),
    index("trip_dives_trip_idx").on(table.tripId, table.diveNumber),
  ],
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
    /**
     * The diver asked for enriched air on this trip — billed per dive. Only
     * written for a diver with a verified nitrox card (src/db/nitrox.ts); the
     * prep checklist re-checks the card so a later revocation downgrades the
     * booking to air rather than silently trusting this flag.
     */
    wantsNitrox: boolean("wants_nitrox").notNull().default(false),
    conditionsBriefedAt: timestamp("conditions_briefed_at", { withTimezone: true }),
    /** Optional, non-sensitive pace/interest note the diver shares for buddy grouping. */
    groupPreference: text("group_preference"),
    status: bookingStatus("status").notNull().default("booked"),
    /**
     * Set for the duration of one in-flight checkout attempt covering this
     * booking (`payment_operation_intents.id`), cleared once that attempt
     * resolves either way. A second concurrent `startBookingCheckout` call
     * for the same booking can claim it only while this is null, so two
     * racing attempts can never both mint a Stripe Checkout session for the
     * same seat (CR-005) — see src/db/checkouts.ts. Not a typed FK: that
     * reference is mutual with `payment_operation_intents.booking_id`, and
     * drizzle can't type two tables that reference each other's primary key.
     */
    pendingCheckoutIntentId: uuid("pending_checkout_intent_id"),
    /**
     * Set when a self-service path (public booking) reused an existing person by
     * email match but the submitted name did not match that person's stored name
     * — a shared-inbox / minor-under-a-parent's-email signal that this booking
     * may be a *different* human silently inheriting the matched person's
     * verified certs and current waiver (H-13). While set, readiness fails closed
     * with an `identity_unconfirmed` blocker so the diver can never board on
     * borrowed evidence; staff clear it with a one-tap "confirm identity" once
     * they've checked it really is the same person. Null on the identity path
     * (an existing diver re-books themselves — no name is submitted) and on any
     * matched-name booking.
     */
    identityUnconfirmedAt: timestamp("identity_unconfirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_trip_person_unique").on(table.tripId, table.personId),
    index("bookings_trip_idx").on(table.tripId),
  ],
);

/** Staff-only context attached to a diver or one specific booking. */
export const internalNotes = pgTable(
  "internal_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("internal_notes_shop_person_idx").on(table.shopId, table.personId, table.createdAt),
    index("internal_notes_booking_idx").on(table.bookingId, table.createdAt),
    check("internal_notes_body_not_blank", sql`length(trim(${table.body})) > 0`),
  ],
);

/** Append-only, staff-facing account of operational work in human language. */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => people.id),
    message: text("message").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("activity_events_shop_trip_idx").on(table.shopId, table.tripId, table.occurredAt),
    check("activity_events_message_not_blank", sql`length(trim(${table.message})) > 0`),
  ],
);

/**
 * A diver's place in line for a full trip. It is deliberately separate from
 * bookings: a wait-list entry never consumes capacity or appears on a manifest.
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // When staff last invited this diver to grab a freed seat. Null until the
    // first invite; shown as "Invited 2h ago" so two staff don't double-invite.
    invitedAt: timestamp("invited_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("trip_waitlist_entries_trip_person_unique").on(table.tripId, table.personId),
    index("trip_waitlist_entries_trip_created_idx").on(table.tripId, table.createdAt),
    index("trip_waitlist_entries_shop_trip_idx").on(table.shopId, table.tripId),
  ],
);

/**
 * A diver opted in, shop-wide, to hear about last-minute deals — deliberately
 * separate from `tripWaitlistEntries` (per-trip interest in a *full* charter).
 * `availableFrom`/`availableUntil` are the date range the diver said they're
 * around; either side null means no bound on that side. See docs ADR
 * 20260727-last-minute-fill-promos.
 */
export const lastMinuteListEntries = pgTable(
  "last_minute_list_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    availableFrom: date("available_from", { mode: "string" }),
    availableUntil: date("available_until", { mode: "string" }),
    /** Null while active; set once the diver unsubscribes, so a blast never emails them again. */
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("last_minute_list_entries_shop_person_unique").on(table.shopId, table.personId),
    index("last_minute_list_entries_shop_active_idx")
      .on(table.shopId)
      .where(sql`${table.unsubscribedAt} is null`),
    check(
      "last_minute_list_entries_range",
      sql`${table.availableFrom} is null or ${table.availableUntil} is null or ${table.availableFrom} <= ${table.availableUntil}`,
    ),
  ],
);

export const tripLastMinutePromoStatus = pgEnum("trip_last_minute_promo_status", [
  "pending",
  "sent",
  "failed",
]);

/**
 * One staff-triggered last-minute-deal blast on one trip: the Stripe coupon +
 * promotion code it minted, and how many last-minute-list divers it went to.
 * The row is inserted `pending` before either Stripe call so a crash mid-send
 * leaves durable evidence to reconcile, mirroring `startBookingCheckout`'s
 * insert-before-external-call shape (docs ADR 20260727-last-minute-fill-promos).
 * Multiple rows per trip are expected — staff may re-send at a steeper
 * discount as departure nears.
 */
export const tripLastMinutePromos = pgTable(
  "trip_last_minute_promos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    status: tripLastMinutePromoStatus("status").notNull().default("pending"),
    discountPercent: integer("discount_percent").notNull(),
    /** The human-typed code, e.g. "SAVE50-A1B2C3" — unique per shop's Stripe account. */
    code: text("code").notNull(),
    stripeCouponId: text("stripe_coupon_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    /** Pinned to the trip's departure at creation; a later reschedule does not move it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** How many last-minute-list entries the blast email actually went to. */
    recipientCount: integer("recipient_count").notNull().default(0),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_last_minute_promos_trip_created_idx").on(table.tripId, table.createdAt),
    uniqueIndex("trip_last_minute_promos_shop_code_unique").on(table.shopId, table.code),
    check("trip_last_minute_promos_discount_range", sql`${table.discountPercent} between 5 and 90`),
  ],
);

/** What a shop-wide promo code may be spent on; `all` is both. */
export const shopPromoScope = pgEnum("shop_promo_scope", ["all", "trips", "courses"]);

export const shopPromoStatus = pgEnum("shop_promo_status", [
  "pending",
  "active",
  "disabled",
  "failed",
]);

/**
 * A shop-wide, staff-authored discount code — the general promotion model
 * `tripLastMinutePromos` deliberately was not (docs ADR
 * 20260727-last-minute-fill-promos left it "one narrow producer of Stripe
 * promotion codes, not the thing it replaces"). Same Stripe-native mechanism:
 * DiveDay mints a Coupon + PromotionCode on the shop's own connected account
 * and hands the resolved `promo_...` id to Checkout explicitly, so Stripe
 * independently enforces expiry and redemption caps while the local row keeps
 * the scope/window the shop actually configured. Inserted `pending` before
 * either Stripe call, exactly like a last-minute blast, so a crash mid-create
 * leaves evidence rather than nothing (docs ADR 20260729-shop-promo-codes).
 */
export const shopPromoCodes = pgTable(
  "shop_promo_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Normalized upper-case (`normalizePromoCode`, src/lib/promo-codes.ts) — what a diver types. */
    code: text("code").notNull(),
    /** Staff's own note about what this code is for; never shown to a diver. */
    description: text("description"),
    discountPercent: integer("discount_percent").notNull(),
    scope: shopPromoScope("scope").notNull().default("all"),
    status: shopPromoStatus("status").notNull().default("pending"),
    /** Null means "live now"; null `expiresAt` means the shop set no end date. */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Null is unlimited. Stripe enforces the cap at checkout; this is the shop's stated intent. */
    maxRedemptions: integer("max_redemptions"),
    stripeCouponId: text("stripe_coupon_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shop_promo_codes_shop_created_idx").on(table.shopId, table.createdAt),
    uniqueIndex("shop_promo_codes_shop_code_unique").on(table.shopId, table.code),
    check("shop_promo_codes_discount_range", sql`${table.discountPercent} between 1 and 100`),
    check(
      "shop_promo_codes_max_redemptions_positive",
      sql`${table.maxRedemptions} is null or ${table.maxRedemptions} > 0`,
    ),
    check(
      "shop_promo_codes_window",
      sql`${table.startsAt} is null or ${table.expiresAt} is null or ${table.startsAt} < ${table.expiresAt}`,
    ),
  ],
);

/**
 * One paid redemption of a shop-wide code — the "redemption history" half of a
 * real promotion model. Written inside `markCheckoutPaidBySessionId`'s
 * transaction and keyed unique on the checkout, so a replayed or duplicated
 * Stripe webhook can never inflate a code's usage count. Stripe remains the
 * authority on whether a redemption was *allowed*; this is DiveDay's own audit
 * trail for reporting and for a later cancellation/refund conversation.
 */
export const shopPromoRedemptions = pgTable(
  "shop_promo_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    promoCodeId: uuid("promo_code_id")
      .notNull()
      .references(() => shopPromoCodes.id),
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => bookingCheckouts.id),
    /**
     * The checkout's quoted total *before* Stripe applied the discount — i.e.
     * what DiveDay asked for, not what settled. The discount is Stripe's
     * arithmetic and lives on its own objects, so recording a post-discount
     * figure here would be DiveDay re-deriving a number it does not own. Read
     * it as "the order this code was spent against."
     */
    amountChargedCents: integer("amount_charged_cents").notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("shop_promo_redemptions_checkout_unique").on(table.checkoutId),
    index("shop_promo_redemptions_promo_idx").on(table.promoCodeId, table.redeemedAt),
  ],
);

/**
 * A booking's current payment state. deposit_paid, paid, and waived clear the
 * "ready to board" payment gate; unpaid and refunded do not (readiness.ts).
 */
export const paymentStatus = pgEnum("payment_status", [
  "unpaid",
  "deposit_paid",
  "paid",
  "waived",
  "refunded",
]);

/** One current payment row per booking. Amounts are minor units (cents). */
export const bookingPayments = pgTable(
  "booking_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    status: paymentStatus("status").notNull().default("unpaid"),
    amountCents: integer("amount_cents"),
    currency: text("currency").notNull().default("usd"),
    /** Provider that took the payment, e.g. "stripe"; null for a manual mark. */
    provider: text("provider"),
    providerRef: text("provider_ref"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_payments_booking_unique").on(table.bookingId),
    index("booking_payments_shop_status_idx").on(table.shopId, table.status),
    check(
      "booking_payments_amount_nonnegative",
      sql`${table.amountCents} is null or ${table.amountCents} >= 0`,
    ),
  ],
);

/** Latest outbound-email state per booking and notification purpose. */
export const notificationKind = pgEnum("notification_kind", [
  "booking_confirmation",
  "waiver_request",
  // Scheduled pre-trip reminders; one delivery row per booking per cadence
  // (src/lib/reminders.ts) means each cadence sends at most once.
  "trip_reminder_7d",
  "trip_reminder_24h",
  // The post-trip recap message — sent once per booking after the trip departs,
  // linking to the diver's shareable recap page (docs first-principles
  // brainstorm C: the word-of-mouth window, weaponized).
  "trip_recap",
]);

export const notificationDeliveryStatus = pgEnum("notification_delivery_status", [
  "sent",
  "failed",
  "not_configured",
]);

/** Durable retry state for transient provider failures. */
export const notificationQueueStatus = pgEnum("notification_queue_status", [
  "queued",
  "processing",
  "sent",
  "failed",
]);

/**
 * What the provider later said happened to a message we already handed over —
 * a different question from `notification_delivery_status`, which only records
 * whether our own send call succeeded. Reported by the Resend webhook
 * (20260726-hosted-mailboxes-for-platform-mail); null until an event arrives, which is
 * the normal steady state when no webhook is configured.
 */
export const notificationProviderStatus = pgEnum("notification_provider_status", [
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "failed",
  "suppressed",
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
    /** Provider-reported outcome; reset to null whenever a fresh send replaces the row. */
    providerStatus: notificationProviderStatus("provider_status"),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }),
    /** The provider's own explanation for a bounce or failure, shown to staff verbatim. */
    providerDetail: text("provider_detail"),
    /** HTTP-level explanation from our send attempt, before provider webhooks exist. */
    sendHttpStatus: integer("send_http_status"),
    sendErrorCode: text("send_error_code"),
    sendError: text("send_error"),
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
    // The webhook's only entry point: an event names the provider's message id.
    index("notification_deliveries_provider_message_idx").on(table.providerMessageId),
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
    sendHttpStatus: integer("send_http_status"),
    sendErrorCode: text("send_error_code"),
    sendError: text("send_error"),
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

/**
 * Retryable outbound notifications. The payload is the validated application
 * notification, not provider-specific JSON, so a later worker can render it
 * again and keep the idempotency boundary stable across process restarts.
 */
export const notificationSendQueue = pgTable(
  "notification_send_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    payload: jsonb("payload").$type<Notification>().notNull(),
    status: notificationQueueStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notification_send_queue_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.lockedUntil,
    ),
    index("notification_send_queue_shop_status_idx").on(table.shopId, table.status),
  ],
);

/** Singleton team-wide permit clock; Resend rate limits are team-scoped. */
export const notificationRateLimitState = pgTable("notification_rate_limit_state", {
  key: text("key").primaryKey(),
  nextAllowedAt: timestamp("next_allowed_at", { withTimezone: true }).notNull(),
});

/**
 * One connected Stripe account per shop (Connect, Standard — the shop's own
 * account, not a platform-controlled sub-account). Presence plus
 * `charges_enabled` is the sole readiness gate for creating an order; absence
 * or a disconnect fails closed to "not connected", never a silent retry.
 * See 20260719-stripe-connect-orders.
 */
export const shopStripeAccounts = pgTable(
  "shop_stripe_accounts",
  {
    shopId: uuid("shop_id")
      .primaryKey()
      .references(() => shops.id),
    stripeAccountId: text("stripe_account_id").notNull(),
    chargesEnabled: boolean("charges_enabled").notNull().default(false),
    payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
    detailsSubmitted: boolean("details_submitted").notNull().default(false),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set on an OAuth deauthorize webhook; a later reconnect clears it. */
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("shop_stripe_accounts_stripe_account_unique").on(table.stripeAccountId)],
);

export const orderStatus = pgEnum("order_status", [
  "open",
  "paid",
  "void",
  "uncollectible",
  "refunded",
]);

/**
 * What one order line represents — free-form `other` always available since
 * shops will invoice things this catalog doesn't anticipate.
 */
export const orderLineItemKind = pgEnum("order_line_item_kind", [
  "trip_fee",
  "course_fee",
  /** The agency e-learning code, billed as its own line beside course_fee. */
  "e_learning_fee",
  "rental",
  /** Enriched air, charged per dive on top of the trip fee. */
  "nitrox",
  "deposit",
  "merchandise",
  "other",
]);

/**
 * A shop-issued order/invoice for one customer. Local, provider-neutral
 * status mirrors the Stripe invoice it is backed by; `booking_id` is optional
 * so an order can stand alone (retail sale, walk-in air fill) or settle a
 * booking's payment gate through the webhook (20260719-stripe-connect-orders).
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    status: orderStatus("status").notNull().default("open"),
    currency: text("currency").notNull().default("usd"),
    totalCents: integer("total_cents").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    description: text("description"),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdfUrl: text("invoice_pdf_url"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_stripe_invoice_unique").on(table.stripeInvoiceId),
    index("orders_shop_status_idx").on(table.shopId, table.status),
    index("orders_shop_booking_idx").on(table.shopId, table.bookingId),
    check("orders_total_nonnegative", sql`${table.totalCents} >= 0`),
    check("orders_amount_paid_nonnegative", sql`${table.amountPaidCents} >= 0`),
  ],
);

/**
 * A hosted Stripe Checkout attempt for a public booking (or party of
 * bookings), on the shop's connected account. `pending` means the diver was
 * handed a payment link that may still be paid; `completed` is only ever set
 * from Stripe's own evidence (webhook or a direct API read), never from a
 * return-URL claim. Abandonment costs nothing: the bookings it covers simply
 * stay unpaid, exactly as if the shop had no checkout at all.
 * See 20260721-checkout-at-booking.
 */
export const checkoutStatus = pgEnum("checkout_status", ["pending", "completed", "expired"]);

export const bookingCheckouts = pgTable(
  "booking_checkouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    status: checkoutStatus("status").notNull().default("pending"),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeSessionId: text("stripe_session_id").notNull(),
    /** Stripe's hosted payment page; shown again as the recovery link while the session is open. */
    checkoutUrl: text("checkout_url"),
    /**
     * The email Stripe received at checkout creation (`customerEmail` on
     * `startBookingCheckout`), stored durably here. For a party checkout this
     * is the one submitter's address — `booking_checkout_bookings` links every
     * covered booking with no lead/ordering marker, so re-deriving "the
     * purchaser" from that join is unreliable; this column is the actual
     * source of truth for who to contact about this checkout attempt
     * (abandoned-cart recovery, docs ADR 20260726-abandoned-checkout-recovery).
     */
    customerEmail: text("customer_email"),
    /** Set once a recovery email has gone out, so a re-run of the recovery scan never double-sends. */
    abandonedRecoverySentAt: timestamp("abandoned_recovery_sent_at", { withTimezone: true }),
    /**
     * The shop-wide promo code handed to Stripe on this attempt, if any. The id
     * is what a completed checkout records a redemption against; the text is a
     * snapshot so a later edit or delete of the code can't rewrite what the
     * diver was actually quoted (docs ADR 20260729-shop-promo-codes). Both stay
     * null for an undiscounted checkout and for a trip-scoped last-minute promo,
     * which is Stripe's object end to end and has its own row.
     */
    promoCodeId: uuid("promo_code_id").references(() => shopPromoCodes.id),
    promoCode: text("promo_code"),
    currency: text("currency").notNull().default("usd"),
    /** Price snapshot at checkout time, so a later trip re-price never rewrites what was asked. */
    amountPerDiverCents: integer("amount_per_diver_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /**
     * True when the amount charged is a deposit (a balance is still due), so a
     * completed session settles the covered bookings to `deposit_paid` rather
     * than `paid`. False (the default) is the full-fare checkout.
     */
    isDeposit: boolean("is_deposit").notNull().default(false),
    /** Stripe expires unfinished Checkout sessions; kept so the UI can be honest about a dead link. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_checkouts_stripe_session_unique").on(table.stripeSessionId),
    index("booking_checkouts_shop_trip_idx").on(table.shopId, table.tripId),
    check("booking_checkouts_amount_per_diver_nonnegative", sql`${table.amountPerDiverCents} >= 0`),
    check("booking_checkouts_total_nonnegative", sql`${table.totalCents} >= 0`),
    // The abandoned-checkout-recovery scan's exact predicate (pending, not yet
    // recovered), so the daily cron doesn't force a sequential scan of the
    // whole table's history as it grows (docs ADR
    // 20260726-abandoned-checkout-recovery).
    index("booking_checkouts_recovery_scan_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending' and ${table.abandonedRecoverySentAt} is null`),
  ],
);

/** The bookings one checkout pays for — a party checkout covers several. */
export const bookingCheckoutBookings = pgTable(
  "booking_checkout_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    checkoutId: uuid("checkout_id")
      .notNull()
      .references(() => bookingCheckouts.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
  },
  (table) => [
    uniqueIndex("booking_checkout_bookings_checkout_booking_unique").on(
      table.checkoutId,
      table.bookingId,
    ),
    index("booking_checkout_bookings_booking_idx").on(table.bookingId),
  ],
);

/**
 * A post-trip tip, a hosted Stripe Checkout the diver's own recap page
 * offers. Deliberately its own small table rather than reusing
 * `booking_checkouts`: a tip is always exactly one booking (never a party),
 * settles no booking-payment gate, and its webhook handling must never be
 * able to cascade into `markCheckoutPaidBySessionId`'s booking-paid logic —
 * same shape (status/session/checkout URL lifecycle), separate concern
 * (docs ADR 20260726-post-trip-tipping).
 */
export const tipStatus = pgEnum("tip_status", ["pending", "paid", "expired"]);

export const tips = pgTable(
  "tips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    status: tipStatus("status").notNull().default("pending"),
    stripeAccountId: text("stripe_account_id").notNull(),
    stripeSessionId: text("stripe_session_id").notNull(),
    checkoutUrl: text("checkout_url"),
    currency: text("currency").notNull().default("usd"),
    amountCents: integer("amount_cents").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tips_stripe_session_unique").on(table.stripeSessionId),
    index("tips_shop_booking_idx").on(table.shopId, table.bookingId),
    check("tips_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export const orderLineItems = pgTable(
  "order_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    kind: orderLineItemKind("kind").notNull().default("other"),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitAmountCents: integer("unit_amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("order_line_items_order_idx").on(table.orderId),
    check("order_line_items_quantity_positive", sql`${table.quantity} > 0`),
    check("order_line_items_unit_amount_nonnegative", sql`${table.unitAmountCents} >= 0`),
  ],
);

export const paymentOperationKind = pgEnum("payment_operation_kind", [
  "checkout_session",
  "invoice",
  "refund",
]);

/**
 * `started` is written and committed *before* the Stripe call it describes —
 * the durable evidence a crash between "Stripe was asked" and "the local
 * order/checkout/payment row was written" leaves behind. `succeeded`/`failed`
 * mean the Stripe call itself returned; a row still `started` past a short
 * staleness window is exactly the "indeterminate operation" CR-005 exists to
 * surface (`listStuckPaymentOperations`, src/db/payment-operations.ts).
 */
export const paymentOperationStatus = pgEnum("payment_operation_status", [
  "started",
  "succeeded",
  "failed",
]);

/**
 * One row per attempted Stripe side effect (create a Checkout session, create
 * or refund an invoice, refund a checkout) — written before the call, not
 * after, so the attempt itself is durable even if the process dies mid-call
 * or the local order/checkout/payment write that should follow never
 * happens. `id` is also the deterministic idempotency-key material
 * (`idempotencyKeyFor`, src/db/payment-operations.ts): retrying the same
 * logical attempt reuses the same intent row and the same Stripe idempotency
 * key, so a retry after a lost response converges on one Stripe object
 * instead of creating a second one. Exactly one of `tripId`/`bookingId`/
 * `orderId`/`checkoutId` is populated, matching `kind` (CR-005).
 */
export const paymentOperationIntents = pgTable(
  "payment_operation_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: paymentOperationKind("kind").notNull(),
    status: paymentOperationStatus("status").notNull().default("started"),
    /** Set for a checkout_session intent — which trip's booking(s) this session is for. */
    tripId: uuid("trip_id").references(() => trips.id),
    /**
     * Set for an invoice intent that settles a booking's payment gate (null
     * for a booking-less order), or for a checkout-refund intent
     * (refundBookingOnCancellation operates by bookingId, not a
     * booking_checkouts row — it never has one in hand).
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /** Set for a refund intent against an order's invoice. */
    orderId: uuid("order_id").references(() => orders.id),
    /** Reserved for a future refund path that has a booking_checkouts row in hand; no caller sets this today. */
    checkoutId: uuid("checkout_id").references(() => bookingCheckouts.id),
    /** The Stripe object id once known, even if the local finalize write then failed. */
    stripeObjectId: text("stripe_object_id"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("payment_operation_intents_shop_status_idx").on(table.shopId, table.status)],
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

/** A dated working window; trip assignments remain the authoritative crew list. */
export const staffShifts = pgTable(
  "staff_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("staff_shifts_shop_starts_idx").on(table.shopId, table.startsAt),
    index("staff_shifts_person_starts_idx").on(table.personId, table.startsAt),
    check("staff_shifts_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

/**
 * `invited`: a staff invite created this row (`inviteStaffMember`,
 * src/db/staff-accounts.ts) but the invitee hasn't accepted yet — an unusable
 * random password hash, no sign-in, excluded from `verifyCredentials` and
 * `loadActiveStaffRoles` exactly like `disabled` (both already gate on
 * `status === "active"`). Accepting the invite at `/invite/[token]` flips it
 * to `active`. See 20260726-staff-invite-accounts.
 */
export const accountStatus = pgEnum("account_status", ["invited", "active", "disabled"]);

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
    /**
     * Null until the account confirms it owns its own address via
     * `/verify/[token]` (20260725-account-lifecycle-emails). Tracked, but not
     * yet a sign-in gate — an unverified account works exactly like a
     * verified one today.
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /**
     * Null until this account dismisses its first-visit role orientation card
     * on Today (UX-persona task 79 — Kai, the day-one seasonal hire).
     * Per-account, not per-browser/device, so dismissing on the shop's shared
     * tablet also clears it on the same person's own phone.
     */
    orientationDismissedAt: timestamp("orientation_dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_accounts_email_unique").on(table.email),
    uniqueIndex("user_accounts_person_unique").on(table.personId),
  ],
);

export const accountTokenPurpose = pgEnum("account_token_purpose", [
  "email_verification",
  "password_reset",
  "invite",
]);

/**
 * A hashed, expiring, one-time bearer token proving control of a user
 * account's own email address — confirming a freshly created account, or
 * authorizing a password reset (20260725-account-lifecycle-emails). Shaped
 * like `waiver_records`'/`booking_capabilities`' tokens, not
 * `recap-links.ts`'s stateless one: a password-reset token is a bearer
 * credential over account takeover and must be individually revocable.
 * Issuing a fresh token for the same account+purpose supersedes any prior
 * outstanding one, exactly like a reissued waiver link.
 */
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id),
    purpose: accountTokenPurpose("purpose").notNull(),
    /** SHA-256 hash only — the raw bearer token is shown once when issued. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("account_tokens_account_purpose_idx").on(table.userAccountId, table.purpose)],
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
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A shop has exactly one waiver — versions increment per shop, not per
    // (shop, title): saveWaiverTemplate already computes the next version
    // shop-wide with no title filter, so the DB constraint now matches that
    // real invariant instead of a looser one that could let two different
    // titles both claim "version 2" at the same shop (CR-015).
    uniqueIndex("waiver_templates_shop_version_unique").on(table.shopId, table.version),
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
    /**
     * Null only for an imported record (`signatureMethod: "imported"`): a
     * contact import creates people, not bookings, so there is no booking to
     * issue against. Every other record is issued in the context of one real
     * booking, even though `personId` is what actually satisfies the sign-once
     * gate on other bookings.
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /**
     * The diver the signed release belongs to, denormalized from the booking so
     * a completed waiver is queryable per person. A diver signs once: a current
     * completed record satisfies the waiver gate on any of their bookings at the
     * shop (src/lib/waivers.ts — effectiveWaiverForBooking), so this is not
     * redundant with `bookingId`, which still records where the link was issued.
     */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
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
    /**
     * The staff member who attested an in-person / paper signature. Null for a
     * diver's own self-service completion — set only when a non-diver records a
     * release the app never saw signed, so the accountable person is on record.
     */
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    medicalAnswers: jsonb("medical_answers").$type<MedicalAnswers>(),
    medicalReviewRequired: boolean("medical_review_required").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** HMAC over the immutable signed metadata; null means legacy/unverified. */
    integrityHash: text("integrity_hash"),
    integrityVersion: integer("integrity_version"),
    /**
     * Provenance for an imported record (ADR 20260724-import-waiver-acceptance):
     * a free-text label of the prior shop/system the row named, and any
     * source document(s) re-stored through DiveDay's own image pipeline
     * (never rendered from the raw import URL directly). All null for a
     * record created any other way.
     */
    importedFromLabel: text("imported_from_label"),
    importSourceDocumentUrl: text("import_source_document_url"),
    importSourceMedicalDocumentUrl: text("import_source_medical_document_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("waiver_records_booking_current_idx").on(table.bookingId, table.supersededAt),
    index("waiver_records_shop_status_idx").on(table.shopId, table.status),
    // The per-person carry-forward lookup: a diver's completed releases at a shop.
    index("waiver_records_shop_person_status_idx").on(table.shopId, table.personId, table.status),
  ],
);

/**
 * What a `booking_capabilities` row authorizes. `readiness` covers the diver
 * self-service page (view + emergency contact + rental fit + nitrox + pay +
 * request a waiver link); `confirm` covers the public schedule-confirmation
 * page reached right after booking. Both are read+write for their purpose —
 * split into separate purposes (not separate read/write tokens) because
 * neither purpose's read and write lifetimes differ in practice.
 */
export const bookingCapabilityPurpose = pgEnum("booking_capability_purpose", [
  "readiness",
  "confirm",
]);

/**
 * A revocable, expiring bearer credential over one booking (CR-002/CR-003).
 * Unlike a waiver link, issuing a new capability does not supersede an
 * earlier still-valid one for the same booking+purpose — a diver may be
 * holding an earlier email's link and a later reminder's link at once, and
 * both should keep working until they individually expire or are revoked.
 * Only the hash is stored; the raw bearer token exists solely in the
 * response that issued it.
 */
export const bookingCapabilities = pgTable(
  "booking_capabilities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    purpose: bookingCapabilityPurpose("purpose").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The verify-path lookup: hash the bearer token, find the row.
    index("booking_capabilities_token_hash_idx").on(table.tokenHash),
    // Revocation-cascade and staff-facing "active links for this booking" lookups.
    index("booking_capabilities_booking_purpose_idx").on(
      table.bookingId,
      table.purpose,
      table.revokedAt,
    ),
  ],
);

/**
 * What a `calendar_feeds` row exposes. `assignments` is one staff member's own
 * crewed departures; `shop_trips` is every scheduled departure at the shop, for
 * an owner or manager who keeps the whole operation on one calendar.
 */
export const calendarFeedScope = pgEnum("calendar_feed_scope", ["assignments", "shop_trips"]);

/**
 * A long-lived, revocable bearer credential over a read-only iCalendar feed
 * (docs ADR 20260730-calendar-feed-subscriptions). Google, Apple, and Outlook
 * subscribe by URL and poll it on their own schedule, so unlike a
 * `booking_capabilities` row this one has no expiry: a feed that died after 60
 * days would silently stop updating a captain's calendar, which is worse than
 * the credential living until it is rotated. Rotation is the mitigation, and
 * `issueCalendarFeed` revokes the prior row for the same person+scope so a
 * leaked URL stops working the moment a new one is minted.
 *
 * Only the hash is stored; the raw token exists solely in the response that
 * issued it, which is why the staff page can show the URL once and thereafter
 * only offers to rotate it.
 */
export const calendarFeeds = pgTable(
  "calendar_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    scope: calendarFeedScope("scope").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Stamped on each successful fetch so staff can tell a subscribed calendar
     * from a URL nobody ever pasted anywhere. Deliberately coarse — calendar
     * clients poll often, and a per-hit write on a hot path buys nothing.
     */
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The verify-path lookup: hash the bearer token, find the row.
    index("calendar_feeds_token_hash_idx").on(table.tokenHash),
    // "Does this person already have a live feed for this scope?" — the
    // issue/rotate path and the staff settings panel both ask exactly this.
    index("calendar_feeds_person_scope_idx").on(table.personId, table.scope, table.revokedAt),
    /**
     * At most one *live* feed per person and scope, enforced by the database
     * rather than by `issueCalendarFeed`'s revoke-then-insert being careful.
     *
     * Under READ COMMITTED, two concurrent issues for the same person+scope
     * can each find nothing to revoke and both insert, leaving two live
     * tokens — which quietly breaks the promise this feature is built on,
     * that minting a link is what retires the previous one. The old token
     * does still get revoked in every interleaving, so this is not a way to
     * keep a leaked URL alive; it is the "issue == rotate" invariant that
     * fails, and the settings panel would then show two subscriptions where
     * the model says there is one.
     */
    uniqueIndex("calendar_feeds_live_person_scope_idx")
      .on(table.personId, table.scope)
      .where(sql`${table.revokedAt} IS NULL`),
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
    /**
     * Date-only, no time-of-day or timezone (CR-009): a card is valid
     * through the end of its own local calendar day in the shop's
     * timezone, not a fixed UTC instant that expires early or late
     * depending on the shop's offset. See src/lib/calendar-date.ts.
     */
    expiresAt: date("expires_at", { mode: "string" }),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /**
     * Provenance for a card brought in by the contact importer
     * (ADR 20260724-import-verified-cards). A non-null `importedAt` is the
     * definitive "this card was migrated" marker — mirroring `waiverRecords`'
     * `signatureMethod: "imported"`. Imported cards land `verified` (the prior
     * system already checked them) but with `reviewedAt` still null, so the
     * pair `importedAt IS NOT NULL AND reviewedAt IS NULL` is exactly the
     * "verified, awaiting a staff confirm" set the diver UI surfaces. Confirming
     * stamps `reviewedAt` through the normal review path; the imported provenance
     * stays forever so an imported card is never mistaken for one this shop
     * carded on sight. `importedFromLabel` is the optional prior-shop/system name.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /** Soft-archive: a deleted card keeps its row for safety history but drops
     * out of every readiness/roster read (ADR 20260719-crud-archive-semantics). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("certifications_shop_person_idx").on(table.shopId, table.personId),
    // Partial on the live rows only, so archiving a card frees its number for
    // re-entry (e.g. a renewed card carrying the same identifier).
    // Case-insensitive so "ab1234" and "AB1234" can't create two live rows
    // for what is the same physical card (CR-009).
    uniqueIndex("certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
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
    /** Date-only, shop-local expiry — see certifications.expiresAt (CR-009). */
    expiresAt: date("expires_at", { mode: "string" }),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /**
     * Import provenance, mirroring `certifications.importedAt` — an imported
     * specialty card lands `verified` and flagged
     * (ADR 20260725-import-specialty-cards). It diverges from a ladder card in
     * one deliberate way: the *gate* does not open on an imported card alone.
     * `specialtyBlocker` (src/lib/readiness.ts) holds a specialty requirement
     * until a staffer taps the one-tap confirm that stamps `reviewedAt`,
     * because a specialty is what authorizes a materially riskier dive (deep
     * gates depth past 18 m) and a spreadsheet cell is not a card sighting.
     * Same shape as nitrox's fill hold, expressed in the readiness layer
     * instead of SQL because that is where specialty gates are evaluated.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /** Soft-archive, mirroring `certifications.deletedAt`. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("specialty_certifications_shop_person_idx").on(table.shopId, table.personId),
    // Case-insensitive like certifications_shop_agency_identifier_unique (CR-009),
    // but keyed on the **specialty** as well — an agency number identifies the
    // *diver*, not the card (docs/product/glossary.md, "C-card": agency, level,
    // cert/diver number). A PADI diver's Deep and Wreck cards carry the same PADI
    // number, so keying without the specialty let a shop hold only one specialty
    // card per diver: the second was refused by `createSpecialtyCertification` and
    // silently skipped by the importer, and the remedy the copy offered ("give
    // each card its own number") does not exist at any agency
    // (`dive-domain-expert` review, ADR 20260725-import-specialty-cards).
    uniqueIndex("specialty_certifications_shop_agency_specialty_identifier_unique")
      .on(table.shopId, table.agency, table.specialty, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * A visit the diver made **before DiveDay** — one row per booking the shop's
 * prior system recorded, brought across by the contact importer
 * (ADR 20260725-import-prior-visits).
 *
 * This table is deliberately inert. It is the shop's own history, kept as
 * history: nothing here is read by readiness, capacity, roll call, trip prep,
 * or owner reporting, and nothing here opens a gate. It exists so a diver's
 * profile can say "you have dived with this shop eleven times since 2019"
 * instead of starting every migrated regular at zero.
 *
 * Three shapes of dishonesty are ruled out by construction rather than by
 * convention:
 *
 *   - **It is not a trip and not a booking.** Reconstructing `trips`/`bookings`
 *     rows would require inventing capacity, planned dives, and a roll call
 *     that never happened here — a fabricated safety document. A prior visit
 *     points at no trip, so there is nothing to fabricate and nothing for the
 *     dock to act on.
 *   - **A booking is not a dive.** `statusLabel` carries the prior system's own
 *     word for the row ("Completed", "Cancelled", "No-show") verbatim, because
 *     an orders export contains all three and counting them alike would invent
 *     dives the diver never made. Never normalized to a DiveDay enum: the
 *     vocabularies are not the same and mapping one onto the other is a guess.
 *   - **The money is a label, not an amount.** `amountLabel` is the raw text the
 *     file held ("$180.00", "160,00 €") — never parsed to minor units, never
 *     given a currency column, never summed. Storing text is what makes
 *     "display-only" structural: there is no number here for a future reporting
 *     query to pick up by accident, and no locale to misread (`1.234,56`).
 */
export const priorVisits = pgTable(
  "prior_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /**
     * Date-only and shop-local, like certification expiry (CR-009). A prior
     * system's export gives a calendar day, not an instant with a zone, and
     * inventing a departure time would be inventing a trip.
     */
    visitedOn: date("visited_on", { mode: "string" }).notNull(),
    /** What the prior system called it ("Two-tank Molasses Reef"); free text. */
    title: text("title"),
    /** The source's own status word, verbatim and un-mapped. See the note above. */
    statusLabel: text("status_label"),
    /** Display-only money as text. Never parsed, never summed. See the note above. */
    amountLabel: text("amount_label"),
    /** The prior shop/system this came from, for the profile's provenance line. */
    sourceLabel: text("source_label"),
    /** The prior system's own booking/order id, when the export carried one. */
    sourceReference: text("source_reference"),
    /**
     * What re-running the same import twice keys on. Derived in
     * `src/lib/import.ts` (`priorVisitDedupeKey`): the source's booking/order id
     * when the file has one, otherwise the row's own date/title/amount. A second
     * import of the same file must not double a diver's history, and an orders
     * export is exactly the file an owner re-runs as their roster grows.
     */
    dedupeKey: text("dedupe_key").notNull(),
    /** Always set — every row here arrived by import, never by hand. */
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("prior_visits_shop_person_idx").on(table.shopId, table.personId, table.visitedOn),
    uniqueIndex("prior_visits_shop_person_dedupe_unique").on(
      table.shopId,
      table.personId,
      table.dedupeKey,
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
    /** Whether a diver must have paid (or a deposit/waiver) to board. */
    requiresPayment: boolean("requires_payment").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("trip_requirements_shop_idx").on(table.shopId)],
);

/**
 * A diver's reusable rental fit at one shop: which pieces of kit they take
 * from the shop and what size each is. Deliberately a storage concept — the
 * shop tracks no equipment inventory, so this is what a diver needs prepared,
 * never a reservation of a particular item or a substitute for a dock-side
 * fit check. The trip prep checklist is derived entirely from these rows.
 */
export const rentalFitProfiles = pgTable(
  "rental_fit_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** Which pieces the shop supplies. A diver with their own kit rents none. */
    rentsBcd: boolean("rents_bcd").notNull().default(true),
    rentsRegulator: boolean("rents_regulator").notNull().default(true),
    rentsWetsuit: boolean("rents_wetsuit").notNull().default(true),
    rentsMaskFins: boolean("rents_mask_fins").notNull().default(true),
    rentsWeights: boolean("rents_weights").notNull().default(true),
    /** Optional add-ons — a diver usually owns a computer and may not want a GoPro. */
    rentsDiveComputer: boolean("rents_dive_computer").notNull().default(false),
    rentsGopro: boolean("rents_gopro").notNull().default(false),
    bcdSize: text("bcd_size"),
    wetsuitSize: text("wetsuit_size"),
    bootSize: text("boot_size"),
    finSize: text("fin_size"),
    weightPreference: text("weight_preference"),
    note: text("note"),
    /**
     * The safe fallback when a requested size isn't available (H-06): staff
     * flag the diver for hands-on fitting at check-in instead of silently
     * packing a different size. Set/cleared only by its own action — a size
     * edit never clears it, because a stale flag costs one extra look while a
     * wrongly-cleared one puts a diver in gear nobody checked.
     */
    needsStaffFitAt: timestamp("needs_staff_fit_at", { withTimezone: true }),
    /** What's short ("no L BCD in stock"), in the flagging staff member's words. */
    needsStaffFitNote: text("needs_staff_fit_note"),
    /**
     * Who raised it. A safety flag that blanks a diver's sizes on the packing
     * list, and carries free text about a person, should not be anonymous —
     * the same reason roll-call events record who called them. Attribution
     * only: authorization is checked in the action, not read from this column.
     */
    needsStaffFitBy: uuid("needs_staff_fit_by").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rental_fit_profiles_shop_person_unique").on(table.shopId, table.personId),
    index("rental_fit_profiles_shop_person_idx").on(table.shopId, table.personId),
  ],
);

/**
 * A nitrox (EANx) specialty card. Modeled separately from `certifications`
 * because that table is the recreational ladder (its `level` enum feeds the
 * readiness rank map); a specialty is a distinct yes/no gate, not a ladder
 * rung. Same capture→verify workflow: evidence starts pending and only a
 * verified card lets a diver request enriched air on a booking.
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
    /**
     * Import provenance, mirroring `certifications.importedAt` — an imported
     * nitrox card lands `verified` (flagged) awaiting a staff confirm
     * (ADR 20260724-import-verified-cards). Enriched-air fill authorization
     * reads `verified`, so a confirmed-or-not imported nitrox card can clear a
     * fill; the imported marker keeps it distinguishable and expiry/fill-time
     * re-checks still apply.
     */
    importedAt: timestamp("imported_at", { withTimezone: true }),
    importedFromLabel: text("imported_from_label"),
    /** Soft-archive, mirroring `certifications.deletedAt`. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("nitrox_certifications_shop_person_idx").on(table.shopId, table.personId),
    // Case-insensitive, mirroring certifications_shop_agency_identifier_unique (CR-009).
    uniqueIndex("nitrox_certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * `cleared` is an append-only "undo": staff tapped the current status again to
 * reset a diver to awaiting after a mistake. It is stored as its own event so
 * the correction stays in the audit trail; the derivation collapses a latest
 * `cleared` back to "no roll call yet" (src/db/manifests.ts).
 */
export const rollCallStatus = pgEnum("roll_call_status", ["boarded", "not_boarded", "cleared"]);
export const rollCallSource = pgEnum("roll_call_source", ["live", "offline"]);

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
    /** `departure` or `after_dive_N`; validated against the trip's planned dive count. */
    checkpoint: text("checkpoint").notNull().default("departure"),
    source: rollCallSource("source").notNull().default("live"),
    /** Device-generated idempotency key. Live events leave this null. */
    clientEventId: uuid("client_event_id"),
    /** Which encrypted snapshot supplied the offline readiness evidence. */
    offlineSnapshotSavedAt: timestamp("offline_snapshot_saved_at", { withTimezone: true }),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("roll_call_events_shop_trip_checkpoint_booking_occurred_idx").on(
      table.shopId,
      table.tripId,
      table.checkpoint,
      table.bookingId,
      table.occurredAt,
    ),
    uniqueIndex("roll_call_events_shop_client_event_unique").on(table.shopId, table.clientEventId),
  ],
);

/**
 * A photo a diver attaches to their own post-trip recap page. The recap link is
 * a per-booking signed token (public, noindex), so an upload is scoped to that
 * booking and a diver only ever sees the shots on their own page. Staff see a
 * trip's diver photos on the roster so the shop can reuse them and take down
 * anything inappropriate — the moderation seam is a delete, mirroring the opt-in
 * `dive_site_moments` shape (20260723-post-trip-recap follow-up).
 */
export const recapPhotos = pgTable(
  "recap_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    imageUrl: text("image_url").notNull(),
    caption: text("caption"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("recap_photos_booking_idx").on(table.bookingId, table.createdAt),
    index("recap_photos_trip_idx").on(table.tripId, table.createdAt),
  ],
);

/**
 * A star rating (and optional words) from a diver who provably dived — the row
 * is only ever written through that booking's own signed recap link, so unlike
 * an open web form there is no way to leave one without having been on the
 * boat. Unique on `booking_id`: a diver revises their own review rather than
 * stacking several, and a replayed submit can't inflate a shop's average.
 *
 * `isPublished` is the moderation seam, same shape as `diveSiteMoments`. A
 * bare rating carries no text to moderate and publishes immediately; a review
 * *with* a comment waits for staff, because the comment lands on the shop's
 * public schedule page. Aggregates are computed over published rows only, so
 * the number a visitor sees and the reviews under it always describe the same
 * set (docs ADR 20260729-verified-diver-reviews).
 */
export const tripReviews = pgTable(
  "trip_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    isPublished: boolean("is_published").notNull().default(false),
    /** Null until published; drives "newest published first" on the public list. */
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_reviews_booking_unique").on(table.bookingId),
    // The public aggregate and list query verbatim: this shop's published rows,
    // newest first, so a shop with years of reviews still renders from an index.
    index("trip_reviews_shop_published_idx")
      .on(table.shopId, table.publishedAt)
      .where(sql`${table.isPublished}`),
    // The staff moderation queue: everything for the shop, newest first.
    index("trip_reviews_shop_created_idx").on(table.shopId, table.createdAt),
    check("trip_reviews_rating_range", sql`${table.rating} between 1 and 5`),
  ],
);

export const mediaDeletionKind = pgEnum("media_deletion_kind", ["course_photo", "recap_photo"]);

export const mediaDeletionStatus = pgEnum("media_deletion_status", [
  "pending",
  "succeeded",
  "failed",
]);

/**
 * One row per "this blob object should no longer exist" decision — a recap
 * photo's row deleted by staff moderation, or a course hero/gallery photo
 * superseded on save. Mirrors `paymentOperationIntents` (CR-005): the local
 * removal (the row gone, the URL dropped from `imageUrls`) is never blocked on
 * storage, so this table is the durable record of "we still owe a delete"
 * that survives a crash between the local change and the provider call
 * succeeding. A `pending` row that never resolved (the process died before
 * the delete call returned) and a `failed` row (the delete call itself
 * failed) both need the same retry — `attempts`/`lastError` exist so an owner
 * sees why, not just that (CR-012).
 */
export const mediaDeletionAttempts = pgTable(
  "media_deletion_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: mediaDeletionKind("kind").notNull(),
    url: text("url").notNull(),
    status: mediaDeletionStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [index("media_deletion_attempts_shop_status_idx").on(table.shopId, table.status)],
);

export type Shop = typeof shops.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type TripSeries = typeof tripSeries.$inferSelect;
export type TripDive = typeof tripDives.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type TripWaitlistEntry = typeof tripWaitlistEntries.$inferSelect;
export type LastMinuteListEntry = typeof lastMinuteListEntries.$inferSelect;
export type TripLastMinutePromo = typeof tripLastMinutePromos.$inferSelect;
export type NotificationDeliveryRecord = typeof notificationDeliveries.$inferSelect;
export type NotificationDeliveryAttempt = typeof notificationDeliveryAttempts.$inferSelect;
export type BookingPayment = typeof bookingPayments.$inferSelect;
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type WaiverRecord = typeof waiverRecords.$inferSelect;
export type CalendarFeed = typeof calendarFeeds.$inferSelect;
export type CalendarFeedScope = (typeof calendarFeedScope.enumValues)[number];
export type Certification = typeof certifications.$inferSelect;
export type SpecialtyCertification = typeof specialtyCertifications.$inferSelect;
export type DiveSpecialty = (typeof diveSpecialty.enumValues)[number];
export type DiveSite = typeof diveSites.$inferSelect;
export type TripRequirement = typeof tripRequirements.$inferSelect;
export type RentalFitProfile = typeof rentalFitProfiles.$inferSelect;
export type RollCallEvent = typeof rollCallEvents.$inferSelect;
export type NitroxCertification = typeof nitroxCertifications.$inferSelect;
export type ShopStripeAccount = typeof shopStripeAccounts.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type OrderLineItemKind = (typeof orderLineItemKind.enumValues)[number];
export type BookingCheckout = typeof bookingCheckouts.$inferSelect;
export type CheckoutStatus = (typeof checkoutStatus.enumValues)[number];
export type Tip = typeof tips.$inferSelect;
export type TipStatus = (typeof tipStatus.enumValues)[number];
export type RecapPhoto = typeof recapPhotos.$inferSelect;
export type TripReview = typeof tripReviews.$inferSelect;
export type ShopPromoCode = typeof shopPromoCodes.$inferSelect;
export type ShopPromoScope = (typeof shopPromoScope.enumValues)[number];
export type ShopPromoStatus = (typeof shopPromoStatus.enumValues)[number];
export type ShopPromoRedemption = typeof shopPromoRedemptions.$inferSelect;
export type PaymentOperationIntent = typeof paymentOperationIntents.$inferSelect;
export type MediaDeletionAttempt = typeof mediaDeletionAttempts.$inferSelect;
export type MediaDeletionKind = (typeof mediaDeletionKind.enumValues)[number];
export type PaymentOperationKind = (typeof paymentOperationKind.enumValues)[number];
export type PaymentOperationStatus = (typeof paymentOperationStatus.enumValues)[number];
