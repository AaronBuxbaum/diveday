import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
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
import type { CloseoutSnapshot } from "@/lib/closeout";
import type { CourseFaq, CourseGalleryPhoto, CourseScheduleDay } from "@/lib/courses";
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

/**
 * How a shop reads water temperature. Storage stays Celsius either way
 * (src/lib/temperature-units.ts).
 */
export const temperatureUnit = pgEnum("temperature_unit", ["celsius", "fahrenheit"]);

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
    /**
     * ISO 4217 currency (lowercase, Stripe's spelling) for every amount this
     * shop displays or charges — the single source of truth, chosen in
     * settings (docs ADR 20260731-shop-currency). All `*_cents` columns hold
     * this currency's **minor unit**, which is not always 1/100: a zero-decimal
     * currency like JPY stores whole yen, so display divides by the currency's
     * own exponent rather than a hardcoded 100 (`src/lib/money.ts`).
     *
     * `shop_stripe_accounts.default_currency` is what Stripe *reports* for the
     * connected account and stays advisory: settings surfaces a mismatch
     * rather than silently overriding what the shop declared here.
     */
    currency: text("currency").notNull().default("usd"),
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
     * Whether this shop reads water temperature in Celsius or Fahrenheit.
     * Display and entry only — `trips.water_temperature_c` is always canonical
     * Celsius, so switching the unit reinterprets nothing and no stored number
     * ever moves, exactly like `depth_unit` above.
     *
     * Its own column rather than a reading of `depth_unit`, which is what
     * src/lib/temperature-units.ts derived before this existed: the two
     * genuinely come apart. A UK shop dives in metres and talks about the water
     * in Celsius; a US shop does feet and Fahrenheit; but plenty of shops in
     * between (Caribbean operators serving American divers, for one) publish
     * feet *and* Celsius, and had no way to say so. Celsius is the default
     * because storage is Celsius and most of the diving world reads it; the
     * migration that added this column backfilled Fahrenheit for shops already
     * set to feet, so no existing shop's reading changed on the day it landed.
     */
    temperatureUnit: temperatureUnit("temperature_unit").notNull().default("celsius"),
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
    /**
     * The shop's physical business address — where a diver actually meets the
     * boat or walks into the storefront, not a staff member's personal one.
     * Every field is nullable independently because a shop that has not
     * filled in its address must not have one guessed on its behalf; a shop
     * can be fully set up with no street on file. `addressCountry` is an ISO
     * 3166-1 alpha-2 code ("US", "MX", …), not a free-text country name.
     */
    addressStreet: text("address_street"),
    addressLocality: text("address_locality"),
    addressRegion: text("address_region"),
    addressPostalCode: text("address_postal_code"),
    addressCountry: text("address_country"),
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
    /**
     * The rest of the shop's dock-day rhythm, in minutes (src/lib/diver-planning.ts).
     * Before these columns existed the whole day was inferred from
     * `dock_call_minutes` alone — the briefing was half of it capped at 15, and
     * the two beats on the water were the trip window's own thirds — so a shop
     * that briefs on the boat, kits up on board, or runs one tank read DiveDay
     * telling their divers a day they don't run.
     *
     * Zero is meaningful on the four that allow it: it takes the beat out of
     * the day rather than putting it at the departure. `bottom_time_minutes` is
     * the one with no such reading, so its CHECK floors it above zero.
     */
    gearSetupMinutes: integer("gear_setup_minutes").notNull().default(0),
    briefingMinutes: integer("briefing_minutes").notNull().default(15),
    boatRideMinutes: integer("boat_ride_minutes").notNull().default(20),
    bottomTimeMinutes: integer("bottom_time_minutes").notNull().default(45),
    surfaceIntervalMinutes: integer("surface_interval_minutes").notNull().default(60),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("shops_dock_call_minutes_nonnegative", sql`${table.dockCallMinutes} >= 0`),
    check("shops_gear_setup_minutes_nonnegative", sql`${table.gearSetupMinutes} >= 0`),
    check("shops_briefing_minutes_nonnegative", sql`${table.briefingMinutes} >= 0`),
    check("shops_boat_ride_minutes_nonnegative", sql`${table.boatRideMinutes} >= 0`),
    check("shops_bottom_time_minutes_positive", sql`${table.bottomTimeMinutes} > 0`),
    check("shops_surface_interval_minutes_nonnegative", sql`${table.surfaceIntervalMinutes} >= 0`),
  ],
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
    /**
     * The language this diver reads, captured from the `Accept-Language` of a
     * request they made themselves (a public booking, a waiver signature) and
     * preferred over the shop's `default_locale` when DiveDay emails or texts
     * them (docs ADR 20260731-per-person-notification-locale, superseding
     * 20260731-notification-locale).
     *
     * Null means "no first-hand signal" — the shop's locale is used, exactly as
     * before. Only ever written from a request the diver themselves made:
     * staff-triggered actions carry the *staff* member's header, which says
     * nothing about what the diver reads.
     */
    locale: text("locale"),
    /**
     * Set once this person self-serves out of courtesy email — wait-list
     * openings (`waitlist_invite`) and post-trip recaps (`trip_recap`), the two
     * kinds that ask something of the diver's attention beyond their own
     * booking rather than confirm or protect it (docs features/story-backlog.md "Leo —
     * self-serve email unsubscribe"). Deliberately narrower than
     * `lastMinuteListEntries.unsubscribedAt`: that column opts a person out of
     * a *list they joined*, this one opts a person out of two notification
     * *kinds* everyone is eligible for, so it can't reuse the same row. Never
     * suppresses booking confirmations, waiver requests, trip reminders, or a
     * conditions hold — those stay mandatory regardless of this flag.
     */
    courtesyEmailOptOutAt: timestamp("courtesy_email_opt_out_at", { withTimezone: true }),
    /** Keeps history intact while removing a person from active shop workspaces. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * Set when this person's identifying and medical data was destructively
     * erased across the shop's tables (ADR 20260802-diver-data-erasure).
     *
     * Deliberately **not** the same column as `deleted_at`. Removal is
     * reversible and preserves the record (ADR 20260719-crud-archive-semantics);
     * erasure destroys it and cannot be undone, so the two are separate
     * operations with separate markers and separate authorization. The check
     * constraint below is what makes "one way" structural rather than a
     * convention: an erased row must stay removed, so `restoreDiver`'s
     * `deleted_at = null` write can never resurrect a half-erased person into
     * the active roster — the database refuses it even if a future caller
     * forgets to look.
     */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    /**
     * The shop owner who ordered the erasure. A one-way, evidence-reducing
     * action is never anonymous — the same reasoning
     * `rental_fit_profiles.needs_staff_fit_by` and
     * `roll_call_events.recorded_by_person_id` record who called a safety flag.
     */
    anonymizedByPersonId: uuid("anonymized_by_person_id").references((): AnyPgColumn => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("people_shop_idx").on(table.shopId),
    check(
      "people_anonymized_stays_removed",
      sql`${table.anonymizedAt} is null or ${table.deletedAt} is not null`,
    ),
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
 * How a trip series repeats. Only weekly, and deliberately so: a weekday *set*
 * plus a week interval already expresses daily ("all seven"), weekly, and
 * every-N-weeks, so a second enum value would be a second way to say the same
 * thing. A genuinely different shape — monthly by nth-weekday — would be the
 * additive migration this enum leaves room for.
 * See 20260719-recurring-trip-series and 20260810-open-ended-recurring-trips.
 */
export const tripRecurrenceFrequency = pgEnum("trip_recurrence_frequency", ["weekly"]);

/**
 * The template + cadence behind a set of repeating trips. A series does not run
 * on the boat — its instances do. Each instance is a real, independent `trips`
 * row (see `trips.series_id`) so bookings, manifests, waivers, and roll
 * call all use the one operational spine and an owner can edit or cancel a
 * single date without touching the rest.
 *
 * The series row is the cadence, not a live scheduler: nothing reads a trip's
 * details *through* it. Instances are materialized into a rolling window —
 * `SERIES_HORIZON_DAYS` ahead — so a series with no end date is a real,
 * unlimited run rather than a finite batch somebody has to re-schedule
 * (docs/architecture/decisions/20260810-open-ended-recurring-trips.md).
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
    /** Weeks between firing weeks: 1 for every week, 2 for every other week, etc. */
    intervalWeeks: integer("interval_weeks").notNull().default(1),
    /**
     * Which weekdays each firing week departs on, as the bitmask
     * `src/lib/recurrence.ts` defines: bit 0 Sunday … bit 6 Saturday. "Every
     * day" is all seven bits, which is why there is no separate daily cadence.
     *
     * The app always writes a real set. The `0` default exists only so the
     * release *before* this column shipped could still insert during the deploy
     * window — an empty set is refused by `seriesOccurrenceDates`, so such a row
     * generates nothing, which is what that release expects.
     */
    weekdayMask: integer("weekday_mask").notNull().default(0),
    /**
     * The shop-local calendar date the cadence's weeks are counted from — the
     * *phase*, not necessarily an occurrence. Stored rather than derived from
     * the earliest instance because that instance can be moved or deleted, and
     * an every-other-week series whose phase drifts when a date is removed
     * would silently start departing on the wrong weeks.
     *
     * Empty string is the same deploy-window sentinel as `weekday_mask`'s zero,
     * and is refused the same way.
     */
    anchorDate: text("anchor_date").notNull().default(""),
    /**
     * The last shop-local date the series may fire on, or **null for a series
     * that simply keeps going** — the ordinary case for a shop's standing
     * Saturday charter. Null is what makes the run unlimited; the horizon roll
     * keeps the board full ahead of it.
     */
    endsOn: text("ends_on"),
    /**
     * How many instances the series has materialized *so far* — bumped by every
     * horizon roll. A fact about the board, never a target: an open-ended series
     * has no total, and staff are shown this count as "N dates on the board".
     */
    occurrenceCount: integer("occurrence_count").notNull(),
    /**
     * When the nightly horizon pass last considered this run — null until it
     * has. It is the sweep's queue order, not a statistic: least-recently-rolled
     * first makes the pass a round robin, so one shop with a great many runs
     * delays another shop's by a night instead of starving it forever
     * (`rollAllSeriesForward`). Written on every attempt, including a failed one.
     */
    lastRolledAt: timestamp("last_rolled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_series_shop_idx").on(table.shopId),
    // The sweep's own ordering. Without it the nightly pass sorts every
    // still-running series in the deployment on each tick.
    index("trip_series_roll_queue_idx").on(table.lastRolledAt),
  ],
);

/**
 * Dates the series must never put back on the board.
 *
 * A materialized instance is independent — staff cancel it, move it, or delete
 * it outright, and no sibling notices. Cancelling and moving keep the row, so
 * the horizon roll sees the date is spoken for. **Deleting does not**, and
 * without this ledger the next roll would helpfully re-create the very
 * departure somebody just removed. One row per removed occurrence, written in
 * the same transaction as the delete.
 *
 * Keyed by the occurrence's own cadence date (`trips.series_occurrence_date`),
 * not by the instant it departed, so a date that was moved before being deleted
 * still closes the slot it came from.
 */
export const tripSeriesSkips = pgTable(
  "trip_series_skips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => tripSeries.id),
    /** Shop-local calendar date, `YYYY-MM-DD` — the cadence slot being closed. */
    occurrenceDate: text("occurrence_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_series_skips_slot_idx").on(table.seriesId, table.occurrenceDate),
    index("trip_series_skips_shop_idx").on(table.shopId),
  ],
);

/**
 * The agencies a diver's card can be recorded under.
 *
 * Recording only, never gating: nothing in `src/lib/readiness.ts`,
 * `trip-admission.ts`, or the nitrox gate reads the agency — a card clears on
 * its *level* and its verification state, both of which are agency-independent
 * by design, because a CMAS two-star and a PADI Advanced Open Water diver are
 * the same diver at the rail. Widening this list therefore admits no one it did
 * not already admit; it only ends the alternative, which was recording an
 * honest card as "other" (DOM-L1, review 20260802).
 *
 * `bsac` is a national governing body with a full ISO-aligned ladder (Ocean
 * Diver / Sports Diver / Dive Leader / Advanced Diver / First Class Diver) and
 * the most common non-listed card on a Florida or Caribbean boat, on UK visitor
 * traffic alone — it was the omission the first widening still left in place
 * (`dive-domain-expert` review of DOM-L1).
 *
 * Still absent, ranked by how often a shop meets one: IANTD, SEI, ANDI, ACUC,
 * PSAI, NASE. The list is deliberately not exhaustive — see
 * docs/product/glossary.md, "Other agency", for why the honest fix is a
 * free-text companion to `other` rather than an ever-longer enum.
 *
 * `other` stays last for the reader's sake, not the database's — the cert forms
 * render `AGENCY_KEYS` in declaration order, so it is the picker's final option
 * rather than something buried mid-list.
 *
 * `courses.agency` is a **different** field: free text a shop types, and the one
 * `src/lib/course-ratios.ts` reads for the PADI-only entry-level ratio cap. This
 * enum does not reach it.
 */
export const certificationAgency = pgEnum("certification_agency", [
  "padi",
  "ssi",
  "naui",
  "sdi",
  "tdi",
  "cmas",
  "raid",
  "gue",
  "bsac",
  "other",
]);

/**
 * One name for the agency list, so a widening lands everywhere at once.
 *
 * Spelling the union out by hand is how the enum and its readers drift: the
 * three agencies DOM-L1 added had to be typed into five separate literal
 * copies, each of which would have compiled perfectly while silently refusing a
 * card the database accepts.
 */
export type CertificationAgency = (typeof certificationAgency.enumValues)[number];

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
    /** Real alt text, staff-authored; falls back to "{title} — photo N" when blank (H-accessibility). */
    heroImageAlt: text("hero_image_alt"),
    /**
     * The gallery: one object per photo, each carrying its own caption.
     *
     * Replaces the `image_urls` / `image_alts` pair, which were two jsonb
     * arrays lined up by position with nothing enforcing that they stayed the
     * same length — so one drifted row captioned every photo after it with the
     * previous photo's words, silently and only for the readers alt text is for
     * (DATA-L4, review 20260802). One object per photo makes the pairing
     * structural.
     *
     * The `20260806051740_course-gallery-photos` migration backfilled by
     * zipping the two old arrays on index, and it had to choose what to do with
     * a row where they had already drifted: **a url with no matching alt keeps
     * the photo and takes an empty caption; an alt with no matching url is
     * dropped.** A photo is the thing a diver sees, so losing one would visibly
     * change a published page; a caption with no photo has nothing to caption,
     * and keeping it would only re-create the misalignment under a new name.
     * The empty caption it lands on is the same "no caption yet" the editor
     * already writes, and it falls back to the generated "{title} — photo {n}"
     * exactly as a blank always has. Asserted against the shipped SQL in
     * `courses-gallery-backfill.test.ts`.
     *
     * The two old columns are gone: `20260806105408_drop-course-legacy-gallery`
     * dropped them, and nothing has written them since. That migration is the
     * contract half of the expand/contract split
     * (docs/engineering/deploy-and-migrations-runbook.md) and carries the
     * acknowledgement marker `pnpm check:migrations` requires, including what
     * the single-deploy shape of it cost — read it before assuming a drop here
     * is routine.
     */
    galleryPhotos: jsonb("gallery_photos").$type<CourseGalleryPhoto[]>().notNull().default([]),
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
    // Backs the command-palette's courses arm (src/db/search.ts) — a leading
    // wildcard `ilike '%query%'`, which the (shop_id, title) unique btree above
    // cannot serve however tempting it looks: that index answers equality and
    // prefixes, never an interior substring (DATA-L6).
    index("courses_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
  ],
);

/*
 * `course_paths` / `course_path_steps` were dropped here — the shop-built
 * certification progression is gone, catalog order carries what it said
 * (ADR 20260805-remove-certification-paths).
 */

/**
 * The one question that changes what the shop replies with — enrollment,
 * referral to an earlier course, or a card the desk reviews first. Mirrors
 * `CourseInquiryExperience` in src/lib/course-inquiry.ts exactly; keep both
 * in sync on change.
 */
export const courseInquiryExperience = pgEnum("course_inquiry_experience", [
  "never",
  "tried",
  "certified",
  "lapsed",
]);

/**
 * A lead from the public course page's "get in touch" composer
 * (courses/[slug]/_components/CourseInquiry.tsx). Deliberately small: name,
 * email, and phone are each optional (a diver may leave only one way to reach
 * them, or none besides the message itself — the `mailto:` composer stays the
 * fallback for that case), and there is no status/response tracking here —
 * follow-up happens off-platform, in the shop's own inbox, once the
 * notification email lands.
 */
export const courseInquiries = pgTable(
  "course_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    /**
     * The shop's diver this lead belongs to, when that was knowable *at capture
     * time* — resolved by `recordCourseInquiry` from an exact, case-insensitive
     * match of the supplied email against a live person of this shop
     * (`people_shop_email_unique` makes that at most one row, so the link is
     * deterministic, never a guess). Null whenever the writer left no email, or
     * left one no diver of this shop holds — a lead genuinely is written before
     * any person exists, which is why the column is nullable and why nothing
     * downstream may treat null as "nobody".
     *
     * It exists for erasure (ADR 20260802-diver-data-erasure): the sweep's only
     * other handles are the email and phone still sitting on this row, so a
     * diver who later changes their address takes their own lead out of reach.
     * Snapshotting the link at the moment the two addresses did agree is what
     * survives that. Never back-filled by a matching job: a link written later
     * from fuzzier evidence would erase a bystander's lead.
     */
    personId: uuid("person_id").references(() => people.id),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    /** The one field the form requires — see courseInquiryExperience above. */
    experienceLevel: courseInquiryExperience("experience_level").notNull(),
    /** Free prose — "the week of 12 August", "any weekend in the autumn". */
    timing: text("timing"),
    /** How many people, including the writer; null when left blank. */
    divers: integer("divers"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The notification/moderation read: this shop's inquiries, newest first.
    index("course_inquiries_shop_created_idx").on(table.shopId, table.createdAt),
    // "Who's asking about this course" for a course-scoped view.
    index("course_inquiries_course_idx").on(table.courseId),
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
    /**
     * How long a dive here actually spends in the water, in minutes — this
     * site's own answer, overriding the shop's `bottom_time_minutes` wherever
     * the dock-day rhythm is laid over a departure that visits it.
     *
     * Null is the ordinary case and means "the shop's number is right for this
     * site". It exists because the shop-wide figure is a *default*, and a wall
     * a shop runs at 30 metres and a shallow reef it runs at 60 minutes are
     * both real; a single number told a diver the wrong one on at least one of
     * them. Same bounds as the shop's own field (`DOCK_DAY_LIMITS`), enforced
     * by the CHECK below as well as the form, because a dive with no time in
     * it is not a dive.
     */
    expectedBottomTimeMinutes: integer("expected_bottom_time_minutes"),
    currentNote: text("current_note"),
    divePlan: text("dive_plan"),
    landmarks: jsonb("landmarks").$type<string[]>().notNull().default([]),
    /**
     * The underwater route, as waypoints a staffer clicked onto the site's
     * satellite view. Percentages of that view's box (0–100, origin top-left),
     * never latitude/longitude: the briefing draws them into an SVG overlaid
     * on the embed at exactly the same `viewBox`, so a percentage is the
     * coordinate the drawing is actually in. Empty means no route — the
     * briefing shows the plain satellite frame, which is the ordinary case.
     *
     * The frame those percentages refer to is `forecast_latitude` /
     * `forecast_longitude` at `route_zoom`, which is why the editor never lets
     * the map be panned: a route saved against a view the viewer cannot
     * reproduce is a line drawn over the wrong water. See
     * `src/lib/dive-site-route.ts`.
     */
    routePoints: jsonb("route_points").$type<{ x: number; y: number }[]>().notNull().default([]),
    /** What the route is called on the briefing ("Reef garden loop"). */
    routeLabel: text("route_label"),
    /** One line under the label, in the shop's own words. */
    routeNote: text("route_note"),
    /** Google Maps zoom the route was drawn at, and must be rendered at. */
    routeZoom: integer("route_zoom").notNull().default(16),
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
    // Null (the shop's own number applies) or a real duration — never zero,
    // for the same reason `shops_bottom_time_minutes_positive` exists.
    check(
      "dive_sites_expected_bottom_time_positive",
      sql`${table.expectedBottomTimeMinutes} is null or ${table.expectedBottomTimeMinutes} > 0`,
    ),
    // Backs the command-palette leading-wildcard ILIKE search (src/db/search.ts, CR-018).
    index("dive_sites_name_trgm_idx").using("gin", sql`${table.name} gin_trgm_ops`),
    // The site library's own search box matches a place as well as a name
    // ("Key Largo") — `listDiveSitesPage` in src/db/dive-sites.ts ors the two,
    // and only the name half was indexed (DATA-L6).
    index("dive_sites_location_trgm_idx").using("gin", sql`${table.locationName} gin_trgm_ops`),
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
    /**
     * The cadence slot this instance was materialized for, as a shop-local
     * `YYYY-MM-DD` — set with `series_id` and never afterwards. It is what makes
     * a horizon roll idempotent: the roll asks "which of these dates already
     * has an instance?", and the answer must survive staff sliding the
     * departure to another day. Keying off `starts_at` instead would report the
     * moved-from slot as empty and re-create the departure staff just moved.
     */
    seriesOccurrenceDate: text("series_occurrence_date"),
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
    /**
     * Always Celsius regardless of the shop's `temperature_unit`, and
     * floating-point for the same reason `dive_sites.max_depth_meters` is:
     * crew type whole degrees in their own unit, and 76°F is 24.44°C. Stored
     * as an integer it read back as 76°F for one shop and 75°F for the next
     * save; stored as a float it round-trips exactly (src/lib/temperature-units.ts).
     */
    waterTemperatureC: doublePrecision("water_temperature_c"),
    /** Always metres regardless of `depth_unit`; floating-point for the same round-trip reason. */
    visibilityMeters: doublePrecision("visibility_meters"),
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
    // The daily cron's two cross-shop window scans (DATA-M2). Both sweep every
    // shop at once, so `trips_shop_starts_idx` above cannot serve either — its
    // leading column is the one column these two do not constrain.
    //
    // `status` leads because both queries pin it to a single value
    // (`= 'scheduled'`) and then take a *range* on the timestamp, which is the
    // only column order Postgres can walk as one index scan; a bare
    // `(starts_at)` index would have to read every trip in the window across
    // every shop and re-check `status` per row.
    //
    // `sendDueReminders` (src/db/reminders.ts): scheduled trips departing
    // between now and the reminder horizon.
    index("trips_status_starts_idx").on(table.status, table.startsAt),
    // `sendDueRecaps` (src/db/recap.ts): scheduled trips that came home inside
    // the recap lookback — the same shape one column over, on `ends_at`.
    index("trips_status_ends_idx").on(table.status, table.endsAt),
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
    /**
     * Set on every seat of a party booking *except* the organizer's own,
     * pointing at the organizer's booking on the same trip (docs ADR
     * 20260804-seat-claim-links). This is what makes "the other seats of my
     * party" a queryable fact: the organizer's surfaces list these rows to
     * mint claim links and show who has claimed. Cleared whenever a
     * previously-cancelled row is reactivated by a *new* booking
     * (`createBookingRecord`), so a seat's stale party membership from an
     * earlier life can never leak a claim link over somebody else's fresh
     * booking. Not a typed FK: the reference is to this same table, and a
     * self-referencing `references()` trips drizzle's type inference the same
     * way the mutual `pending_checkout_intent_id` reference above does.
     */
    partyLeadBookingId: uuid("party_lead_booking_id"),
    /**
     * When a party member claimed this seat as their own through a
     * `/claim/[token]` link — identity re-pointed to the claimant's person
     * row, their own waiver/prep started. Null means the seat still rides
     * under whatever the organizer typed, which stays perfectly valid to
     * board: claiming is an upgrade, never a requirement (same ADR).
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("bookings_trip_person_unique").on(table.tripId, table.personId),
    index("bookings_trip_idx").on(table.tripId),
    /** Backs the diver-record lookups (getDiverProfile, payment/booking history joins). */
    index("bookings_shop_person_idx").on(table.shopId, table.personId),
    /** Backs the organizer's "who has claimed" panel — member seats by their lead. */
    index("bookings_party_lead_idx").on(table.partyLeadBookingId),
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
    /**
     * The order these were written in, for reading a trail whose timestamps tie.
     *
     * `occurred_at` alone cannot order this table: two events recorded in one
     * request share an instant (a note delete writes its own event beside the
     * one the add left), and the e2e clock is frozen outright, so *every* event
     * in a test carries the identical timestamp. With nothing to break the tie
     * Postgres returns whatever the heap hands back — which changes the moment
     * anything moves rows, and a `VACUUM` does. The trail then reads
     * backwards: "deleted a private note" above the "added" it followed.
     *
     * `id` cannot stand in for this — it is `defaultRandom()`, so ordering by
     * it is as arbitrary as the heap and merely arbitrary *consistently*. A
     * sequence is the only thing here that records what actually came first.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
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

/**
 * A diver-facing, self-serve bearer link to unsubscribe one last-minute-list
 * entry (docs features/story-backlog.md "Leo — self-serve email unsubscribe"). A fresh
 * token is minted for every deal blast rather than one stable token per entry
 * (mirrors `bookingCapabilities`, not `calendarFeeds`), so an old email's link
 * keeps working even after a later blast mints another — deliberately never
 * expires: an expired unsubscribe link would leave someone unable to opt out,
 * silently, the same reasoning `createBearerToken`'s calendar-feed case
 * documents. Consuming a token only ever sets `unsubscribedAt`, an idempotent
 * write, so unlike `bookingCapabilities`/`accountTokens` there is nothing to
 * mark used or revoke.
 */
export const lastMinuteListUnsubscribeTokens = pgTable(
  "last_minute_list_unsubscribe_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => lastMinuteListEntries.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("last_minute_list_unsubscribe_tokens_token_hash_idx").on(table.tokenHash),
    index("last_minute_list_unsubscribe_tokens_entry_idx").on(table.entryId),
  ],
);

/**
 * A diver-facing, self-serve bearer link to opt one person out of courtesy
 * email — `waitlist_invite` and `trip_recap`, the two kinds `people.courtesyEmailOptOutAt`
 * governs (docs features/story-backlog.md "Leo — self-serve email unsubscribe"). Same
 * shape and reasoning as `lastMinuteListUnsubscribeTokens`: a fresh token per
 * send rather than one stable token per person, never expires, and consuming
 * it is an idempotent write (only ever sets `courtesyEmailOptOutAt`) — kept as
 * a separate table rather than folded into `lastMinuteListUnsubscribeTokens`
 * because it resolves to a person, not a last-minute-list entry.
 */
export const personCourtesyEmailUnsubscribeTokens = pgTable(
  "person_courtesy_email_unsubscribe_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("person_courtesy_email_unsubscribe_tokens_token_hash_idx").on(table.tokenHash),
    index("person_courtesy_email_unsubscribe_tokens_person_idx").on(table.personId),
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
     * What the checkout this code was spent on actually settled for, as Stripe
     * reported it (`booking_checkouts.settled_total_cents`) — the money the
     * shop received with this code applied. Recording it is not DiveDay
     * re-deriving a discount it does not own: the number is copied verbatim
     * from Stripe's own `amount_total`, which is why this column may hold it.
     * Falls back to the checkout's quoted (pre-discount) total when no settled
     * figure exists — a historical row, or a completion Stripe reported no
     * total for.
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
    currency: text("currency").notNull(),
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

/**
 * What caused one `booking_payments` transition. A code, never a sentence —
 * the UI picks the words (docs ADR 20260731-domain-layer-copy-leaks).
 *
 * `manual_mark` is the fallback for an unannotated write, which is exactly
 * what such a write is: a staff member setting the status by hand from the
 * roster or the diver record. Every machine writer states its own operation.
 */
export const paymentEventOperation = pgEnum("payment_event_operation", [
  /** Staff set the status by hand (roster payment control, diver record). */
  "manual_mark",
  /** A Stripe Checkout session settled and cascaded onto its covered bookings. */
  "checkout_settled",
  /** A Stripe invoice (staff order) reported paid. */
  "order_settled",
  /** A staff order was refunded through Stripe. */
  "order_refunded",
  /** The automated cancellation-window refund reversed a Stripe capture. */
  "cancellation_refund",
]);

/**
 * Append-only money history for one booking — one row per **transition** of
 * its `booking_payments` state (DATA-M3, ADR 20260803-booking-payment-events).
 *
 * `booking_payments` is a single mutable row: a refund overwrites the capture
 * it reverses, so before this table the only record that a booking was ever
 * paid — and for how much, in which currency, against which Stripe object —
 * lived at Stripe. This is DiveDay's own ledger of the same facts, written
 * inside the *same transaction* as every `booking_payments` mutation (there is
 * one funnel, `setBookingPayment` in src/db/payments.ts), so a row here and the
 * current row can never disagree about what happened.
 *
 * Shaped like the repo's other append-only trails (`roll_call_events`,
 * `activity_events`): nothing is ever updated or deleted in place, the newest
 * row for a booking restates its current state, and a correction is a further
 * row rather than a rewrite.
 *
 * **Transitions, not writes.** A write that changes nothing material — a
 * replayed Stripe webhook re-running its self-healing cascade over an
 * already-settled booking — appends no row, so the trail stays a readable
 * history instead of a delivery log. `setBookingPayment` compares against the
 * current row and skips the append when status, amount, currency, provider,
 * provider reference and note are all unchanged.
 *
 * **Refusals are not here.** `setBookingPaymentIfNotFinal` swallowing a lesser
 * status over a refunded/waived row (or over a cancelled booking) mutates
 * nothing, so it appends nothing; those refusals are already reported as
 * `payment.refused_*` log lines.
 */
export const bookingPaymentEvents = pgTable(
  "booking_payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * `onDelete: "cascade"` on both parents, unlike `booking_payments`, whose
     * rows the demo reaper and demo-schedule reset each clear by hand from
     * their own topologically-sorted child-first lists (src/db/seed.ts). A
     * trail row describes exactly one booking of exactly one shop and has no
     * meaning once that booking is gone, and the two hand-maintained lists are
     * precisely where a forgotten child surfaces as an FK violation mid-reap.
     * The same reasoning `internal_notes.booking_id` and
     * `activity_events.trip_id` already use.
     */
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    /** The state this transition moved the booking's payment *to*. */
    status: paymentStatus("status").notNull(),
    /**
     * The state it moved *from*. Null means there was no `booking_payments`
     * row yet — this is the booking's first-ever payment event, not a
     * transition out of `unpaid` that somebody recorded.
     */
    previousStatus: paymentStatus("previous_status"),
    /**
     * Money recorded by this transition, in `currency`'s minor unit. Null
     * carries `booking_payments.amount_cents`'s own meaning: no amount was
     * stated — a waiver, or a mark made without one — which is not the same
     * as zero (a refund that reversed nothing).
     */
    amountCents: integer("amount_cents"),
    /**
     * ISO 4217, lowercase, copied from the mutation that caused this row.
     * No default on purpose: an amount whose currency was guessed is not
     * evidence (docs ADR 20260731-shop-currency), and every writer of
     * `booking_payments` already states it.
     */
    currency: text("currency").notNull(),
    /** Provider that moved the money, e.g. "stripe"; null for a manual mark. */
    provider: text("provider"),
    /** The provider object this transition points at (session, invoice, refund). */
    providerRef: text("provider_ref"),
    /** What caused it. See {@link paymentEventOperation}. */
    operation: paymentEventOperation("operation").notNull(),
    /** Whatever note the mutation carried; null when it carried none. */
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /**
     * Backs `listBookingPaymentEvents` (src/db/payments.ts) — one booking's
     * money history for one shop, newest first. Shop-scoped leading column so
     * the tenant predicate is index-served, exactly like
     * `roll_call_events_shop_trip_checkpoint_booking_occurred_idx`.
     */
    index("booking_payment_events_shop_booking_occurred_idx").on(
      table.shopId,
      table.bookingId,
      table.occurredAt,
    ),
    check(
      "booking_payment_events_amount_nonnegative",
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
  // The weather blow-out cascade message: the cancellation, the diver's money
  // story, and the alternatives they qualify for (ADR 20260804-blowout-cascade).
  "trip_blowout",
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
 * whether our own send call succeeded. Reported by the delivery webhook
 * (20260726-hosted-mailboxes-for-platform-mail, 20260803-ses-sole-email-provider);
 * null until an event arrives, which is the normal steady state when no
 * webhook is configured.
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

/**
 * Singleton team-wide permit clock for a provider needing coordinated
 * per-second throttling. Currently unused — SES's own SDK retry/backoff
 * covers that need (20260803-ses-sole-email-provider) — kept as generic,
 * provider-keyed infrastructure rather than dropped.
 */
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
    /**
     * The connected account's own settlement currency (Stripe's
     * `default_currency`, e.g. "usd", "eur"), refreshed alongside the status
     * flags above. Defaults "usd" for a not-yet-refreshed row so every
     * existing caller keeps working unchanged. Consumers that show a diver a
     * currency symbol (recap tipping) or charge a card must read this instead
     * of a hardcoded "$"/"usd" (task 60) — full multi-currency support
     * elsewhere (orders, checkouts, invoicing) is still deferred (task 35).
     */
    defaultCurrency: text("default_currency").notNull().default("usd"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set on an OAuth deauthorize webhook; a later reconnect clears it. */
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("shop_stripe_accounts_stripe_account_unique").on(table.stripeAccountId)],
);

/**
 * A shop's own WhatsApp Business sender, connected through Meta's Cloud API
 * (docs ADR 20260802-whatsapp-cloud-api-per-shop). The courtesy text that rides
 * with a trip reminder or recap goes out from *this* number when a row exists,
 * so the diver sees the dive shop they booked with instead of an unfamiliar
 * short code; with no row, the channel falls back to platform SMS.
 *
 * One row per shop, and disconnecting **deletes** it rather than tombstoning
 * like `shop_stripe_accounts.disconnected_at` does. The difference is what the
 * row holds: a Stripe account id is a public identifier worth keeping for
 * history, while the access token here is a live credential that can send as
 * the business. Once a shop says "disconnect", the safest thing to hold is
 * nothing.
 */
export const shopWhatsappAccounts = pgTable("shop_whatsapp_accounts", {
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id),
  /** Meta's id for the sending number — the path segment of the Cloud API send endpoint. */
  phoneNumberId: text("phone_number_id").notNull(),
  /** The human-readable number Meta reports for it, shown back to staff for confirmation. */
  displayPhoneNumber: text("display_phone_number"),
  /** The WhatsApp Business Account the number belongs to; recorded for support, never sent. */
  wabaId: text("waba_id"),
  /**
   * The shop's Meta access token, sealed with AES-256-GCM (`src/lib/secret-box.ts`)
   * — never plaintext. This column is the reason `SECRET_ENCRYPTION_KEY` exists:
   * a token here can send messages as the shop's business, so a database dump
   * must not be enough to use it.
   */
  accessTokenSealed: text("access_token_sealed").notNull(),
  /**
   * The six-digit PIN this number was registered with during Embedded Signup,
   * sealed like the token. DiveDay generates it — the shop never types it — but
   * Meta demands the same PIN for any later re-registration, and a shop that
   * cannot re-register is a shop locked out of its own number.
   */
  registrationPinSealed: text("registration_pin_sealed"),
  /**
   * The approved template courtesy messages are sent through, and its Meta
   * language code. Stored per shop rather than hard-coded: WhatsApp requires
   * business-initiated messages to use a template the *shop* got approved, and
   * a shop whose review went through under a different name must still work.
   */
  templateName: text("template_name").notNull(),
  templateLanguage: text("template_language").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set by the settings page's test send, so staff can see the connection was proven, not just saved. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shopBackupDestinations = pgTable("shop_backup_destinations", {
  /** One destination per shop, like `shop_whatsapp_accounts` — reconfiguring is an upsert, never a second row. */
  shopId: uuid("shop_id")
    .primaryKey()
    .references(() => shops.id),
  /**
   * The S3-compatible API origin the weekly bundle is PUT to — AWS S3, Cloudflare
   * R2, Backblaze B2, MinIO, anything speaking SigV4. HTTPS only, and never a
   * loopback/private host; `src/features/backup-export` refuses those before a
   * row is written (the server is the one making this request).
   */
  endpoint: text("endpoint").notNull(),
  /** The SigV4 signing region ("us-east-1", "auto" for R2). Part of the signature, not routing. */
  region: text("region").notNull(),
  bucket: text("bucket").notNull(),
  /** Optional key prefix inside the bucket ("diveday/"); empty means the bucket root. */
  prefix: text("prefix").notNull().default(""),
  /**
   * The credential's public identifier. Stored plain — it names the key the
   * way a Stripe account id names an account — and shown back to staff so they
   * can tell which credential is connected.
   */
  accessKeyId: text("access_key_id").notNull(),
  /**
   * The secret access key, sealed with AES-256-GCM (`src/lib/secret-box.ts`) —
   * never plaintext, exactly like `shop_whatsapp_accounts.access_token_sealed`.
   * It is a live credential to storage the shop owns; a database dump must not
   * be enough to use it, and no code path ever returns it to a caller or a UI.
   */
  secretAccessKeySealed: text("secret_access_key_sealed").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set when a delivery has actually landed in the bucket, so staff see proven rather than merely saved. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const backupDeliveryStatus = pgEnum("backup_delivery_status", [
  "started",
  "succeeded",
  "failed",
]);

export const backupDeliveryTrigger = pgEnum("backup_delivery_trigger", ["scheduled", "manual"]);

/**
 * One row per backup delivery attempt — the shop-visible answer to "when did
 * my data last actually land in my bucket". Append-only: a row is inserted as
 * `started` and finished in place as `succeeded`/`failed`, so a crash
 * mid-delivery leaves an honest `started` row rather than silence.
 * `error_code` carries a code, never a sentence — the UI picks the words
 * (ADR 20260731-domain-layer-copy-leaks).
 */
export const shopBackupDeliveries = pgTable(
  "shop_backup_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * The ISO week this delivery covers ("2026-W32"). The weekly cron skips a
     * shop that already has a succeeded scheduled delivery for the period, so a
     * re-invoked cron never uploads the same week twice.
     */
    periodKey: text("period_key").notNull(),
    trigger: backupDeliveryTrigger("trigger").notNull(),
    status: backupDeliveryStatus("status").notNull(),
    /** Where in the bucket the bundle went (prefix included); null until the key is computed. */
    objectKey: text("object_key"),
    /** Uploaded bundle size in bytes; bigint because a photo-heavy shop clears 2 GiB. */
    byteCount: bigint("byte_count", { mode: "number" }),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("shop_backup_deliveries_shop_started_idx").on(table.shopId, table.startedAt),
    index("shop_backup_deliveries_shop_period_idx").on(table.shopId, table.periodKey),
  ],
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
    currency: text("currency").notNull(),
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
    /** Backs listOrdersForPerson — the person-first diver workspace's payment history. */
    index("orders_shop_person_idx").on(table.shopId, table.personId),
    // Backs the command-palette's orders arm, which searches an order's own
    // description alongside the payer's name (src/db/search.ts) — a leading
    // wildcard, so only a trigram GIN index can serve it (DATA-L6). The payer
    // half of that `or` already rides `people_full_name_trgm_idx`; this is the
    // half that was scanning every order the shop has ever written.
    index("orders_description_trgm_idx").using("gin", sql`${table.description} gin_trgm_ops`),
    check("orders_total_nonnegative", sql`${table.totalCents} >= 0`),
    check("orders_amount_paid_nonnegative", sql`${table.amountPaidCents} >= 0`),
  ],
);

/**
 * A ledger of every Stripe webhook event this app has ever accepted, keyed by
 * Stripe's own globally-unique event id. The row does **two separate jobs**,
 * and they are deliberately carried by two different columns:
 *
 *  1. **The dedup claim** — `claimed_at`. `POST /api/webhooks/stripe` claims an
 *     event here before doing anything else, so a redelivered event is a no-op
 *     before it ever reaches a handler; belt-and-suspenders on top of each
 *     handler's own idempotent state machine (docs ADR
 *     20260719-stripe-connect-orders). A handler that throws *releases* the
 *     claim (`claimed_at` back to null) so Stripe's own retry genuinely
 *     re-reaches the handler (PAY-M1).
 *  2. **Chronological evidence** — `occurred_at`, Stripe's own event-creation
 *     time (not when we received it), which lets the `account.updated` handler
 *     — otherwise pure last-write-wins — refuse to apply an event that is
 *     chronologically older than one already delivered for the same connected
 *     account (`hasNewerAccountUpdate`).
 *
 * The row is therefore **never deleted**: releasing a claim nulls `claimed_at`
 * and leaves the evidence standing. Deleting it instead would erase job 2 to
 * do job 1, and a *different*, older `account.updated` would then read as
 * fresh and regress `charges_enabled` — fail-open on the flag that gates order
 * and checkout creation.
 */
export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    /** The connected account the event happened on; null for platform-only events. */
    account: text("account"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When this event's handling was claimed. Non-null means "claimed, and
     * treat every redelivery as a duplicate"; null means the delivery was
     * attempted, the handler failed, and the claim was given back so a
     * redelivery re-runs it. The row itself survives either way — it is still
     * the evidence that an event with this `occurred_at` was delivered.
     *
     * Defaulted rather than left bare so the column's arrival backfills every
     * pre-existing row as claimed (Postgres applies an `ADD COLUMN` default to
     * existing rows): those events were all handled successfully under the
     * old model, and a migration must not silently re-open them to redelivery.
     */
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("stripe_webhook_events_account_type_idx").on(table.account, table.type, table.occurredAt),
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
     * The shop-wide promo code handed to Stripe on this attempt, if any. This
     * is what a completed checkout records a redemption against (docs ADR
     * 20260729-shop-promo-codes). Null for an undiscounted checkout and for a
     * trip-scoped last-minute deal, which has its own row and lands on
     * `trip_promo_id` below instead.
     */
    promoCodeId: uuid("promo_code_id").references(() => shopPromoCodes.id),
    /**
     * The trip-scoped last-minute deal handed to Stripe on this attempt, if any
     * (docs ADR 20260727-last-minute-fill-promos). The counterpart to
     * `promo_code_id`: at most one of the two is ever set, because the caller
     * resolves a trip deal *or* a shop-wide code, never both — a check
     * constraint below holds that. Null on every row written before this column
     * existed, including ones that did apply a trip deal; see
     * `applied_discount_percent`.
     */
    tripPromoId: uuid("trip_promo_id").references(() => tripLastMinutePromos.id),
    /**
     * The code text the diver actually typed, from whichever of the two sources
     * above it resolved against. A snapshot, so a later edit or delete of the
     * code can't rewrite what this diver was quoted.
     */
    promoCode: text("promo_code"),
    /**
     * Percent off, as applied to *this* session at the moment it was created —
     * the one figure that makes the discount reconstructible later without
     * asking Stripe anything (PAY-M3). Both promotion flavors are percent-only
     * by house rule (`trip_last_minute_promos_discount_range` 5..90,
     * `shop_promo_codes_discount_range` 1..100) and neither restricts the
     * coupon to particular line items, so a single percent describes the whole
     * discount on the whole session, gear lines included.
     *
     * Written only when a promotion code was genuinely handed to Stripe, never
     * merely because one was available, and never re-derived afterwards from
     * whatever promo happens to be live on the trip — that would discount
     * full-price divers on a promoted trip and under-refund people who owe
     * nothing.
     *
     * Null means "no discount snapshot exists": an undiscounted checkout, or a
     * row written before this column existed. Those older rows keep the
     * conservative pre-column behaviour — a shop-wide code is still
     * reconstructible from `promo_code_id`, and anything else falls back to the
     * asked total (`attributableTotalCents`, src/db/checkouts.ts). A completion
     * is never refused and never recorded as zero for want of this figure.
     */
    appliedDiscountPercent: integer("applied_discount_percent"),
    currency: text("currency").notNull(),
    /** Price snapshot at checkout time, so a later trip re-price never rewrites what was asked. */
    amountPerDiverCents: integer("amount_per_diver_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /**
     * What actually *settled*, as Stripe itself reported it on the completed
     * session (`amount_total`) — the counterpart to `totalCents` above, which
     * is what DiveDay *asked* for. The two differ whenever Stripe applied a
     * discount, so this is the only figure a refund or a revenue report may
     * treat as money the shop received. Null means no settled figure exists:
     * a row predating this column, a checkout that never completed, or a
     * completion where Stripe reported no total — callers fall back to the
     * asked amounts rather than treating null as zero.
     */
    settledTotalCents: integer("settled_total_cents"),
    /**
     * True when the amount charged is a deposit (a balance is still due), so a
     * completed session settles the covered bookings to `deposit_paid` rather
     * than `paid`. False (the default) is the full-fare checkout.
     */
    isDeposit: boolean("is_deposit").notNull().default(false),
    /** Stripe expires unfinished Checkout sessions; kept so the UI can be honest about a dead link. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * When Stripe reported this session's delayed-notification payment
     * *failed* (`checkout.session.async_payment_failed`, PAY-L1). Null is the
     * normal state and means only "no failure was reported" — not that the
     * payment succeeded.
     *
     * A session whose async payment failed can no longer be paid, so the row's
     * `status` moves to `expired`, the existing terminal for "this local
     * checkout is no longer payable": recovery emails stop
     * (`dueCheckoutRecovery`), a later completion cannot resurrect it
     * (`markCheckoutPaidBySessionId`'s disqualification check), and no
     * `booking_payments` row is touched because none was ever written for an
     * unsettled async payment. This column is what keeps the two causes apart —
     * a session that simply timed out unpaid versus one whose payment was
     * attempted and bounced — without adding a `checkout_status` value that
     * every consumer of that enum would have to learn
     * (ADR 20260803-async-payment-failed).
     */
    asyncPaymentFailedAt: timestamp("async_payment_failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_checkouts_stripe_session_unique").on(table.stripeSessionId),
    index("booking_checkouts_shop_trip_idx").on(table.shopId, table.tripId),
    check("booking_checkouts_amount_per_diver_nonnegative", sql`${table.amountPerDiverCents} >= 0`),
    check("booking_checkouts_total_nonnegative", sql`${table.totalCents} >= 0`),
    check(
      "booking_checkouts_settled_total_nonnegative",
      sql`${table.settledTotalCents} is null or ${table.settledTotalCents} >= 0`,
    ),
    // The snapshot of what Stripe was told to take off this session. Bounded to
    // a real percentage so a corrupt value can never reconstruct a *larger*
    // attributable total than was asked for — 1..100 spans both flavors'
    // own ranges (trip deals 5..90, shop-wide codes 1..100).
    check(
      "booking_checkouts_applied_discount_range",
      sql`${table.appliedDiscountPercent} is null or ${table.appliedDiscountPercent} between 1 and 100`,
    ),
    // A checkout applies a trip-scoped deal *or* a shop-wide code, never both:
    // the caller resolves them in that order and stops at the first hit, and
    // Stripe Checkout accepts one promotion code per session anyway. Held here
    // so no future caller can quietly record two and leave the reconstruction
    // guessing which percent was the one Stripe applied.
    check(
      "booking_checkouts_single_promo_source",
      sql`${table.promoCodeId} is null or ${table.tripPromoId} is null`,
    ),
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
    /**
     * This diver's priced rental-gear subtotal on this checkout, snapshotted
     * at checkout-creation time (docs ADR 20260801-checkout-upsells-rental-gear).
     * 0 means either no gear was chosen or (for a historical row predating
     * this column) gear was never part of checkout — both read the same way:
     * nothing to attribute to gear for this diver on this payment.
     */
    gearCents: integer("gear_cents").notNull().default(0),
  },
  (table) => [
    uniqueIndex("booking_checkout_bookings_checkout_booking_unique").on(
      table.checkoutId,
      table.bookingId,
    ),
    index("booking_checkout_bookings_booking_idx").on(table.bookingId),
    check("booking_checkout_bookings_gear_cents_nonnegative", sql`${table.gearCents} >= 0`),
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
    currency: text("currency").notNull(),
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
  (table) => [
    index("payment_operation_intents_shop_status_idx").on(table.shopId, table.status),
    // `claimBookingsForCheckout`'s stale-intent sweep (src/db/payment-operations.ts,
    // DATA-M1) runs on every checkout click and is deliberately cross-shop, so
    // the `(shop_id, status)` index above cannot serve it at all. Partial on
    // `status = 'started'` because that is the only status the sweep ever looks
    // at and it is a vanishing slice of the table — every intent resolves within
    // one Stripe round trip, so the index stays a handful of rows wide however
    // large the resolved history grows.
    //
    // `kind` leads the key: the sweep pins it (`= 'checkout_session'`) and then
    // takes a range on `started_at`, so equality-before-range is the order a
    // single index scan can walk. (The review that raised DATA-M1 prescribed a
    // bare `(started_at)`; the query also filters `kind`, and including it costs
    // nothing on an index this small.)
    index("payment_operation_intents_stale_scan_idx")
      .on(table.kind, table.startedAt)
      .where(sql`${table.status} = 'started'`),
  ],
);

/** Staff crewing a trip (captain, DM, instructor…). Roles live on person_roles. */
/**
 * What a person is rostered to do on **one trip**. A deliberate subset of
 * `person_role` — `owner`, `manager`, and `diver` are standing facts about a
 * person, never a job on a boat. Keep aligned with `TRIP_CREW_ROLES` in
 * src/lib/crew-roles.ts.
 */
export const tripAssignmentRole = pgEnum("trip_assignment_role", [
  "instructor",
  "divemaster",
  "captain",
  "crew",
]);

export const tripAssignments = pgTable(
  "trip_assignments",
  {
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /**
     * The job this person is doing on this sailing, or null for **not
     * specified** (DOM-M3, ADR 20260803-per-trip-crew-role).
     *
     * Null is the status quo, not a safety claim. Roles are otherwise
     * shop-wide (`person_roles`), so a divemaster rostered as this trip's boat
     * captain still counted as an in-water certified assistant and raised the
     * supervision-ratio capacity by two per head. Every row written before
     * this column existed is null and must keep counting exactly as it did —
     * by shop-wide inference (`inWaterCrewRole`, src/lib/crew-roles.ts).
     *
     * The role can only ever *narrow* what a person is worth to the ratio: it
     * says which job they are doing, while `person_roles` stays the evidence
     * of what they are qualified to do. A roster is a scheduling document and
     * must never be able to mint a credential.
     */
    tripRole: tripAssignmentRole("trip_role"),
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
     * Where the shop was standing when the record was filed, when that was
     * anywhere in particular. `personId` below is what actually satisfies the
     * sign-once gate, on this booking and every other.
     *
     * Null on two paths, both of which have no seat to name: an imported
     * record (`signatureMethod: "imported"` — a contact import creates people,
     * not bookings), and a staff-attested paper release recorded from the
     * diver's own record, where the conversation is about the person and they
     * may hold no booking at all (ADR 20260811-person-scoped-paper-waivers).
     * Every record a *token* can reach still carries one — see
     * `requireTokenBookingId`.
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
    /**
     * Set when this record was stripped of the signer's name, medical answers,
     * and source documents as part of erasing the diver
     * (ADR 20260802-diver-data-erasure), and re-sealed under integrity
     * **version 2** — the HMAC over exactly the fields that survive erasure.
     * A v1 seal covers `signed_name` and `medical_answers`, so a stripped
     * record can never verify against it; without the re-seal every erased
     * release would read as *tampered* rather than as *erased*. Stamped in the
     * same statement as the strip, and part of the v2 metadata itself, so the
     * erasure is inside the seal rather than an unsealed annotation beside it.
     */
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    /** The shop owner who ordered the erasure — see `people.anonymized_by_person_id`. */
    anonymizedByPersonId: uuid("anonymized_by_person_id").references(() => people.id),
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
 * page reached right after booking; `claim` lets one party member take over
 * one specific seat of a party booking as their own identity
 * (`/claim/[token]`, docs ADR 20260804-seat-claim-links) — minted only for
 * non-organizer party seats, and every live `claim` row for a booking is
 * revoked the moment any one of them is used, so a claim link is one-shot in
 * effect. All are read+write for their purpose — split into separate purposes
 * (not separate read/write tokens) because no purpose's read and write
 * lifetimes differ in practice.
 */
export const bookingCapabilityPurpose = pgEnum("booking_capability_purpose", [
  "readiness",
  "confirm",
  "claim",
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
    //
    // **Some agencies issue no standalone nitrox card.** RAID and GUE bundle
    // EANx into the level card itself — RAID Open Water 20 and GUE Rec 1 both
    // certify enriched air — so there is no separate number to type here, and
    // the honest entry is the *level* card's own number (docs/product/
    // glossary.md, "Nitrox card"). That works by construction: the index is
    // keyed per agency and per table, so the same number living on a
    // `certifications` row and this one is not a collision. It is written down
    // because it looks like a mistake to whoever does it, and the two things a
    // staffer does instead — refuse a fill to a properly trained diver, or hand
    // the tank over off-system — are both worse.
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
 * The crew half of a checkpoint's head count: how many crew a staff member
 * says are aboard, out of how many the trip has assigned. Append-only, exactly
 * like `rollCallEvents` — a later attestation supersedes an earlier one without
 * rewriting it, so what the boat believed at each point stays readable.
 *
 * Its own table rather than a widened `rollCallEvents` deliberately (ADR
 * 20260802-crew-roll-call-attestation). `rollCallEvents.bookingId` is
 * `notNull` and is the only subject column there; crew hold no booking, so
 * carrying them would have meant making that column nullable — weakening a NOT
 * NULL invariant on the safety spine so that a *diver* event could also be
 * written with no subject at all. The subject shapes differ (one booking vs. a
 * count over a trip's assignments), so they are separate rows.
 *
 * It stays the **count-level** record now that `rollCallCrewEvents` below adds
 * the per-person one (ADR 20260803-per-person-crew-roll-call, the follow-on
 * 20260802 anticipated). The two answer different questions and a checkpoint
 * needs both: the events say every *named* crew member is accounted for, and
 * the attestation is the only thing that can speak for a hand nobody rostered
 * — or for a trip with an empty assignment list, where "0 of 0" is still a
 * sentence a human has to say out loud.
 */
export const rollCallCrewAttestations = pgTable(
  "roll_call_crew_attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    /** `departure` or `after_dive_N`; validated against the trip's planned dive count. */
    checkpoint: text("checkpoint").notNull(),
    /** Bodies counted on the boat. Typed by a human, never derived from the assignment list. */
    crewAboard: integer("crew_aboard").notNull(),
    /**
     * How many crew the trip had assigned when this was attested — evidence of
     * what the denominator was at the time. Completeness compares against the
     * *current* assignment count, so assigning another crew member re-opens the
     * checkpoint rather than riding on a stale attestation.
     */
    crewAssigned: integer("crew_assigned").notNull(),
    /** Who counted. A head count is never anonymous, same as a roll-call event. */
    attestedByPersonId: uuid("attested_by_person_id")
      .notNull()
      .references(() => people.id),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("roll_call_crew_attestations_shop_trip_checkpoint_occurred_idx").on(
      table.shopId,
      table.tripId,
      table.checkpoint,
      table.occurredAt,
    ),
  ],
);

/**
 * The per-person half of the crew head count: one staff member said one
 * **assigned crew member** is aboard, not aboard, or cleared, at one
 * checkpoint. Append-only history, exactly like `rollCallEvents` — the newest
 * row per person per checkpoint is the current answer and nothing is rewritten
 * (ADR 20260803-per-person-crew-roll-call).
 *
 * Its own table rather than a widened `rollCallEvents`, for the same reason
 * `rollCallCrewAttestations` is (ADR 20260802): carrying crew there would have
 * meant making `booking_id` nullable, weakening a NOT NULL invariant on the
 * safety spine so a *diver* event could be written with no subject at all. The
 * subjects genuinely differ — a booking is a paid seat, an assignment is a
 * roster line — so they are separate rows, and each table's subject column
 * stays `notNull`.
 *
 * `person_id` is the subject; `recorded_by_person_id` is who said so. They are
 * routinely the same human (a divemaster boarding herself) and that is fine —
 * the point is that the count names somebody, not that a second person
 * witnesses it.
 *
 * No `source`/`client_event_id`: crew roll call is **not recordable offline**
 * in this slice, so there is no device-generated event to deduplicate. The
 * offline snapshot carries these results read-only and fails closed when they
 * are absent (see `OFFLINE_MANIFEST_RECORD_VERSION`, src/lib/offline-manifests.ts).
 *
 * Tenancy: `shop_id` is carried here (unlike `trip_assignments`, CR-007) so a
 * read never has to reach through `trips` to know whose row it is — the same
 * shape `roll_call_events` already has. Writers still prove the *subject* is
 * assigned to the trip, joining through `trips`.
 */
export const rollCallCrewEvents = pgTable(
  "roll_call_crew_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    /** The crew member this is about — a `trip_assignments` row's person. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    status: rollCallStatus("status").notNull(),
    /** `departure` or `after_dive_N`; validated against the trip's planned dive count. */
    checkpoint: text("checkpoint").notNull(),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("roll_call_crew_events_shop_trip_checkpoint_person_occurred_idx").on(
      table.shopId,
      table.tripId,
      table.checkpoint,
      table.personId,
      table.occurredAt,
    ),
  ],
);

/**
 * Buddy teams: staff group a departure's roster the way it will dive, so roll
 * call can read "someone is back aboard and someone on their team is not" as a
 * first-class state instead of a flat list (ADR 20260804-buddy-teams).
 *
 * One row per **member**, two or more rows per team, sharing a `pair_id` (the
 * physical name predates the model; every word a human reads says "team"). Not
 * a team-per-row table with member columns, deliberately: the invariant that
 * matters is *a booking is in at most one team*, and the unique index on
 * `booking_id` enforces it at the database, under concurrency — a
 * columns-per-member shape cannot (a booking can sit in column A of one row and
 * column B of another and satisfy both column uniques), and it could not hold a
 * team of four at all.
 *
 * A member is a seated diver **or** a crew person, exactly one of the two (the
 * check constraint below). Crew carry no uniqueness rule on purpose: one
 * divemaster commonly leads several groups on one boat.
 *
 * The writers live in src/db/buddy-pairs.ts, one per act, each writing every
 * row it needs in one transaction. Dissolving deletes the membership rows —
 * `buddy_team_events` below is the append-only record that outlives them.
 * Teams inform the roll call's attention state and never gate readiness,
 * admission, capacity, or checkpoint completeness.
 */
export const buddyPairMembers = pgTable(
  "buddy_pair_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    /** Groups the two members of one pair. Writer-generated, no parent row. */
    pairId: uuid("pair_id").notNull(),
    /**
     * A seated diver's membership. Null when this member is crew, who hold no
     * booking — exactly one of this and `crewPersonId` is set
     * (ADR 20260804-buddy-teams).
     */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /**
     * A crew member's membership — the divemaster leading the group. Deliberately
     * *not* unique: one DM commonly leads several teams on one boat, which is how
     * guided diving runs. The uniqueness rule below is about divers only.
     */
    crewPersonId: uuid("crew_person_id").references(() => people.id),
    /** Who made the pairing call. A pairing is never anonymous. */
    pairedByPersonId: uuid("paired_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A diver is in at most one team per departure — the invariant that keeps
    // the manifest unambiguous. Holds under concurrency, where a check in
    // application code cannot.
    uniqueIndex("buddy_pair_members_booking_unique").on(table.bookingId),
    index("buddy_pair_members_shop_trip_idx").on(table.shopId, table.tripId),
    index("buddy_pair_members_pair_idx").on(table.pairId),
    check(
      "buddy_pair_members_one_subject",
      sql`(${table.bookingId} is not null) <> (${table.crewPersonId} is not null)`,
    ),
  ],
);

/** What a `buddy_team_events` row records. */
export const buddyTeamEventAction = pgEnum("buddy_team_event_action", [
  "formed",
  "dissolved",
  "member_added",
  "member_removed",
]);

/**
 * The append-only trail behind buddy teams (ADR 20260804-buddy-teams).
 *
 * Membership rows are deleted when a team dissolves, so who was paired with
 * whom would otherwise be unreconstructable the moment someone unpaired — on
 * the one document handed to authorities, that reads as laundering. This table
 * is what makes the pairing auditable, and it is why `member_names` is
 * denormalised: its whole job is to outlive the rows it describes, so it cannot
 * resolve them by id afterwards.
 *
 * **Deliberately not pruned** (`RETENTION_DAYS`, src/lib/retention.ts). It is
 * safety evidence about a departure, in the same class as `roll_call_events`
 * and `roll_call_crew_events`, which are not pruned either — a window here
 * would put an expiry on the answer to "who was this diver with?" precisely
 * when an old incident is being reconstructed. Demo shops still clear it: both
 * reset orderings delete it, and `delete-path-coverage.test.ts` keeps them
 * honest about that.
 */
export const buddyTeamEvents = pgTable(
  "buddy_team_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    /** The team this act was about. No parent row — teams are a grouping, not an entity. */
    pairId: uuid("pair_id").notNull(),
    action: buddyTeamEventAction("action").notNull(),
    /** The members as they stood at this moment, in display order. */
    memberNames: jsonb("member_names").$type<string[]>().notNull().default([]),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("buddy_team_events_shop_trip_idx").on(table.shopId, table.tripId, table.occurredAt),
    index("buddy_team_events_pair_idx").on(table.pairId),
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

/**
 * `waiver_document` (a scanned paper release or medical form brought in by the
 * importer) is the blob kind diver erasure owes a delete for
 * (ADR 20260802-diver-data-erasure) — the row's URL column is nulled locally
 * and the object itself is retired through this same ledger rather than a
 * second, parallel mechanism. `recap_photo` joins it for a diver who shared
 * photos of their own.
 *
 * **`certification_card` is unreachable** and kept only because Postgres has no
 * `ALTER TYPE … DROP VALUE`: removing it means recreating the type that
 * `media_deletions.kind` depends on, which is a materially riskier migration
 * than the dead enum member costs. A card has carried no photograph since ADR
 * 20260811-retire-the-digital-card dropped `card_image_url`, so nothing can
 * queue one; its labels stay so a pre-release row still renders a word.
 */
export const mediaDeletionKind = pgEnum("media_deletion_kind", [
  "course_photo",
  "recap_photo",
  "certification_card",
  "waiver_document",
  "dive_site_photo",
]);

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

/**
 * What an erasure obligation is owed *against*, which also decides who can
 * discharge it (ADR 20260803-processor-erasure-obligations):
 *
 * - `stripe_customer` — a `cus_…` object DiveDay deletes itself through
 *   `DELETE /v1/customers/{id}` on the shop's connected account. Retryable and
 *   self-discharging: the row exists so a failed or never-attempted delete is
 *   durable and gets tried again, exactly like `mediaDeletionAttempts`.
 * - `stripe_invoice_snapshot` — an `in_…` finalized invoice. Stripe copies
 *   `customer_name`/`customer_email` onto the invoice when it is finalized, and
 *   deleting the customer does **not** rewrite that copy; Stripe handles
 *   Invoice/PaymentIntent/Charge separately in its own data-deletion flow. No
 *   API call clears it, so this kind is a genuinely manual step and is
 *   discharged only by a human attesting they filed that request.
 */
export const processorErasureTarget = pgEnum("processor_erasure_target", [
  "stripe_customer",
  "stripe_invoice_snapshot",
]);

export const processorErasureStatus = pgEnum("processor_erasure_status", ["owed", "discharged"]);

/**
 * One row per "a processor still holds this erased diver's identity" — the
 * durable counterpart to `mediaDeletionAttempts` for records DiveDay does not
 * store itself (ADR 20260803-processor-erasure-obligations).
 *
 * Raised by `anonymizeDiver` (src/db/anonymize.ts) from the erased diver's
 * orders: one `stripe_customer` row per distinct `orders.stripe_customer_id`,
 * one `stripe_invoice_snapshot` row per distinct `orders.stripe_invoice_id`.
 * Both of those columns are `NOT NULL` pointers into the shop's own Stripe
 * account and the local scrub cannot rewrite either.
 *
 * The table does two jobs, and the `target` above says which applies:
 *
 *   1. **A retry ledger for work DiveDay does perform.** The customer delete is
 *      attempted *after* the erasure transaction commits — never inside it, and
 *      never as a condition of it. A Stripe outage, a revoked Connect token or
 *      a dead network must not roll back an erasure the diver asked for, so the
 *      row commits first and the attempt happens after; `attempts`/`lastError`
 *      are why a failure is visible rather than merely retried forever.
 *   2. **A record of what no API can reach.** The invoice-snapshot rows are not
 *      retryable at all. They exist so nothing in the product implies erasure
 *      finished when a copy of the name and email is still sitting on a
 *      finalized invoice.
 *
 * `external_id` is a `cus_…`/`in_…` handle, not personal data: it is the
 * pointer, and the row deliberately keeps no name, address or amount.
 */
export const processorErasureObligations = pgTable(
  "processor_erasure_obligations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * The erasure that raised this. The row it points at is already anonymized,
     * so this is provenance ("which erasure still owes work"), never a way back
     * to who the diver was.
     */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    target: processorErasureTarget("target").notNull(),
    externalId: text("external_id").notNull(),
    /**
     * The connected account the object lives on, snapshotted from
     * `orders.stripe_account_id` rather than re-derived from the shop at retry
     * time — the same discipline `refundOrder` uses (src/db/orders.ts). A shop
     * that disconnects and reconnects gets a *different* account id, and a
     * delete aimed at the current one would 404 forever against an object that
     * is still sitting on the old one.
     */
    stripeAccountId: text("stripe_account_id").notNull(),
    status: processorErasureStatus("status").notNull().default("owed"),
    /** Delete attempts made so far. Always 0 for a target no API can discharge. */
    attempts: integer("attempts").notNull().default(0),
    /** Why the last attempt failed, so an owner sees *why* and not merely *that*. */
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    dischargedAt: timestamp("discharged_at", { withTimezone: true }),
    /**
     * Who attested the processor-side work was done. Null while still owed —
     * and also null on a `stripe_customer` row discharged by a successful API
     * delete, which is DiveDay's own act rather than anyone's attestation.
     */
    dischargedByPersonId: uuid("discharged_by_person_id").references(() => people.id),
  },
  (table) => [
    // One obligation per processor record per shop, ever. A second erasure that
    // reaches the same Stripe customer (two people sharing one customer object
    // — itself a data problem, but possible) is folded into the existing row
    // rather than raising a duplicate: the work owed is the same single delete,
    // and `personId` names whichever erasure got there first.
    uniqueIndex("processor_erasure_obligations_shop_target_external_unique").on(
      table.shopId,
      table.target,
      table.externalId,
    ),
    // The reports-page panel's read: this shop's still-owed obligations.
    index("processor_erasure_obligations_shop_status_idx").on(table.shopId, table.status),
    check(
      "processor_erasure_obligations_discharged_consistent",
      sql`(${table.status} = 'discharged') = (${table.dischargedAt} is not null)`,
    ),
  ],
);

/**
 * What happened to one diver's blow-out message. `pending` is the resumable
 * state: the cascade has snapshotted the diver but no send has settled yet, so
 * calling the blow-out again picks exactly these rows up. `sending` is a
 * claim: a live pass flipped the row pending→sending before handing it to the
 * provider, so a *concurrent* second call ("did you call it?" — "I'll call
 * it") claims nothing and double-sends nobody. `queued` means the durable
 * retry queue owns the send now (`notification_send_queue`, keyed by the
 * diver row's own id) — a resume never re-sends it, which is what keeps the
 * cascade send-once (ADR 20260804-blowout-cascade).
 */
export const blowoutMessageStatus = pgEnum("blowout_message_status", [
  "pending",
  "sending",
  "sent",
  "queued",
  "failed",
  "no_email",
]);

/**
 * A shop-called weather cancellation of one departure ("blow-out", glossary)
 * and the cascade it triggered. One per trip, ever (`trip_id` unique): calling
 * the blow-out again *resumes* the same cascade rather than double-messaging
 * the roster, and a reinstated trip keeps its record as history.
 */
export const tripBlowouts = pgTable(
  "trip_blowouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    /** The staff member who made the call — the go/no-go is a named act. */
    calledByPersonId: uuid("called_by_person_id")
      .notNull()
      .references(() => people.id),
    calledAt: timestamp("called_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_blowouts_trip_unique").on(table.tripId),
    index("trip_blowouts_shop_called_idx").on(table.shopId, table.calledAt),
  ],
);

/**
 * One booked diver inside a blow-out cascade: the snapshot row the send loop
 * works through and the staff surface reads back. Snapshotted at call time
 * (active bookings only) so a booking cancelled *after* the call still shows
 * what the cascade did for that diver. `offered_trip_ids` records exactly
 * which alternatives this diver's message carried — the audit answer to "what
 * did we tell them?", independent of what the schedule looks like later.
 */
export const tripBlowoutDivers = pgTable(
  "trip_blowout_divers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    blowoutId: uuid("blowout_id")
      .notNull()
      .references(() => tripBlowouts.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    messageStatus: blowoutMessageStatus("message_status").notNull().default("pending"),
    /** When the message settled as sent; null while pending/queued/failed/no_email. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    offeredTripIds: jsonb("offered_trip_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A booking belongs to exactly one trip and a trip to one blow-out, so the
    // booking alone is the natural key — the send loop's resume guarantee.
    uniqueIndex("trip_blowout_divers_booking_unique").on(table.bookingId),
    index("trip_blowout_divers_blowout_idx").on(table.blowoutId),
  ],
);

/**
 * The end-of-day close-out trail (ADR 20260804-day-closeout): one row per time
 * somebody closed the shop's day. Append-only, like `activity_events` — the
 * record *is* the ritual, so a row is never updated or deleted by product
 * code, and "re-opening" a day is simply working again and closing again,
 * which appends another row. Nothing anywhere may condition on a day being
 * closed: this table is a memory, not a lock.
 *
 * `shop_day` is the shop-local calendar date being closed ("YYYY-MM-DD",
 * `shopDayOf` in src/lib/closeout.ts), stored as text exactly like the other
 * date-only facts in this schema, and *not* derivable from `closed_at` — a
 * shop can close Monday's day five minutes after its own midnight.
 *
 * `outstanding` is the `CloseoutSnapshot` (src/lib/closeout.ts) recomputed
 * server-side at the moment of closing: the departures not yet settled and
 * every leftover with the carry/dismiss choice made about it. Snapshot text
 * (trip titles, row subjects) is trail text like `activity_events.message`,
 * not localized UI copy. Growth is bounded by the ritual itself — a row per
 * close, normally one per shop per day — so it carries no retention arm;
 * adding one is HD-11's call (src/lib/retention.ts).
 */
export const dayCloseouts = pgTable(
  "day_closeouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    shopDay: text("shop_day").notNull(),
    actorPersonId: uuid("actor_person_id")
      .notNull()
      .references(() => people.id),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    outstanding: jsonb("outstanding").$type<CloseoutSnapshot>().notNull(),
    /**
     * Write order, for reading a trail whose timestamps tie — same reasoning
     * as `activity_events.seq`: the e2e clock is frozen, so `closed_at` alone
     * cannot say which close of a day came last.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    // The surface's one read: this shop's closes of one day, latest first.
    index("day_closeouts_shop_day_idx").on(table.shopId, table.shopDay),
    check("day_closeouts_shop_day_format", sql`${table.shopDay} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
);

/**
 * One row per device that opted in to Web Push for one trip's roll call — the
 * third refresh trigger, for a phone that is asleep and can therefore serve
 * neither the SSE stream nor the interval (ADR 20260804-manifest-web-push).
 *
 * Per-trip by design, not per-shop: the subscription expires with the trip it
 * names, which is why there is no separate expiry job for the common case.
 * The departure window is deliberately *not* denormalized here — it is read
 * from the live trip row at send time (src/lib/push-window.ts), because a copy
 * taken at subscribe time could not follow a trip that moved.
 *
 * `endpoint`, `p256dh` and `auth` together are a device credential: anyone
 * holding them can push to that device. They are never returned to a client
 * and never logged.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    /** The staff member who opted this device in, so a leaver's devices can be dropped. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** The push service's URL for this device. Unique: re-subscribing updates in place. */
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /**
     * Drives the coalescing window in SQL rather than in process memory, which
     * would not survive a serverless invocation. Null until the first push.
     */
    lastPushedAt: timestamp("last_pushed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A device has at most one subscription per trip, and re-subscribing (the
    // browser can rotate an endpoint at any time) upserts rather than piling up
    // rows that would each push the same phone.
    uniqueIndex("push_subscriptions_endpoint_trip_unique").on(table.endpoint, table.tripId),
    // The send path's only read: this trip's subscribers, filtered on the
    // coalescing window.
    index("push_subscriptions_trip_pushed_idx").on(table.tripId, table.lastPushedAt),
    // Retention prunes by age, across shops.
    index("push_subscriptions_created_at_idx").on(table.createdAt),
  ],
);

export type Shop = typeof shops.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type TripDive = typeof tripDives.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type LastMinuteListEntry = typeof lastMinuteListEntries.$inferSelect;
export type TripLastMinutePromo = typeof tripLastMinutePromos.$inferSelect;
export type BookingPayment = typeof bookingPayments.$inferSelect;
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type PaymentEventOperation = (typeof paymentEventOperation.enumValues)[number];
export type WaiverRecord = typeof waiverRecords.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type SpecialtyCertification = typeof specialtyCertifications.$inferSelect;
export type DiveSpecialty = (typeof diveSpecialty.enumValues)[number];
export type TripRequirement = typeof tripRequirements.$inferSelect;
export type TripAssignmentRole = (typeof tripAssignmentRole.enumValues)[number];
export type NitroxCertification = typeof nitroxCertifications.$inferSelect;
export type ShopStripeAccount = typeof shopStripeAccounts.$inferSelect;
export type ShopWhatsappAccount = typeof shopWhatsappAccounts.$inferSelect;
export type ShopBackupDestination = typeof shopBackupDestinations.$inferSelect;
export type ShopBackupDelivery = typeof shopBackupDeliveries.$inferSelect;
export type BackupDeliveryTrigger = (typeof backupDeliveryTrigger.enumValues)[number];
export type Order = typeof orders.$inferSelect;
export type OrderStatus = (typeof orderStatus.enumValues)[number];
export type OrderLineItemKind = (typeof orderLineItemKind.enumValues)[number];
export type StripeWebhookEvent = typeof stripeWebhookEvents.$inferSelect;
export type BookingCheckout = typeof bookingCheckouts.$inferSelect;
export type Tip = typeof tips.$inferSelect;
export type ShopPromoCode = typeof shopPromoCodes.$inferSelect;
export type PaymentOperationIntent = typeof paymentOperationIntents.$inferSelect;
export type MediaDeletionAttempt = typeof mediaDeletionAttempts.$inferSelect;
export type ProcessorErasureObligation = typeof processorErasureObligations.$inferSelect;
export type MediaDeletionKind = (typeof mediaDeletionKind.enumValues)[number];
export type ProcessorErasureTarget = (typeof processorErasureTarget.enumValues)[number];
export type PaymentOperationKind = (typeof paymentOperationKind.enumValues)[number];
export type BlowoutMessageStatus = (typeof blowoutMessageStatus.enumValues)[number];

export type PushSubscription = typeof pushSubscriptions.$inferSelect;
