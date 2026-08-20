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
import type { CourseTemplateSnapshot } from "@/lib/course-template-sync";
import type { CourseFaq, CourseGalleryPhoto, CourseScheduleDay } from "@/lib/courses";
import type { DiveSiteLandmark } from "@/lib/dive-site-landmarks";
import type { DiveSiteTemplateUndo } from "@/lib/dive-site-template-sync";
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
    hasShoreDiving: boolean("has_shore_diving").notNull().default(false),
    hasPoolDiving: boolean("has_pool_diving").notNull().default(false),
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
    /**
     * When this shop asked to be left out of search engines. Null — the
     * default — means its public pages are in the sitemap and indexable, which
     * is what a shop is on DiveDay for (ADR 20260813-search-listing-is-a-choice).
     *
     * A timestamp rather than a boolean, matching every other reversible act
     * on this schema: the interesting question later is *when* a shop opted
     * out, and a `false` cannot answer it. Set it and the public schedule and
     * course pages emit `robots: noindex` and drop out of the sitemap; clear
     * it and they come back.
     */
    searchListingOptOutAt: timestamp("search_listing_opt_out_at", { withTimezone: true }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
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
     * **When this person said, on a public opt-in, that they hold no
     * certification at all** — Discover Scuba and Try Scuba customers,
     * snorkellers, the non-diving half of a couple, somebody booked onto a
     * course they have not started. Null means they never said it.
     *
     * It is a column on the *person* and deliberately **not** a row in
     * `certifications`, which is the whole point of it (ADR
     * 20260814-self-declared-cards, amendment 2026-08-15). A Discover Scuba
     * experience is not a certification, every other row in that table asserts
     * that a card exists, and a row asserting the opposite would have to be
     * special-cased by readiness, admission, the CSV export, the incident
     * document and the importer — five readers, of which the one that misses it
     * turns "no card" into a card. For the same reason there is no `none` rung
     * on `certification_level`: that enum is a ladder `certificationRank`
     * orders, and a rank-0 member would eventually be compared as a level.
     *
     * Three things hang off it, and none of them is a gate:
     *
     * - It is written only by `recordSelfDeclaredCards`, under the same
     *   anti-displacement rule a declared *level* gets: if this person holds any
     *   live card that is not itself a still-unsighted claim, nothing is written
     *   at all. The forms are unauthenticated.
     * - It is **ignored, not deleted**, once a level lands beside it — where a
     *   record began is history, exactly as `certifications.self_declared_at`
     *   is kept after a sighting.
     * - It renders in the one staff phrase a level renders in ("Not certified
     *   yet — diver's word"), so a staffer scanning a send list can tell this
     *   answer from the silence of somebody who skipped the question.
     */
    noCertificationDeclaredAt: timestamp("no_certification_declared_at", { withTimezone: true }),
    /**
     * **When a staffer said this diver never gave that answer** — the eraser
     * for a stamp above that a stranger typed.
     *
     * The forms that write `no_certification_declared_at` are unauthenticated
     * and resolve a person by shop + email, so for a diver the shop holds no
     * card for, anybody who knows a name and an email address can mark them
     * *"Not certified yet — diver's word"* on the send lists and in every CSV
     * the shop exports from then on. Until this column there was exactly one
     * way back, and it was owner-only erasure of the whole record.
     *
     * **A second column rather than nulling the first**, for the reason the ADR
     * gives about `self_declared_at`: where a record began is history, and an
     * eraser that removed the evidence of its own subject would leave a shop
     * unable to answer "did this diver ever tell us that?". Set, the stamp is
     * *superseded* — every reader treats the person as having said nothing,
     * which is the silence of somebody nobody asked, never a card.
     *
     * That direction is the whole safety argument: this control can only move a
     * record from a stated absence to no statement at all. Evidence lives in
     * the three card tables and nothing here touches them, so clearing can
     * never turn a claim into a card (ADR 20260814-self-declared-cards).
     *
     * A later public declaration clears this again (`recordSelfDeclaredCards`)
     * — otherwise one correction would silently swallow every answer the diver
     * gave afterwards, which is a gate nobody chose. Structural rather than a
     * comparison of the two timestamps, because the e2e fleet freezes the clock
     * outright and two instants recorded under it are equal.
     */
    noCertificationClearedAt: timestamp("no_certification_cleared_at", { withTimezone: true }),
    /**
     * Which staff member cleared it. Not a typed FK: the reference is to this
     * same table, and a self-referencing `references()` trips drizzle's type
     * inference the way `bookings.party_lead_booking_id` documents. A
     * correction to somebody else's safety-adjacent record is the kind of act
     * that has to name its author, so this is the row's own trail rather than
     * an `activity_events` line — that table is trip-scoped everywhere it is
     * read and is pruned on a retention window, and this fact outlives both.
     *
     * **It survives a later public declaration, and the column beside it does
     * not.** The writer of that declaration is an unauthenticated form; letting
     * it null this would let an anonymous post erase the shop's audit of its own
     * correction, and let a griefer loop the stamp back on with nothing left
     * saying a staffer had ever disagreed. So set-with-a-null-`cleared_at` is a
     * real state and reads as *corrected once, and stated again since*.
     */
    noCertificationClearedByPersonId: uuid("no_certification_cleared_by_person_id"),
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

export const diveMode = pgEnum("dive_mode", ["boat", "shore", "pool"]);

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
     * Provenance for the code-owned DiveDay template this course started from.
     * These are nullable because courses created before template syncing, or
     * made entirely by a shop, have no safe baseline for a three-way merge.
     */
    sourceTemplateSlug: text("source_template_slug"),
    sourceTemplateVersion: integer("source_template_version"),
    sourceTemplateSnapshot: jsonb("source_template_snapshot").$type<CourseTemplateSnapshot>(),
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
    /** Optional private course price when a session is run as a private group. */
    privatePriceCents: integer("private_price_cents"),
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
     * Scuba, …). DiveDay's own published catalog says which entries these are
     * (`COURSE_TEMPLATES` in src/db/course-templates.ts) — never sniffed from
     * the title at render time, which would pattern-match English words and
     * silently miss a differently-worded or translated one, and no longer
     * editable on the course page either: it selects the tighter 2:1 in-water
     * ratio (src/lib/course-ratios.ts), which is not a claim a shop makes
     * about itself while editing marketing copy.
     */
    isIntroCourse: boolean("is_intro_course").notNull().default(false),
    /**
     * Whether a diver may request an enriched-air fill on a session of this
     * course — the shop's answer to "can we run this one on nitrox?", set per
     * course because it is a property of the course rather than of the boat.
     *
     * Two gates, both of which must pass before the nitrox box appears on a
     * booking: the shop has to fill nitrox at all (`shopOffersNitrox`, from
     * `shops.rental_items`) and the course has to permit it — see
     * `nitroxAvailableOn` in src/lib/rentals.ts, which is the one place the
     * two are composed. A trip with no course is unaffected.
     *
     * Defaults true, so every ordinary continuing-education course keeps
     * behaving exactly as it did before this column existed. The migration
     * backfills **false** for the two shapes where the box could only ever
     * mislead: a taster, and any course open to uncertified divers. Nobody on
     * those holds a nitrox card — the fill gate needs a verified one
     * (`authorizesNitroxFill`, src/db/nitrox.ts) — and their training dives are
     * conducted on air, so offering the tick box would advertise something the
     * course cannot deliver.
     */
    nitroxCompatible: boolean("nitrox_compatible").notNull().default(true),
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
 * A diver asking a shop to run something on a date that is not on the board.
 *
 * Written from two places now, and the table is deliberately one:
 * `/s/<shop>/courses/<slug>`, where the request names a course, and `/s/<shop>`
 * itself, where it names nothing and says what it is about in `interest`
 * instead ("a two-tank on the wrecks"). From a shop's point of view the rows
 * are the same thing — a person, a way to reach them, what they can already do,
 * and what they want — and one table means one erasure path (src/db/
 * anonymize.ts), one export column set (src/db/export.ts), and one staff list
 * (/shop/<shop>/requests). Splitting them would duplicate all three to express
 * a difference that is a single nullable foreign key.
 *
 * Deliberately small still: name, email, and phone are each optional (a diver
 * may leave only one way to reach them), and there is no status/response
 * tracking — follow-up happens in the shop's own inbox and on the requests
 * list, not as a workflow here.
 */
export const courseInquiries = pgTable(
  "course_inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /**
     * The course this is about, or null when the request is for an ordinary
     * dive rather than a course — the schedule page's form has no course to
     * name, and says what it wants in `interest` instead. The check constraint
     * below is what keeps "null" from meaning "about nothing".
     */
    courseId: uuid("course_id").references(() => courses.id),
    /**
     * What an ordinary dive request is about, in the diver's own words — "a
     * two-tank on the wrecks", "a night dive". Only a *course* request can
     * leave this null, because the course is what it is about.
     */
    interest: text("interest"),
    /**
     * The date the diver would like, and the one they could also make.
     *
     * A `preferred_date` column existed once and was dropped on 2026-08-12:
     * "the date picker beside 'When suits you' implied a precision the answer
     * never had — a diver's date is a request the shop replies to, never a
     * hold". That was true of a lone picker whose output nobody at the shop
     * could read on screen. A date stops being false precision once something
     * groups by it: "four people could make the 12th" is a departure waiting to
     * be scheduled, which is what /shop/<shop>/requests renders. The dates came
     * back *with* that surface, and `alternate_date` is what keeps the first one
     * honest — a diver with one workable date and one fallback is stating a
     * range, not booking a slot.
     *
     * Calendar dates, with no instant in them: stored as `date`, rendered with
     * an explicit UTC zone (src/lib/calendar-date.ts).
     */
    preferredDate: date("preferred_date", { mode: "string" }),
    alternateDate: date("alternate_date", { mode: "string" }),
    /** "Any of these, or near them" — see `groupDateRequests` in src/lib/date-requests.ts. */
    dateFlexible: boolean("date_flexible").notNull().default(false),
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
    /**
     * Free prose — "the week of 12 August", "any weekend in the autumn". Kept
     * exactly as it was when the date columns arrived: the dates do not replace
     * it, and this is still the one field that can hold what a diver means when
     * no date can say it.
     */
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
    // The requests list reads by requested date, dateless rows last.
    index("course_inquiries_shop_preferred_date_idx").on(table.shopId, table.preferredDate),
    // A request must be about *something*. The server action refuses this in
    // words before an insert is attempted (src/app/actions/inquiry.ts); this is
    // the backstop that keeps a row nobody can act on out of the table.
    check(
      "course_inquiries_subject_present",
      sql`${table.courseId} is not null or length(btrim(coalesce(${table.interest}, ''))) > 0`,
    ),
  ],
);

/**
 * Which fit reading a site's briefing shows, when the shop names one rather
 * than letting `siteFit` read it off the published facts. `unknown` is a real
 * choice, not an absence — "ask the crew" is the honest answer for a site whose
 * character depends entirely on the day.
 */
export const diveSiteFitTone = pgEnum("dive_site_fit_tone", ["welcoming", "demanding", "unknown"]);

/**
 * How demanding a site is, as a code rather than the shop's own adjective.
 *
 * `dive_sites.difficulty` was free text, and it read as the one untranslated
 * word on an otherwise translated briefing: a Spanish page rendered
 * "EXPERIENCIA / Beginner" because the demo shop typed English into it. Every
 * value any shop or template had ever stored was already one of these three,
 * so nothing expressive is lost — and `fit_tone` right beside it was a code
 * with a translated label all along, which made the page inconsistent about the
 * same question.
 */
export const diveSiteDifficulty = pgEnum("dive_site_difficulty", [
  "beginner",
  "intermediate",
  "advanced",
]);

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
    /** The last template pull's prior managed fields, for a one-time undo. */
    templateUpdateUndo: jsonb("template_update_undo").$type<DiveSiteTemplateUndo>(),
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
    /** How demanding the site is; the briefing prints a translated label for it. */
    difficultyLevel: diveSiteDifficulty("difficulty_level"),
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
    /**
     * Which fit reading the briefing shows above the facts table — "Welcoming
     * dive" or "Best with recent experience". Null means *derive it* from
     * `difficulty_level`/`depth_range`/`current_note` (`siteFit`, src/lib/diver-planning.ts),
     * which is what every site did before this column existed and is still the
     * ordinary case.
     *
     * It exists because the derivation is a regex over free text a shop wrote
     * for a different purpose: a reef whose current note mentions a "deep
     * channel" read as demanding, and a shop had no way to say otherwise. A
     * code, not a sentence — the *label* is a translated status word, the same
     * shape a readiness status has. The shop's own words go in `fit_note`.
     */
    fitTone: diveSiteFitTone("fit_tone"),
    /**
     * The shop's own sentence under that label, replacing DiveDay's canned one.
     * Null leaves the canned line standing, which is a true sentence about a
     * site nobody has written about yet.
     */
    fitNote: text("fit_note"),
    /**
     * The heading over the field guide's "slow down and you'll see more" aside
     * — the one DiveDay wrote ("See more by slowing down") unless the shop has
     * its own. The tips under it are the shop's already: they come off its own
     * `dive_site_creatures` rows.
     */
    fieldGuideTipsHeading: text("field_guide_tips_heading"),
    /**
     * Named things the crew points at, each with the shop's own note on it —
     * `{ name, kind, note }` (src/lib/dive-site-landmarks.ts). Plain strings
     * are still read (that is all this column held until landmarks carried
     * their own words, and what the CSV import posts), as a name with nothing
     * said about it.
     */
    landmarks: jsonb("landmarks").$type<DiveSiteLandmark[] | string[]>().notNull().default([]),
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

export const boats = pgTable(
  "boats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("boats_shop_id_idx").on(table.shopId)],
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

/**
 * One published version of a catalog site, as a whole briefing.
 *
 * It carries everything the dive-site form can write, because a template a shop
 * cannot take whole is a template it has to finish by hand: the first version
 * of this shape held eight fields, so importing "Molasses Reef" produced a site
 * with no cert gate, no landmarks worth reading, and an empty field guide. The
 * two lists are the same shapes the form posts, and `creatureSlugs` names rows
 * of `./marine-life-catalog.ts` rather than repeating their words — the import
 * copies those words onto the shop's own rows, where the shop edits them.
 */
export type GlobalDiveSiteBriefing = {
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
  /**
   * Legacy free text, on versions published before 2026-08-13. Published
   * snapshots are immutable, so the field stays readable forever; the import
   * narrows it through `parseDiveSiteDifficulty` like any other stored value.
   */
  difficulty?: string;
  /** How demanding the site is, as a `dive_site_difficulty` code. */
  difficultyLevel?: (typeof diveSiteDifficulty.enumValues)[number];
  depthRange?: string;
  maxDepthMeters?: number;
  expectedBottomTimeMinutes?: number;
  currentNote?: string;
  divePlan?: string;
  fitTone?: (typeof diveSiteFitTone.enumValues)[number];
  fitNote?: string;
  fieldGuideTipsHeading?: string;
  landmarks?: DiveSiteLandmark[];
  /** Catalog slugs, resolved to the shop's own field-guide rows at import. */
  creatureSlugs?: string[];
  minimumCertificationLevel?: (typeof certificationLevel.enumValues)[number];
  requiredSpecialties?: (typeof diveSpecialty.enumValues)[number][];
  requiresNitrox?: boolean;
};

/** Immutable published snapshots; a later correction never rewrites a shop's source evidence. */
export const globalDiveSiteVersions = pgTable(
  "global_dive_site_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    globalDiveSiteId: uuid("global_dive_site_id")
      .notNull()
      .references(() => globalDiveSites.id),
    version: integer("version").notNull(),
    briefing: jsonb("briefing").$type<GlobalDiveSiteBriefing>().notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("global_dive_site_versions_unique").on(table.globalDiveSiteId, table.version),
  ],
);

/**
 * Which species a dive site's field guide shows, and in what order — the site's
 * own selection from DiveDay's catalog, chosen on the dive-site form
 * (`src/lib/dive-site-field-guide.ts`).
 *
 * A row is a slug and a position. Every word a person reads off it comes from
 * `marineLife.*` in *their* language, resolved at render by
 * `src/i18n/marine-life-labels.ts` — so one saved briefing reads in English to
 * one diver and in Spanish to the next (ADR 20260813-marine-life-is-diveday-copy).
 */
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
    /**
     * Which species this is: a `MARINE_LIFE_CATALOG` slug, and the key its
     * words are held under in every locale's bundle. Nullable in the column
     * only because rows written before the catalog became app copy could name a
     * species a shop had typed itself; a row with no slug has no words and is
     * skipped by every reader (`fieldGuideCards`). Nothing writes null now.
     */
    catalogSlug: text("catalog_slug"),
    /**
     * Where this face sits in the guide. The list had no order at all until the
     * shop could edit it — the query returned whatever the planner felt like,
     * so a briefing reshuffled its own field guide between renders and the
     * visual suite could not hold a baseline for one.
     */
    position: integer("position").notNull().default(0),
  },
  (table) => [index("dive_site_creatures_site_idx").on(table.diveSiteId)],
);

/**
 * A shop asking DiveDay for a species the catalog does not carry.
 *
 * The field guide is a selection from `MARINE_LIFE_CATALOG` and nothing else
 * (ADR 20260813-marine-life-is-diveday-copy), which is what lets every card
 * render in the reader's own language — and which means a shop diving outside
 * the tropical western Atlantic meets a picker that refuses its reef. This
 * table is the honest other half of that refusal: the picker says "tell us what
 * we are missing" and this is where it lands.
 *
 * **Nothing renders from here.** It is not content, it is a request, and no
 * diver-facing or staff-facing surface reads it — DiveDay queries the table
 * directly and the answer arrives as a release that adds the species. That is
 * the whole contract, and it is why the row is this thin.
 *
 * Append-only and un-deduplicated on purpose: two shops asking for the same
 * animal is the signal, not a conflict, and the count is how a region earns its
 * place in the catalog ahead of a guess.
 */
export const marineLifeRequests = pgTable(
  "marine_life_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** Whoever was at the form; the person to ask what they meant. */
    requestedByPersonId: uuid("requested_by_person_id")
      .notNull()
      .references(() => people.id),
    /**
     * What the staffer typed into the picker, verbatim and trimmed. Free text
     * because that is the point — a common name, a Latin binomial, or a
     * description of a fish they cannot name are all useful, and any structure
     * imposed here would be a guess about which.
     */
    query: text("query").notNull(),
    /** Which site they were writing when they hit the wall, for context. */
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("marine_life_requests_created_idx").on(table.createdAt)],
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
    /**
     * The head count this departure needs to run, and how many hours before it
     * leaves the shop makes that call. Both null — every trip that exists
     * today — means the boat goes with whoever booked, and nothing changes.
     *
     * Set, they are a **published promise**: the booking page states the
     * minimum and the exact moment the answer arrives, and a weekly sweep
     * cancels the departure at that moment if it is still short
     * (src/lib/minimum-seats.ts, src/db/trips-minimum.ts). A null
     * `minimum_decision_hours` beside a set minimum reads as the default
     * window rather than as "no deadline", so a shop can name a minimum
     * without having to have an opinion about the window.
     */
    minimumBookings: integer("minimum_bookings"),
    minimumDecisionHours: integer("minimum_decision_hours"),
    status: tripStatus("status").notNull().default("scheduled"),
    /**
     * When the shop called this departure off. Null while it is scheduled, and
     * null for every trip cancelled before this column existed — no backfill,
     * because those genuinely have no recorded time and inventing one would be
     * worse than admitting there isn't one.
     *
     * A fact about the departure, deliberately not a state about money. The
     * owed-refund queue is derivable on purpose — a seat still holding a capture
     * on a cancelled trip — so that a staffer handing back cash by hand never
     * leaves a stored flag to reconcile with Stripe. This column adds no such
     * flag; it answers "when did we cancel this?", which the schema previously
     * threw away entirely, and which the departure log and the blow-out story
     * both want independently.
     *
     * It also makes the owed-refund staleness bound mean what its name says.
     * That bound used to compare against `booking_payments.updated_at`, which
     * for these rows is when the diver *paid* — so a Saturday charter everyone
     * paid for weeks ago was instantly past the bound, while a walk-in who paid
     * cash on Friday morning for a Friday-evening dive that blew out stayed
     * hidden until Saturday. The freshest, most-likely-to-be-asked-about money
     * was the last to show. Stamped by `setTripStatus`, which is the one seam
     * every cancellation goes through.
     */
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** Crew weather/conditions caution: the trip remains visible, but bookings pause for a final call. */
    conditionsHold: boolean("conditions_hold").notNull().default(false),
    isPrivate: boolean("is_private").notNull().default(false),
    diveMode: diveMode("dive_mode").notNull().default("boat"),
    boatId: uuid("boat_id").references(() => boats.id, { onDelete: "set null" }),
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
    /** Staff pause on automatic recap delivery for this departure. */
    recapAutoSendPaused: boolean("recap_auto_send_paused").notNull().default(false),
    /**
     * When set, overrides the default 4-hour countdown after scheduled return
     * (e.g. after being unpaused, to the later of original time or 1 hour from unpause).
     */
    recapAutoSendAt: timestamp("recap_auto_send_at", { withTimezone: true }),
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
    // `sendDueRecaps` (src/db/recap.ts): scheduled trips that came home at
    // least four hours ago inside the recap lookback — the same shape one
    // column over, on `ends_at`.
    index("trips_status_ends_idx").on(table.status, table.endsAt),
    // Backs the command-palette leading-wildcard ILIKE search (src/db/search.ts, CR-018).
    index("trips_title_trgm_idx").using("gin", sql`${table.title} gin_trgm_ops`),
    check("trips_capacity_range", sql`${table.capacity} between 1 and 60`),
    check("trips_planned_dives_range", sql`${table.plannedDives} between 1 and 4`),
    // Deliberately **not** `minimum_bookings <= capacity`. A shop that later
    // drops the boat from a nine-seater to a four-seat RIB would then be
    // refused the capacity edit by a constraint about something else, and the
    // honest reading of a minimum above capacity is "every seat" rather than
    // "this can never run" — `effectiveMinimum` clamps it on read
    // (src/lib/minimum-seats.ts). The bounds here are only the ones that make
    // a stored value meaningless: a minimum of zero is no minimum, and a
    // decision window of zero hours is the departure itself.
    check(
      "trips_minimum_bookings_range",
      sql`${table.minimumBookings} is null or ${table.minimumBookings} between 1 and 60`,
    ),
    check(
      "trips_minimum_decision_hours_range",
      sql`${table.minimumDecisionHours} is null or ${table.minimumDecisionHours} between 1 and 336`,
    ),
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
    /**
     * **This leg of the day, in minutes**: how long the boat runs to reach this
     * dive's site — from the dock for dive one, from the previous dive's site
     * after that.
     *
     * It lives here rather than on `trips` because a departure is not one ride.
     * A two-tank morning is dock -> A -> B -> dock, each leg its own duration,
     * and the durations are order-dependent: A->B is not B->A when the two sites
     * sit on different parts of the reef line. One number per trip cannot say
     * "10 minutes out to the house reef, 25 across to the wall"
     * (ADR 20260815-per-leg-travel-minutes).
     *
     * Null means "the shop's own `boat_ride_minutes` is right for this leg",
     * which is what every existing row reads as. `0` is a real answer — the same
     * site twice, or a shore entry — so the resolver honours it rather than
     * treating it as absent.
     */
    travelMinutes: integer("travel_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_dives_trip_number_unique").on(table.tripId, table.diveNumber),
    index("trip_dives_trip_idx").on(table.tripId, table.diveNumber),
    // The same bounds `DOCK_DAY_LIMITS.boatRideMinutes` puts on the shop-wide
    // figure this falls back to (src/lib/diver-planning.ts), so an import or a
    // hand-written fix cannot write a leg the form would have refused.
    check(
      "trip_dives_travel_minutes_range",
      sql`${table.travelMinutes} is null or (${table.travelMinutes} >= 0 and ${table.travelMinutes} <= 480)`,
    ),
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
 * A diver who asked to be told if a full trip frees a seat. It is deliberately
 * separate from bookings: a wait-list entry never consumes capacity or appears
 * on a manifest. It is also **not a queue position** — `createdAt` records when
 * the diver asked, and the shop invites whoever fits the departure
 * (ADR 20260813-wait-list-is-a-lead-list).
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
 * A staff-selected invitation to a departure. This is deliberately not a
 * booking and not a wait-list position: it reserves no capacity, never enters
 * the manifest, and can be created for the same request on more than one trip.
 * The source discriminator leaves room for invitations chosen from the wait
 * list or an existing diver record without forcing those concepts to share a
 * table's meaning (ADR 20260816-trip-invitations).
 */
export const tripInvitationSource = pgEnum("trip_invitation_source", [
  "date_request",
  "waitlist",
  "direct",
]);

export const tripInvitations = pgTable(
  "trip_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    source: tripInvitationSource("source").notNull(),
    /** Set for a request-origin invitation; the request carries its contact snapshot. */
    courseInquiryId: uuid("course_inquiry_id").references(() => courseInquiries.id),
    /** Set for a wait-list-origin invitation; the wait-list row remains separate. */
    waitlistEntryId: uuid("waitlist_entry_id").references(() => tripWaitlistEntries.id),
    /** Set only for a direct existing-diver invitation. */
    personId: uuid("person_id").references(() => people.id),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    /** The staff outreach attempt; null means the invitation is still pending. */
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_invitations_shop_trip_idx").on(table.shopId, table.tripId, table.createdAt),
    uniqueIndex("trip_invitations_trip_request_unique")
      .on(table.tripId, table.courseInquiryId)
      .where(sql`${table.courseInquiryId} is not null`),
    uniqueIndex("trip_invitations_trip_waitlist_unique")
      .on(table.tripId, table.waitlistEntryId)
      .where(sql`${table.waitlistEntryId} is not null`),
    uniqueIndex("trip_invitations_trip_person_unique")
      .on(table.tripId, table.personId)
      .where(sql`${table.personId} is not null`),
    check(
      "trip_invitations_source_reference_check",
      sql`(
        (${table.source} = 'date_request' and ${table.courseInquiryId} is not null and ${table.waitlistEntryId} is null and ${table.personId} is null)
        or (${table.source} = 'waitlist' and ${table.courseInquiryId} is null and ${table.waitlistEntryId} is not null and ${table.personId} is null)
        or (${table.source} = 'direct' and ${table.courseInquiryId} is null and ${table.waitlistEntryId} is null and ${table.personId} is not null)
      )`,
    ),
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

/**
 * Per-diver recipient audit log for last-minute promo blasts.
 * Records who was sent which deal, when, and with what discount (via tripPromoId).
 */
export const tripLastMinutePromoRecipients = pgTable(
  "trip_last_minute_promo_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripPromoId: uuid("trip_promo_id")
      .notNull()
      .references(() => tripLastMinutePromos.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_last_minute_promo_recipients_promo_idx").on(table.tripPromoId),
    index("trip_last_minute_promo_recipients_person_idx").on(table.personId),
    index("trip_last_minute_promo_recipients_shop_person_idx").on(table.shopId, table.personId),
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
  /**
   * The *shop* cancelled the departure — a weather blow-out or the
   * minimum-head-count sweep — and the capture was reversed unconditionally.
   * Deliberately distinct from `cancellation_refund`: that one is a diver
   * changing their mind inside a stated window, this one is the shop taking the
   * trip away, and only the first has a window that could have refused it
   * (ADR 20260813-shop-cancellation-refunds-itself).
   */
  "shop_cancellation_refund",
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
  // The post-trip recap message — sent once per booking no earlier than four
  // hours after the trip ends, linking to the diver's shareable recap page
  // (docs first-principles brainstorm C: the word-of-mouth window, weaponized).
  "trip_recap",
  // The weather blow-out cascade message: the cancellation, the diver's money
  // story, and the alternatives they qualify for (ADR 20260804-blowout-cascade).
  "trip_blowout",
  // "This one did not fill." Sent per booking when the minimum-head-count
  // sweep cancels a departure whose deadline passed while it was still short
  // (src/lib/minimum-seats.ts). Tracked per booking like every other trip
  // message, so a shop can see who was told.
  "trip_minimum_not_met",
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
    /** Cleared after a terminal send; queued/processing rows always carry it. */
    payload: jsonb("payload").$type<Notification>(),
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

/**
 * The ways a shop can hand a waiver link over. `link` is not a delivery in the
 * postal sense — nothing was sent — but it is still a fact worth keeping: the
 * staffer took the URL and is passing it on themselves, and the record of that
 * is what stops the diver's record reading "never sent".
 */
export const waiverDeliveryChannel = pgEnum("waiver_delivery_channel", ["email", "text", "link"]);

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
     * A digital token may be booking-scoped or person-scoped; the public waiver
     * page handles both contexts without making a schedule part of signing.
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
    /** Latest delivery outcome for a digital link; null for paper/imported records. */
    deliveryStatus: notificationDeliveryStatus("delivery_status"),
    deliveryProviderMessageId: text("delivery_provider_message_id"),
    deliveryProviderStatus: notificationProviderStatus("delivery_provider_status"),
    deliveryProviderStatusAt: timestamp("delivery_provider_status_at", { withTimezone: true }),
    deliveryError: text("delivery_error"),
    /** SHA-256 hash — what every lookup matches against, and all that is kept once the link is spent. */
    tokenHash: text("token_hash").notNull().unique(),
    /**
     * The same bearer token, sealed (`src/lib/secret-box.ts`), for exactly as
     * long as the link is live.
     *
     * It exists so a second "send this diver their waiver" hands back the link
     * they already have instead of minting a new one and killing the old
     * (ADR 20260820-waiver-links-are-reused-not-reissued). A hash alone cannot
     * do that — nothing can read it back — so the choice was between reissuing
     * (a copied URL dies the moment anyone taps Text, and a diver mid-draft
     * loses it) and keeping an openable copy under the deployment's own key.
     *
     * Bounded on purpose: written only for a live pending link, and nulled the
     * moment the record is superseded, completed, or the diver's data erased.
     * A database reader cannot replay a spent credential, and a live one needs
     * `SECRET_ENCRYPTION_KEY`, which is not in the database. Null wherever no
     * link was ever handed out (paper, imported, anonymized) and wherever the
     * deployment has no sealing key, in which case issuing falls back to
     * minting a fresh link exactly as it did before.
     *
     * One case keeps its ciphertext: a link nobody ever reissued over, left to
     * expire. Nothing opens it again — reuse refuses an expired record, and the
     * next issue supersedes and clears it — and what it seals is a token that
     * now resolves to `expired`, so it is not a live credential. Clearing it on
     * the stroke of expiry would want a sweeper, which is more moving parts
     * than the exposure justifies.
     */
    tokenSealed: text("token_sealed"),
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
 * What we know about each *way* a waiver link was handed over — one row per
 * record per channel, holding the current state of that channel.
 *
 * It sits beside `waiver_records.delivery_*` rather than replacing it, and the
 * split is the same one `notification_deliveries` and
 * `notification_delivery_attempts` already draw: the record's own columns are
 * the **latest attempt on this link, whichever channel it used** — what the
 * webhook keys on and what `getDiverWaiverRequestStatus` answers "has this
 * diver been reached at all?" from — while these rows are **per channel**, and
 * exist because the two questions have different answers the moment a shop
 * emails a diver and then texts them. Without the split, tapping Text erases
 * everything we knew about the email.
 *
 * That is not a nicety: the diver record offers email, text, and link as four
 * peers, and each button wears its own last outcome. A single latest-attempt
 * column can only ever light one of them.
 *
 * Deliberately out of the export bundle (`src/db/export.test.ts`): the outcome
 * a destination system could use is already on `waiver_records.csv`; this is
 * the per-channel mechanics behind it, exactly like
 * `notification_delivery_attempts`.
 */
export const waiverDeliveries = pgTable(
  "waiver_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    waiverRecordId: uuid("waiver_record_id")
      .notNull()
      .references(() => waiverRecords.id),
    channel: waiverDeliveryChannel("channel").notNull(),
    status: notificationDeliveryStatus("status").notNull(),
    providerMessageId: text("provider_message_id"),
    /** Null until a delivery webhook says otherwise, which is the steady state. */
    providerStatus: notificationProviderStatus("provider_status"),
    providerStatusAt: timestamp("provider_status_at", { withTimezone: true }),
    /** The provider's own words for a bounce or failure. */
    detail: text("detail"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Current state, not history: a second email on the same link replaces the
    // row rather than stacking one. The unique index is what the upsert's
    // `onConflictDoUpdate` targets, so it is load-bearing, not a hint.
    uniqueIndex("waiver_deliveries_record_channel_unique").on(table.waiverRecordId, table.channel),
    // The delivery webhook's only entry point: an event names a message id.
    index("waiver_deliveries_provider_message_idx").on(table.providerMessageId),
    index("waiver_deliveries_shop_record_idx").on(table.shopId, table.waiverRecordId),
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
    /**
     * The card number. Nullable **only** for a still-pending self-declaration
     * (`selfDeclaredAt`), which is a level and nothing else — see that column,
     * and the check constraint below that is the real rule. A placeholder
     * string was the alternative and is worse: "PENDING" in a card-number
     * column gets read as a card number eventually.
     */
    identifier: text("identifier"),
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
     * The live staff member who made the review that marked this card
     * certified. Null on records predating this accountable trail and on an
     * import that has not yet been reviewed by this shop.
     */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
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
    /**
     * **A stranger typed this about themselves.** Set when a diver names their
     * own level on one of the two public "tell me when something comes up"
     * opt-ins (the shop-wide last-minute-deal list, a full trip's wait list) —
     * nobody at the shop has seen a card, and the person may not even be who
     * the email says (FU-20260813, ADR 20260814-self-declared-cards).
     *
     * Deliberately a *separate* provenance from `importedAt`, not a reuse of
     * it: an imported card came from a CSV the shop itself uploaded out of its
     * own prior system, which is a materially more trustworthy thing. Without
     * this column the feature would launder a self-declaration into something
     * that reads as shop-supplied.
     *
     * Three consequences hang off it, and all three are load-bearing:
     *
     * 1. `identifier` (and a real `agency`) may be absent while it is set —
     *    see the check constraint below. A self-declared row carries `other`
     *    as its agency because the form never asks; the staff UI renders the
     *    level alone rather than claiming an agency nobody stated.
     * 2. `decideTripAdmission` (src/lib/trip-admission.ts) **ignores** a
     *    still-pending self-declared row entirely. That function's own
     *    docstring required this in the same change that made cards
     *    diver-writable, because it otherwise reads any card on file as
     *    evidence and a refused diver could type their way past the gate.
     * 3. Verifying one is **not** the one-tap promote every other pending card
     *    gets: `reviewCertification` refuses without the agency and card number
     *    the staffer is looking at, which is the same act as capturing a card
     *    and is the point the diver's claim stops being the evidence.
     *
     * The stamp stays forever, like `importedAt` — where a row began is
     * history. "Still a claim" is `selfDeclaredAt IS NOT NULL AND status =
     * 'pending'`; once a staffer has sighted the card it is a sighted card
     * that happens to have started as a claim.
     */
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    /** Soft-archive: a deleted card keeps its row for safety history but drops
     * out of every readiness/roster read (ADR 20260719-crud-archive-semantics). */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("certifications_shop_person_idx").on(table.shopId, table.personId),
    // Partial on the live rows only, so archiving a card frees its number for
    // re-entry (e.g. a renewed card carrying the same identifier).
    // Case-insensitive so "ab1234" and "AB1234" can't create two live rows
    // for what is the same physical card (CR-009).
    //
    // A null identifier is invisible to a unique index (nulls never collide),
    // which is exactly right: two divers who each declared "Open Water" and no
    // number are not the same physical card.
    uniqueIndex("certifications_shop_agency_identifier_unique")
      .on(table.shopId, table.agency, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    // The rule the nullable `identifier` above is worth having: a card number
    // may be absent **only** while the row is a still-pending self-declaration.
    // It covers both ends at once — a staff or imported capture must still
    // carry a number, and a self-declared row cannot reach `verified` without
    // one, so the review gate is enforced by the database and not only by the
    // action that calls it.
    //
    // **Blank, not merely NULL.** It read `identifier is not null` until
    // 2026-08-15, and `''` satisfies that — so three comments and the ADR that
    // credited the database with "a numberless row cannot reach `verified`"
    // were true of NULL and enforced by the application for the empty string.
    // No writer could produce `''`, which is exactly why it was worth closing
    // rather than living with: the claim was load-bearing in four places and
    // only the application was holding it up.
    //
    // Deliberately *blank* and not `length(...) >= 3`, which the follow-up
    // proposed. Three characters is `isPlausibleCardNumber` — a **typo filter,
    // not proof**, whose documented virtue is being wrong in the permissive
    // direction because refusing a real card is the expensive failure. Written
    // into the schema it stops being a filter and becomes a structural
    // invariant that would refuse a genuine short member number at import time,
    // with no way past it. What the comments claimed was "a number", and this
    // is what "a number" means.
    //
    // Bare `btrim()` strips spaces and nothing else, so a lone tab satisfied it.
    // Unreachable from the app — `cardNumberSchema` trims in JS and
    // `isPlausibleCardNumber` demands a digit — but this is the *backstop*, and
    // a backstop that only holds when the layer above it already did is not one.
    //
    // **`is not null` stays, and dropping it was a real bug for an afternoon.**
    // A CHECK passes when its expression is TRUE *or NULL*, and
    // `length(btrim(NULL)) > 0` is NULL — so a predicate that led with the
    // length test alone evaluated to `NULL OR FALSE` = NULL on a numberless
    // `verified` row and **accepted** it, which is weaker than the constraint it
    // was tightening (caught by a `dive-domain-expert` pass, 2026-08-15). Both
    // conjuncts are load-bearing and neither is redundant: the first rules out
    // NULL, the second rules out blank.
    check(
      "certifications_identifier_present_unless_self_declared",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending')`,
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
    /** Date-only, shop-local expiry — see certifications.expiresAt (CR-009). */
    expiresAt: date("expires_at", { mode: "string" }),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** See certifications.reviewedByPersonId. */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
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
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
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

/**
 * The direction a prior system assigns to an imported financial record. It is
 * deliberately a small, source-evidence vocabulary rather than an Order or
 * Stripe status: `payment` and `refund` can contribute to the unverified
 * import slice of the financial aggregates when their amount and currency are
 * clear; `unknown` remains visible in Orders but never changes a total.
 */
export const importedPaymentDirection = pgEnum("imported_payment_direction", [
  "payment",
  "refund",
  "unknown",
]);

/**
 * Payment and receipt history carried from another system. This is *not* an
 * `orders` row: it has no live Stripe invoice, no booking-payment effect, and
 * no authority to issue or refund money. Every value is source evidence and
 * renders as an unverified import until a future reconciliation explicitly
 * proves otherwise.
 *
 * `amountCents` / `currency` are deliberately paired and nullable. The import
 * parser fills them only for a self-identifying supported currency; those are
 * the only source rows permitted into aggregate revenue/refund math. The raw
 * `amountLabel` is always retained so staff can see exactly what the source
 * said, including an amount too ambiguous to aggregate.
 *
 * A `stripeReference` is a non-authoritative crosswalk seam, not a synthetic
 * Stripe object. It lets a later reconciliation match a source-exported
 * `in_`/`pi_`/`ch_` identifier against the real connected account without ever
 * inventing a charge or retaining card credentials.
 */
export const importedPaymentHistory = pgTable(
  "imported_payment_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** Shop-local calendar day the source says this payment/refund occurred. */
    occurredOn: date("occurred_on").notNull(),
    /** Source-derived direction, never a local payment or order status. */
    direction: importedPaymentDirection("direction").notNull().default("unknown"),
    /** What the prior system called the sale, trip, or receipt. */
    title: text("title"),
    /** The source's own status word, preserved rather than mapped. */
    statusLabel: text("status_label"),
    /** Source money text, preserved verbatim whether it can be normalized or not. */
    amountLabel: text("amount_label"),
    /** Parsed only when the amount named a supported currency unambiguously. */
    amountCents: integer("amount_cents"),
    /** Lowercase ISO 4217 code paired with amountCents. */
    currency: text("currency"),
    /** Prior processor/order-system payment identifier, not a credential. */
    paymentReference: text("payment_reference"),
    /** Prior receipt number or reference, not a locally-issued receipt. */
    receiptReference: text("receipt_reference"),
    /** First-party re-stored receipt document only; raw external URLs are never kept. */
    receiptDocumentUrl: text("receipt_document_url"),
    /** Prior shop or source-system label the row carried. */
    sourceLabel: text("source_label"),
    /** Prior booking/order identifier that contextualizes the row. */
    sourceReference: text("source_reference"),
    /** Unverified Stripe object reference retained solely for future reconciliation. */
    stripeReference: text("stripe_reference"),
    /** Stable source/content key that makes re-imports idempotent. */
    dedupeKey: text("dedupe_key").notNull(),
    /** Always set — this table only receives imports, never hand-created payments. */
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("imported_payment_history_shop_person_idx").on(
      table.shopId,
      table.personId,
      table.occurredOn,
    ),
    index("imported_payment_history_shop_date_idx").on(table.shopId, table.occurredOn),
    index("imported_payment_history_shop_currency_direction_idx").on(
      table.shopId,
      table.currency,
      table.direction,
      table.occurredOn,
    ),
    uniqueIndex("imported_payment_history_shop_person_dedupe_unique").on(
      table.shopId,
      table.personId,
      table.dedupeKey,
    ),
    check(
      "imported_payment_history_amount_nonnegative",
      sql`${table.amountCents} IS NULL OR ${table.amountCents} >= 0`,
    ),
    check(
      "imported_payment_history_amount_currency_pair",
      sql`(${table.amountCents} IS NULL AND ${table.currency} IS NULL) OR (${table.amountCents} IS NOT NULL AND ${table.currency} IS NOT NULL)`,
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
 * from the shop and what size each is. Deliberately a storage concept — this
 * is what a diver needs prepared, never a reservation of a particular item or
 * a substitute for a dock-side fit check. The trip prep checklist is derived
 * entirely from these rows. The gear register (`gear_items`, below) sits
 * strictly beneath this layer: a shop that tracks physical units may reserve
 * one against a booking, but a fit alone still reserves nothing
 * (ADR 20260815-minimal-gear-register).
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
 * What a tracked unit of rental gear is. Mirrors the prep list's
 * `RentalItemKind` (the seven rentable kinds plus `boots`) and adds the two
 * kinds a fleet has that a fit never mentions: `tank` — the compliance-heavy
 * unit with its own hydro/VIP clocks — and `other` for the odd tagged thing
 * (torch, SMB, camera tray) a shop still wants on the register. Keep aligned
 * with `GearItemKind` in `src/lib/gear.ts`.
 */
export const gearItemKind = pgEnum("gear_item_kind", [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "mask_fins",
  "weights",
  "dive_computer",
  "gopro",
  "tank",
  "other",
]);

/**
 * A unit's fitness for renting. `needs_service` pulls it out of the
 * assignable pool without losing it; `retired` is the non-destructive end of
 * life that preserves its service and rental history (the register's escape
 * hatch — retiring every unit returns a shop to sizes-only prep).
 */
export const gearItemStatus = pgEnum("gear_item_status", [
  "in_service",
  "needs_service",
  "retired",
]);

/**
 * What kind of care a service event records. `service` is the manufacturer
 * service (regulators, BCDs, computers); `hydro_test` and `visual_inspection`
 * are a tank's two independent compliance clocks; `o2_clean` is the nitrox
 * cleanliness renewal; `note` is a dated condition observation with no clock
 * of its own. Deliberately not a work order: no parts, no labor, no billing
 * (vision non-goal — DiveDay never repairs customer gear).
 */
export const gearServiceKind = pgEnum("gear_service_kind", [
  "service",
  "hydro_test",
  "visual_inspection",
  "o2_clean",
  "note",
]);

/**
 * One physical unit of the shop's own rental fleet — "BCD #14". The gear
 * register is opt-in by presence: a shop with zero rows sees no gear UI and
 * its prep list is generated exactly as before (ADR
 * 20260815-minimal-gear-register). This never replaces `rental_fit_profiles`:
 * a fit says what a diver needs, a unit says what the shop owns, and a
 * reservation (below) is the only thing that joins them.
 */
export const gearItems = pgTable(
  "gear_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: gearItemKind("kind").notNull(),
    /**
     * The shop's own tag, exactly as written on the unit ("BCD #14",
     * "AL80-023"). Unique per shop because the tag is how a wet hand finds
     * the row — two units sharing a tag is a labeling bug worth refusing.
     */
    label: text("label").notNull(),
    /** Optional; mirrors the fit profile's free-text sizes ("M", "10", "3mm L"). */
    size: text("size"),
    serialNumber: text("serial_number"),
    /** One free-text field ("ScubaPro MK25 EVO / S600") — never a catalog. */
    brandModel: text("brand_model"),
    purchasedOn: date("purchased_on"),
    status: gearItemStatus("status").notNull().default("in_service"),
    /** Staff free text set alongside `needs_service` ("inflator sticks"). */
    serviceNote: text("service_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("gear_items_shop_label_unique").on(table.shopId, table.label),
    index("gear_items_shop_kind_idx").on(table.shopId, table.kind),
  ],
);

/**
 * The append-only care history of one unit: services, a tank's hydro and
 * visual-inspection clocks, O2-clean renewals, and dated condition notes.
 * `next_due_on` is where the unit's "due for service" state comes from — the
 * latest event of each kind carries the next deadline for that clock, so the
 * history is the single source of truth and nothing is denormalized onto the
 * item row. Never a work order (no parts, labor, or billing).
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
      .references(() => gearItems.id, { onDelete: "cascade" }),
    kind: gearServiceKind("kind").notNull(),
    /** The day the work happened (shop-local calendar date, no instant in it). */
    servicedOn: date("serviced_on").notNull(),
    /**
     * When this clock next runs out, staff's call at record time (the UI
     * suggests the conventional interval — annual service, five-year hydro).
     * Null for events with no clock, e.g. a condition note.
     */
    nextDueOn: date("next_due_on"),
    note: text("note"),
    /**
     * Who recorded it. A service history a shop may lean on as evidence
     * should not be anonymous — same reasoning as `needs_staff_fit_by`.
     * Attribution only; nulled if the person is ever erased.
     */
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gear_service_events_item_idx").on(table.gearItemId, table.servicedOn),
    index("gear_service_events_shop_idx").on(table.shopId),
    check(
      "gear_service_events_due_after_service",
      sql`${table.nextDueOn} is null or ${table.nextDueOn} > ${table.servicedOn}`,
    ),
  ],
);

/**
 * One unit assigned to one booking for a date range — the fulfillment record
 * behind "who has what and when is it due back". Never a billing record:
 * rental money stays where it already lives (checkout gear lines, staff
 * invoices). The double-booking guard is the database's, not the app's: an
 * `EXCLUDE USING gist` constraint (hand-added in the migration — drizzle-kit
 * cannot express it) refuses two open reservations of the same unit with
 * overlapping inclusive date ranges, so two staff racing each other cannot
 * both win (ADR 20260815-minimal-gear-register). `returned_at` closes the
 * reservation and frees the window; `checked_out_at` records the handover so
 * "reserved" and "actually out the door" stay distinguishable.
 */
export const gearReservations = pgTable(
  "gear_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    gearItemId: uuid("gear_item_id")
      .notNull()
      .references(() => gearItems.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    /** Inclusive shop-local calendar dates — a rental window, not an instant. */
    reservedFrom: date("reserved_from").notNull(),
    reservedUntil: date("reserved_until").notNull(),
    /** When the unit physically left the counter; null while merely reserved. */
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    /** When it came home. Non-null ends the reservation and frees the window. */
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    /** Condition on return, when worth writing down ("torn strap, needs look"). */
    returnNote: text("return_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gear_reservations_item_idx").on(table.gearItemId),
    index("gear_reservations_booking_idx").on(table.bookingId),
    index("gear_reservations_shop_until_idx").on(table.shopId, table.reservedUntil),
    check("gear_reservations_window", sql`${table.reservedUntil} >= ${table.reservedFrom}`),
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
    /** Nullable only for a still-pending self-declaration — see
     * `selfDeclaredAt` below and `certifications.identifier`. */
    identifier: text("identifier"),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** See certifications.reviewedByPersonId. */
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
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
    /**
     * Self-declared provenance, mirroring `certifications.selfDeclaredAt` and
     * carrying every one of its consequences — read that column's comment. The
     * public join forms ask "nitrox certified?" as a checkbox, so what lands
     * here is a yes with no agency and no number behind it, and a fill is
     * still authorized only by a `verified` card.
     */
    selfDeclaredAt: timestamp("self_declared_at", { withTimezone: true }),
    /** Soft-archive, mirroring `certifications.deletedAt`. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who removed the card, when the removal was accountable. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
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
    // Same rule as `certifications_identifier_present_unless_self_declared`,
    // both conjuncts included — read that one for why neither is redundant and
    // why leading with the length test alone silently accepts a NULL.
    check(
      "nitrox_certifications_identifier_present_unless_self_declared",
      sql`(${table.identifier} is not null and length(btrim(${table.identifier}, E' \\t\\n\\r\\f\\v')) > 0) or (${table.selfDeclaredAt} is not null and ${table.status} = 'pending')`,
    ),
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
    /**
     * The order these were written in — **the final tiebreak on every
     * roll-call read**, and the only column here that records what actually
     * came first (ADR 20260815-roll-call-order-is-a-property-of-the-data).
     *
     * Reads used to order by `desc(occurred_at), desc(created_at)` and nothing
     * else. `occurred_at` ties constantly — the e2e clock is frozen outright,
     * and an offline batch is applied with the timestamps the device recorded
     * — and `created_at` is `defaultNow()`, which in Postgres is **transaction
     * time**: two events applied inside one transaction share it exactly. With
     * both tied, Postgres returns whatever the heap hands back, which changes
     * the moment anything moves rows (a `VACUUM` does). The read-back order
     * that the offline device's own tie-break was pinned against would then
     * silently stop holding, with every test still green — the same failure
     * mode as the bug that prompted this, one layer down.
     *
     * `id` cannot stand in for it: `defaultRandom()` is as arbitrary as the
     * heap, merely arbitrary consistently. `activity_events.seq` is the same
     * column for the same reason.
     *
     * **Never serialise it.** The sequence is database-global, not per shop, so
     * a value reaching a response body, an export file or a client component
     * would publish a monotonic counter every tenant shares — one shop able to
     * read another's roll-call volume from two samples (security review,
     * 2026-08-15). Two readers here select the whole row
     * (`select({ event: rollCallEvents, … })`); they reduce it to named fields,
     * and a `...event` spread would quietly undo that.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
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
 * The crew half of the head count: one staff member said one **assigned crew
 * member** is aboard, not aboard, or cleared, at one checkpoint. Append-only
 * history, exactly like `rollCallEvents` — the newest row per person per
 * checkpoint is the current answer and nothing is rewritten (ADR
 * 20260803-per-person-crew-roll-call).
 *
 * This is the *whole* crew half. A count-level `roll_call_crew_attestations`
 * table ("how many crew are aboard", ADR 20260802-crew-roll-call-attestation)
 * preceded it and was retired by ADR 20260804-crew-roll-call-is-per-person;
 * the table itself was dropped on 2026-08-15 under H-49, having had no
 * production writer since.
 *
 * Its own table rather than a widened `rollCallEvents`: carrying crew there
 * would have meant making `booking_id` nullable, weakening a NOT NULL invariant
 * on the safety spine so a *diver* event could be written with no subject at
 * all. The subjects genuinely differ — a booking is a paid seat, an assignment
 * is a roster line — so they are separate rows, and each table's subject column
 * stays `notNull`.
 *
 * `person_id` is the subject; `recorded_by_person_id` is who said so. They are
 * routinely the same human (a divemaster boarding herself) and that is fine —
 * the point is that the count names somebody, not that a second person
 * witnesses it.
 *
 * `source`/`client_event_id` carry the same offline contract `roll_call_events`
 * does, and for the same reason: crew roll call **is** recordable with no
 * signal, so a device-generated event has to be deduplicable on retry. Without
 * them a captain offshore could count divers but not crew, and
 * `rollCallCompleteness` needs both halves — so an after-dive checkpoint, the
 * one where a person may still be in the water, could not be closed at sea
 * (H-46, 2026-08-14). The partial unique index on `(shop_id, client_event_id)`
 * is what makes a replayed sync idempotent; live events leave both at their
 * defaults.
 *
 * Deliberately **no** `offline_snapshot_saved_at` here, unlike the diver table.
 * That column records *which snapshot supplied the readiness evidence*, and
 * crew have no readiness to evidence — nothing gates a crew member at
 * departure. The snapshot timestamp is still required as an *input* on an
 * offline crew write (it is what the staleness bound is computed against, the
 * same arithmetic `recordRollCall` does); it simply has nothing to attest to
 * once the row is written.
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
    source: rollCallSource("source").notNull().default("live"),
    /** Device-generated idempotency key. Live events leave this null. */
    clientEventId: uuid("client_event_id"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The same final tiebreak the diver table carries, and it has to be the
     * same one: the two halves of a head count are read minutes apart on one
     * screen, and a crew member's result ordering differently from a diver's
     * is how the device and the server come to disagree about who is still in
     * the water. See `rollCallEvents.seq`.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("roll_call_crew_events_shop_trip_checkpoint_person_occurred_idx").on(
      table.shopId,
      table.tripId,
      table.checkpoint,
      table.personId,
      table.occurredAt,
    ),
    uniqueIndex("roll_call_crew_events_shop_client_event_unique").on(
      table.shopId,
      table.clientEventId,
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
 * A crew-owned image kept with a departure's close-out. Unlike `recapPhotos`,
 * it has no diver booking because one upload is shared with every diver on
 * the completed departure's recap.
 */
export const tripRecapPhotos = pgTable(
  "trip_recap_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    imageUrl: text("image_url").notNull(),
    uploadedByPersonId: uuid("uploaded_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_recap_photos_shop_trip_idx").on(table.shopId, table.tripId, table.createdAt),
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
    /** Staff curation flag for the public review selection. */
    isStandout: boolean("is_standout").notNull().default(false),
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
 * Why a shop took a review down. A code, never a sentence — the UI picks the
 * words (ADR 20260731-domain-layer-copy-leaks) — and a deliberately short list,
 * because the list *is* the constraint: an unconstrained hide button plus a
 * machine-readable `aggregateRating` is how a curated set gets published as an
 * impartial measurement (ADR 20260813-review-moderation-has-a-floor).
 *
 * `other` exists so a shop facing a case these four do not describe is never
 * stuck, and it is the one value that requires `reason_note` to be filled in.
 */
export const reviewModerationReason = pgEnum("review_moderation_reason", [
  /** Abusive or harassing — aimed at a person rather than the diving. */
  "abusive",
  /** Names a member of staff or another diver. */
  "names_a_person",
  /** About a different trip, a different shop, or plainly not this dive. */
  "wrong_subject",
  /** Spam, an advertisement, or a test submission. */
  "spam",
  /** Something else, stated in `reason_note`. */
  "other",
]);

export const reviewModerationAction = pgEnum("review_moderation_action", ["published", "hidden"]);

/**
 * Every publish and hide, append-only — the trail
 * ADR 20260813-review-moderation-has-a-floor added, shaped like
 * `buddy_team_events` and the roll-call trails beside it.
 *
 * It exists for two reasons and the second is the load-bearing one. It records
 * what a shop asserted when it took a diver's words down; and it is what makes
 * "how much of this shop's record has been suppressed?" answerable, which
 * decides whether DiveDay will still vouch for the shop's average in JSON-LD.
 * A review sitting unpublished because it carries words nobody has read yet is
 * *not* suppressed, and only a recorded `hidden` act tells the two apart.
 */
export const reviewModerationEvents = pgTable(
  "review_moderation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => tripReviews.id),
    action: reviewModerationAction("action").notNull(),
    /** Null on a publish: releasing a review states no case. */
    reason: reviewModerationReason("reason"),
    /** The shop's own words, required when `reason` is `other`. */
    reasonNote: text("reason_note"),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("review_moderation_events_shop_idx").on(table.shopId, table.occurredAt),
    index("review_moderation_events_review_idx").on(table.reviewId),
    // A hide states a case or it does not happen; `other` states it in words.
    check(
      "review_moderation_events_hidden_has_reason",
      sql`${table.action} <> 'hidden' or ${table.reason} is not null`,
    ),
    check(
      "review_moderation_events_other_has_note",
      sql`${table.reason} <> 'other' or length(trim(coalesce(${table.reasonNote}, ''))) > 0`,
    ),
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
export type TripLastMinutePromoRecipient = typeof tripLastMinutePromoRecipients.$inferSelect;
export type BookingPayment = typeof bookingPayments.$inferSelect;
export type PaymentStatus = (typeof paymentStatus.enumValues)[number];
export type PaymentEventOperation = (typeof paymentEventOperation.enumValues)[number];
export type WaiverRecord = typeof waiverRecords.$inferSelect;
export type Certification = typeof certifications.$inferSelect;
export type SpecialtyCertification = typeof specialtyCertifications.$inferSelect;
export type DiveSpecialty = (typeof diveSpecialty.enumValues)[number];
export type DiveSiteFitTone = (typeof diveSiteFitTone.enumValues)[number];
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

export type GearItem = typeof gearItems.$inferSelect;
export type GearItemKindValue = (typeof gearItemKind.enumValues)[number];
export type GearItemStatus = (typeof gearItemStatus.enumValues)[number];
export type GearServiceEvent = typeof gearServiceEvents.$inferSelect;
export type GearServiceKindValue = (typeof gearServiceKind.enumValues)[number];
export type GearReservation = typeof gearReservations.$inferSelect;
