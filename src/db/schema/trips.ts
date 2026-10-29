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
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { PLAN_CHANGE_REASONS } from "@/lib/plan-change";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { courses } from "./courses";
import { diveSites } from "./dive-sites";
import { requirementColumns } from "./requirement";

/**
 * The departure board: recurring series, boats, trip tags, `trips` and their
 * days, dives, executed dives, boarding requirements and sightings.
 */

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
    createdAt: appNowTimestamp("created_at").notNull(),
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
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trip_series_skips_slot_idx").on(table.seriesId, table.occurrenceDate),
    index("trip_series_skips_shop_idx").on(table.shopId),
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
    /**
     * **Total people allowed aboard the boat**, including passengers and crew.
     * The stored number is kept as entered and interpreted this way; at booking
     * time one place is reserved for every assigned crew member. It is not a
     * passenger-seat count. `trips.capacity` remains the passenger-place cap.
     */
    capacity: integer("capacity").notNull(),
    /**
     * One line the shop says about the boat on its storefront (Harbor — ADR
     * 20260901-diveday-reimagined, decision 2: the boats section is a name, a
     * capacity and the shop's own sentence). Optional; a hull with none is
     * listed by name and seats alone, never with DiveDay filler.
     */
    description: text("description"),
    /** The shop's public photograph of this hull. */
    photoUrl: text("photo_url"),
    /**
     * **The vessel's legal passenger ceiling**, as printed on its Coast Guard
     * Certificate of Inspection (or the shop's own flag state's equivalent).
     * Not `capacity` above: that is the total people aboard including crew,
     * while this is the passenger-only number a boarding officer counts
     * against. Optional, because a shop that has not typed it in has said
     * nothing, and nothing reads a missing limit as zero.
     *
     * **A ceiling on what is sold** (H-107): a boat save is refused when an
     * upcoming departure still sells more seats than it, and a departure
     * may not sell more seats than it (`boatSeatsRefusal`, `tripDetailsPatch`),
     * and the booking transaction never sells past it (`sellableCapacity`).
     * A row saved over it before H-107
     * keeps its row until its next save; the fleet row says so in danger ink,
     * and the manifest still says when the people booked aboard pass it
     * (`boatSafetyNotices`, `src/lib/boat-safety.ts`). Not a check constraint,
     * for exactly that reason: those rows must keep sailing.
     */
    certifiedPassengers: integer("certified_passengers"),
    /**
     * **Total persons aboard, crew included**, when the certificate prints that
     * limit too (#2302). Some flag states, Spain among them, print only this
     * one number. Optional and independent of `certifiedPassengers`: a shop
     * whose certificate carries only a passenger figure is never asked for it.
     *
     * Compared with the boat's total-occupant capacity when the boat is saved;
     * it does not reduce or refuse bookings. Checked again at the manifest:
     * pre-departure check says when the people booked, or counted aboard, plus
     * the crew pass it (`boatSafetyNotices`). It does not participate in the
     * booking limit; only `capacity`, the passenger certificate, and crew
     * reservations define sellable seats.
     */
    certifiedTotalPersons: integer("certified_total_persons"),
    /**
     * The boat's paper clocks, each a shop-local calendar date (no instant in
     * it): when the next safety inspection is due, when the registration runs
     * out, and when the hull insurance does (and `coiExpiresOn` below). Nullable each,
     * and each informs ahead of time: 90 days for the inspection, 60 for the
     * other two (`src/lib/boat-safety.ts`). Stored on the boat rather than as events because the shop
     * renews a document by typing the next date over the last one; the
     * history of a paper is the paper itself.
     */
    inspectionDueOn: date("inspection_due_on"),
    /**
     * When the certificate itself runs out (#2302): a Certificate of Inspection
     * carries its own expiry, years apart from the annual inspection above,
     * and either lapsing grounds a passenger vessel. Same shape and same
     * 90-day horizon as the inspection.
     */
    coiExpiresOn: date("coi_expires_on"),
    registrationExpiresOn: date("registration_expires_on"),
    insuranceExpiresOn: date("insurance_expires_on"),
    /**
     * **The boat's radio identity** (fourth review, item 11): its call sign and
     * its MMSI, the two facts a coastguard asks for after the name. Held per
     * hull because a shop with two boats has two of each: the packet's
     * emergency card printed one shop-wide vessel line on every departure, so
     * a boat sailing on Mantis I read Mantis II's MMSI. Optional each; a
     * departure on no boat, or on one with neither, falls back to the shop's
     * own vessel line (`emergencyReferenceForDeparture`). The MMSI is nine
     * digits (ITU-R M.585); the call sign is stored upper-cased.
     */
    callSign: text("call_sign"),
    mmsi: text("mmsi"),
    /**
     * **The channel the boat works on** (issue #2672, decided by Aaron
     * 2026-10-17): "68", printed as "Channel: 68" on its departures' emergency
     * card. Free of the radio identity's fallback rule: a boat with only a
     * channel still prints the shop's vessel line. Optional; normalized by
     * `normalizeWorkingChannel`, and bounded here too.
     */
    workingChannel: text("working_channel"),
    createdAt: appNowTimestamp("created_at").notNull(),
    /**
     * Deleting a hull stamps this and leaves the row (ADR
     * 20260820-every-delete-is-soft). It has to: `trips.boat_id` is
     * `onDelete: "set null"`, so a real delete did not fail loudly — it quietly
     * erased which vessel sailed on **every past departure** that used the
     * boat, which is the first fact an insurer or an incident review asks for.
     *
     * The word on screen is still "Delete"; a shop is never told about this
     * column.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("boats_shop_id_idx").on(table.shopId),
    // Over the live rows only — the fleet list, the board's picker and the
    // capacity check all read this shape, and a deleted hull is not a boat the
    // shop has.
    index("boats_shop_live_idx").on(table.shopId).where(sql`${table.deletedAt} is null`),
    // A certificate that allows nobody aboard is a typo, not a vessel.
    check(
      "boats_certified_passengers_positive",
      sql`${table.certifiedPassengers} is null or ${table.certifiedPassengers} between 1 and 999`,
    ),
    // An MMSI is nine digits; anything else read over the radio is a wrong number.
    check("boats_mmsi_nine_digits", sql`${table.mmsi} is null or ${table.mmsi} ~ '^[0-9]{9}$'`),
    check(
      "boats_working_channel_short",
      sql`${table.workingChannel} is null or char_length(${table.workingChannel}) between 1 and 16`,
    ),
    check(
      "boats_certified_total_persons_positive",
      sql`${table.certifiedTotalPersons} is null or ${table.certifiedTotalPersons} between 1 and 999`,
    ),
    // Passengers are some of the persons aboard: more passengers than persons
    // is a typo, refused at save too (`boatSeatsRefusal`).
    check(
      "boats_certified_passengers_within_total",
      sql`${table.certifiedPassengers} is null or ${table.certifiedTotalPersons} is null or ${table.certifiedPassengers} <= ${table.certifiedTotalPersons}`,
    ),
  ],
);

/**
 * **A lens is the shop's own word for a kind of day** — ADR
 * 20260904-reef-all-the-way-down, D02 (issue #1162).
 *
 * "Easygoing reef", "Getting comfortable again", "Photography" — a vocabulary
 * the shop writes once and then hangs a departure on, so a diver reading the
 * public schedule can pick the day they want rather than the next open seat.
 * Deliberately the shop's prose rather than a DiveDay taxonomy: the whole
 * value is that it sounds like the shop, and a fixed enum would make every
 * shop's schedule read the same. The cost, stated plainly, is that a lens word
 * is not translated — it is the shop's own sentence, like a boat's line or a
 * site's fit tone.
 *
 * The slug is derived from the name once, on create, and never rewritten: a
 * shop that renames "Easygoing reef" to "Easy reef" must not break the link a
 * diver shared yesterday.
 */
export const tripLenses = pgTable(
  "trip_lenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Also the rail's order: the order the shop wrote its own vocabulary in. */
    createdAt: appNowTimestamp("created_at").notNull(),
    /**
     * Deleting a lens stamps this and leaves the row (ADR
     * 20260820-every-delete-is-soft), because `trips.lens_id` points at it and
     * a real delete would erase which kind of day a past departure was. The
     * word on screen is still "Delete".
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("trip_lenses_shop_live_idx")
      .on(table.shopId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("trip_lenses_shop_slug_key")
      .on(table.shopId, table.slug)
      .where(sql`${table.deletedAt} is null`),
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
    /**
     * The shop's own word for this kind of day (ADR
     * 20260904-reef-all-the-way-down, D02). Null is the ordinary case and
     * renders nothing — never "Uncategorised".
     */
    lensId: uuid("lens_id").references(() => tripLenses.id, { onDelete: "set null" }),
    /** Compatibility pointer to the first dive's site for readiness and forecast consumers. */
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id),
    /** Present only for a scheduled course session; ordinary charters leave this empty. */
    courseId: uuid("course_id").references(() => courses.id),
    title: text("title").notNull(),
    description: text("description"),
    /**
     * Where this specific departure meets, when it isn't the shop's own front
     * door (issue #704 slice 2). Both null (every trip until this shipped)
     * means "the shop" everywhere this renders — a marina three miles from
     * the storefront, a shore dive's beach car park, a second dock. A label
     * alone with no address is a real, legitimate state ("North Jetty") for a
     * shop whose divers already know the spot; an address with no label
     * renders as plain text.
     *
     * Free text, not `shops.address_*`'s structured street/locality/region/
     * postal/country columns and not geocoded — a meeting point is casual by
     * nature ("the gravel lot past the ranger station"), and the settings
     * address-search box that backs the shop's own address would guess wrong
     * coordinates for exactly the kind of place this field exists to name.
     */
    meetingPointLabel: text("meeting_point_label"),
    meetingPointAddress: text("meeting_point_address"),
    /** Optional shop-authored arrival guidance for the public card and `/ready`. */
    arrivalLandmark: text("arrival_landmark"),
    arrivalParkingNote: text("arrival_parking_note"),
    arrivalTransitNote: text("arrival_transit_note"),
    arrivalLookFor: text("arrival_look_for"),
    arrivalFirstInteraction: text("arrival_first_interaction"),
    /** A first-party stored photo or bundled illustration; never a raw remote URL. */
    arrivalPhotoUrl: text("arrival_photo_url"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /**
     * **Passenger places this departure offers** — divers, snorkelers and
     * riders alike (ADR 20261007-participant-types), excluding the assigned
     * crew. At booking time this is capped by the boat's total occupants minus
     * crew, the boat's passenger certificate, and the course/diver limits.
     */
    capacity: integer("capacity").notNull(),
    /**
     * **How many of those people may dive** — the second limit a boat has:
     * the tanks, BCDs and in-water supervision it can put out. Null (the
     * default) means no separate limit, so every seat may be a diver's. A value
     * at or above `capacity` binds nothing, read through `diverSeatLimit`
     * (src/lib/participant-types.ts) rather than refused here, for the reason
     * `minimum_bookings` gives above: a later capacity cut must not be refused
     * by a constraint about something else.
     */
    diverCapacity: integer("diver_capacity"),
    /**
     * **The wetsuit the boat is running today, in millimetres** (issue #2206;
     * Aaron 2026-10-13), set on the departure's details beside the dive plan.
     * Per departure rather than per season because the cold-snap day is the
     * one that matters. Null is "not said", and then the Gear tab proposes no
     * wetsuit at all: a staffer picks one, as before. It proposes, it never
     * gates (`proposeRentalUnits`).
     */
    wetsuitThicknessMm: integer("wetsuit_thickness_mm"),
    /** Drives the after-dive roll-call checkpoints; recreational charters are commonly two-tank. */
    plannedDives: integer("planned_dives").notNull().default(2),
    /**
     * **This departure's dives went past no-decompression limits** — staged
     * decompression, extended range (H-84, issue #1555). DAN's preflight
     * guidance covers no-decompression diving and declines to give a number for
     * a dive that took stops, so `flySafeFrom` (src/lib/fly-safe.ts) answers
     * nothing for a departure carrying it and the recap says nothing about
     * flying. Defaults to no, so a shop that never sets it keeps the ordinary
     * sentence. It changes no gate and no ratio; the roster and the roll call show
     * one reminder line to check technical cards when a diver is booked (H-144).
     */
    exceedsNoDecoLimits: boolean("exceeds_no_deco_limits").notNull().default(false),
    /** Per-diver price; null means unpriced — an order made from this trip needs a manual amount. */
    priceCents: integer("price_cents"),
    /**
     * **What a snorkeler and a rider pay on this departure**, in minor units
     * (ADR 20261007-participant-types). Null means the shop does not sell that
     * kind of seat here: the public form does not offer it, and staff who seat
     * one anyway settle the money by hand, the same as an unpriced trip. Zero
     * is a real answer — a rider who comes along free — and is offered.
     */
    snorkelerPriceCents: integer("snorkeler_price_cents"),
    riderPriceCents: integer("rider_price_cents"),
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
    /**
     * **Lunch is served aboard** (fifth-loop ideas, item 56): a long day boat
     * feeds its divers. Only then does the diver's day-of form ask for a lunch
     * preference, and Prep and the paper day count lunches and list the
     * notes. Off by default; a two-tank morning feeds nobody.
     */
    lunchAboard: boolean("lunch_aboard").notNull().default(false),
    /**
     * **This departure is meant to run without an in-water guide, and the shop
     * says so.**
     *
     * The shop's divemaster target (`src/lib/divemaster-ratio.ts`) applies to
     * every dive it runs and binds nothing — but the Today queue's
     * `uncrewed_departure` row is warning-toned and sits near the top, and a
     * shop whose ordinary product *is* self-guided buddy-pair charters had no
     * way to say so. It would have seen that row on every departure, forever,
     * with no way to silence it short of rostering a divemaster it did not
     * want — which is the habituation the ratio's own ADR
     * (20260820-shop-divemaster-ratio) was written to avoid, arriving as "staff
     * learn to skip this row" rather than as a refusal. The cost lands on the
     * row's credibility for the case it exists to catch: an instructor pulled
     * off a fully-booked DSD trip at the last minute.
     *
     * Per departure rather than per shop, deliberately. A shop-wide switch
     * would silence the row for the fully-booked course session too, and the
     * shape of this fact is genuinely per-sailing: the same shop runs a guided
     * reef charter on Saturday and an unguided shore dive on Sunday.
     *
     * **It reaches the shop's own advisory target and nothing else.** Agency
     * training ratios (`src/lib/course-ratios.ts`) are safety caps that really
     * do refuse a seat, and no shop may switch one off by ticking a box: a
     * course session short of its instructor still raises `instructor_missing`
     * with this set. Readiness, admission and capacity are all untouched.
     */
    selfGuided: boolean("self_guided").notNull().default(false),
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
    /**
     * **How many times this departure has materially changed**, published as
     * RFC 5545 `SEQUENCE` by both calendar surfaces — the diver's one-off
     * `.ics` (`src/app/s/[shopSlug]/trips/[id]/calendar/route.ts`) and the
     * staff subscription feed (`src/features/calendar-sync`), through
     * `src/lib/trip-calendar.ts` (issue #1165, delight report D05).
     *
     * **Exactly two edits bump it**: a change to `starts_at`, and a change to
     * the list of dive sites the day visits (`src/lib/trip-revision.ts` holds
     * that rule, with no database in it). `moveTrip`, `updateTrip`,
     * `applyDetailsToFutureSeries` and the demo refresh are the writers.
     *
     * **Nothing else does**, and the omissions are the point. A conditions
     * note, a status flip, a title, a price and a capacity all leave it where
     * it is: a calendar client re-alerts a diver's phone on a `SEQUENCE` it
     * has not seen, and a crew member typing "vis is 40ft today" at the rail
     * must not buzz the whole boat. A counter that moved for a note and stayed
     * flat for a two-hour time change would be worse than no counter at all.
     *
     * A duplicated departure is a new row and starts at 0; so does every
     * instance a series roll materializes.
     */
    revision: integer("revision").notNull().default(0),
    /**
     * **The start the booked divers last heard, while it differs from
     * `starts_at`** (ux review 2026-10-11, item 1; `src/db/trip-rescheduled.ts`).
     *
     * Null means the divers know the current time. A move with seats on it
     * fills it with the pre-move start unless it is already set (a second move
     * before anybody was told keeps the first), a sent reschedule notice clears
     * it, and a move back to this instant clears it. The notice's "It was
     * <time>" line and staff's "Tell them" after an Undo read the previous
     * time from here and nowhere else: never from a form.
     */
    diversToldStartsAt: timestamp("divers_told_starts_at", { withTimezone: true }),
    /**
     * **Whether the meeting point has moved since the divers were last told**
     * (#2446), kept beside `divers_told_starts_at` for the same reason: the
     * "Tell them" notice after an Undo reads it here, and a posted form field
     * is never trusted for what the notice says. ORed in by each move that
     * holds a notice, cleared with `divers_told_starts_at` when a notice is
     * sent or the divers' time is current again.
     */
    diversToldMeetingPoint: boolean("divers_told_meeting_point").notNull().default(false),
    /**
     * Set when staff delete an empty departure (ADR 20260820-every-delete-is-soft).
     *
     * `deleteTrip` still refuses a departure with any roster, wait-list entry or
     * roll-call evidence, so a row carrying this stamp is one nobody ever
     * boarded — but the children it used to hard-delete (its dive plan, its
     * crew, its requirements, its schedule days) now stay attached, which is
     * what makes restoring it a single column write rather than a rebuild.
     *
     * Every read of this table that means "the board" filters on it through
     * {@link liveTrips}. A miss on the public schedule or the sitemap shows a
     * diver a departure the shop took off the board, which is the failure this
     * column's index exists to make cheap to avoid.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * **A rehearsal: a departure for training day, not a real sailing** (ADR
     * 20261012-rehearsal-departures).
     *
     * Set when the departure is created and never afterwards: a real departure
     * does not turn into a practice one, nor the other way round. While it is
     * set, nothing about this departure leaves the shop. It sends no message to
     * anyone, appears on no public page or feed, counts in no report, export,
     * availability answer or integration, and takes no money. The ADR lists
     * every place that honours it, and `src/db/rehearsal-coverage.test.ts`
     * walks them, so a new read model that forgets it fails a test.
     *
     * The nightly cron deletes a rehearsal once fly-safe's look-back has run
     * out, and never one with a diver or crew boarding, an after-dive count, a
     * logged dive or an incident report (`clearFinishedRehearsals`,
     * src/db/rehearsals.ts).
     */
    isRehearsal: boolean("is_rehearsal").notNull().default(false),
    /**
     * **When the stale-roll-call alert went out for this departure** (batch
     * 6, item 6; `sendStaleRollCallAlerts`, src/db/roll-call-alerts.ts): an
     * after-dive roll call still open half an hour after the boat was due
     * back. The hourly pass claims it with a conditional update, so the alert
     * goes once per departure however many passes see the count still open.
     * Null until then, and for ever on a departure whose count closed in time.
     */
    rollCallAlertedAt: timestamp("roll_call_alerted_at", { withTimezone: true }),
    /**
     * **When the shop's shore contact was told** (H-118): the same alert's
     * shore copy, claimed on its own so a failed shore send is tried again on
     * the next pass and a delivery ashore never reads as "Owners alerted".
     * Null until then, and for ever on a shop with no confirmed shore contact.
     */
    rollCallShoreAlertedAt: timestamp("roll_call_shore_alerted_at", { withTimezone: true }),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // Composite tenant key for rows that must prove both trip identity and
    // shop ownership in the database (offline manifest revision counters).
    uniqueIndex("trips_shop_id_id_unique").on(table.shopId, table.id),
    index("trips_shop_starts_idx").on(table.shopId, table.startsAt),
    // A rehearsal is private as well as flagged, so every public listing that
    // already leaves private departures out leaves it out too, by construction.
    check("trips_rehearsal_is_private", sql`not ${table.isRehearsal} or ${table.isPrivate}`),
    index("trips_series_starts_idx").on(table.seriesId, table.startsAt),
    // Foreign keys a query filters on (#2492): a course's departures
    // (progression, materials, forms) and a hull's upcoming departures (the
    // certificate edit locks them, the clash check reads them). Other
    // reads scope by `shop_id` first and ride the shop/starts_at indexes.
    index("trips_course_starts_idx").on(table.courseId, table.startsAt),
    index("trips_boat_starts_idx").on(table.boatId, table.startsAt),
    // Partial, over the live rows only: every listing read carries
    // `deleted_at is null`, and a deleted departure is rare enough that
    // indexing the tombstones alongside them would pay for nothing.
    index("trips_shop_live_starts_idx")
      .on(table.shopId, table.startsAt)
      .where(sql`${table.deletedAt} is null`),
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
    check(
      "trips_planned_dives_range",
      sql`${table.plannedDives} between 1 and 4 or (${table.courseId} is not null and ${table.plannedDives} = 5)`,
    ),
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
      "trips_snorkeler_price_nonnegative",
      sql`${table.snorkelerPriceCents} is null or ${table.snorkelerPriceCents} >= 0`,
    ),
    // `WETSUIT_THICKNESS_MM` in src/lib/gear.ts, which the details form reads.
    check(
      "trips_wetsuit_thickness_mm_range",
      sql`${table.wetsuitThicknessMm} is null or ${table.wetsuitThicknessMm} between 1 and 10`,
    ),
    check(
      "trips_rider_price_nonnegative",
      sql`${table.riderPriceCents} is null or ${table.riderPriceCents} >= 0`,
    ),
    check(
      "trips_diver_capacity_range",
      sql`${table.diverCapacity} is null or ${table.diverCapacity} between 1 and 60`,
    ),
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
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("trip_dives_trip_number_unique").on(table.tripId, table.diveNumber),
    index("trip_dives_trip_idx").on(table.tripId, table.diveNumber),
    // "Which departures dive this site" (dive-sites.ts), a read by site alone.
    index("trip_dives_dive_site_idx").on(table.diveSiteId),
    // The same bounds `DOCK_DAY_LIMITS.boatRideMinutes` puts on the shop-wide
    // figure this falls back to (src/lib/diver-planning.ts), so an import or a
    // hand-written fix cannot write a leg the form would have refused.
    check(
      "trip_dives_travel_minutes_range",
      sql`${table.travelMinutes} is null or (${table.travelMinutes} >= 0 and ${table.travelMinutes} <= 480)`,
    ),
  ],
);

/** Recorded facts from a completed dive; planned trip details remain immutable evidence. */
/**
 * **Why the boat did not dive the plan** (issue #1184, delight report D24).
 *
 * Four codes, not a sentence: this reaches a diver's own record, so it is
 * worded per reader (`planChangeReasonText`) rather than typed once in
 * English. The values are the four the canvas drew — current, weather, vis, or
 * the crew's own call — and the fourth is deliberately the honest one: a
 * skipper who moved the boat because they judged it better is the commonest
 * real reason and the one a coded list usually launders into "conditions".
 *
 * It never touches `trip_dives`. The plan a shop published stays exactly where
 * it was written; this says what happened instead, which is D24's whole
 * boundary — record the change, never overwrite the plan.
 */
export const planChangeReason = pgEnum("plan_change_reason", PLAN_CHANGE_REASONS);

export const executedDives = pgTable(
  "executed_dives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    diveNumber: integer("dive_number").notNull(),
    actualSiteId: uuid("actual_site_id").references(() => diveSites.id),
    enteredAt: timestamp("entered_at", { withTimezone: true }),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    maxDepthMeters: doublePrecision("max_depth_meters"),
    observedConditions: jsonb("observed_conditions")
      .$type<Record<string, unknown> | null>()
      .default(null),
    /** Explicit field-level omissions, e.g. `max_depth`, rather than fake zeroes. */
    notRecorded: jsonb("not_recorded").$type<string[]>().notNull().default([]),
    /**
     * **One species the crew actually saw on this dive** (issue #1190, delight
     * report D30). A `MARINE_LIFE_CATALOG` slug, so what a diver reads is
     * DiveDay's copy in their own language (ADR
     * 20260813-marine-life-is-diveday-copy).
     *
     * The whole point is the verb. `dive_site_creatures` says what a site
     * *might* show you and is the shop's standing claim about a reef; this says
     * what somebody *did* see, once, on one dive. They draw from the same
     * catalog and they must never be the same column, because publishing the
     * first as the second would be inventing a sighting — the one thing D30's
     * boundary rules out.
     *
     * Null is the ordinary state and stays silent. It is deliberately not in
     * `not_recorded` beside `depth`: a depth nobody wrote down is a hole in a
     * record that should have one, and a dive where nothing stood out is just a
     * dive. There is nothing to declare.
     *
     * One, not many. A list would turn a moment into an inventory, and the
     * surface it reaches is a logbook card, not a species checklist.
     */
    observedSpeciesSlug: text("observed_species_slug"),
    /**
     * **Why the actual site is not the planned one** (issue #1184, D24). A code
     * so it can be worded in the diver's own language; null is the ordinary
     * state, including for a dive that went exactly to plan.
     *
     * Never inferred. A crew that changed site and said nothing about why has a
     * record that says the site changed, which is the true thing.
     */
    planChangeReason: planChangeReason("plan_change_reason"),
    /**
     * A short note **for the shop**, never printed to a diver. The one place
     * this record carries free text, bounded at 280 characters and refused
     * without a reason beside it — D27's boundary is "do not create a second
     * staff chat", and a note box with no code above it is exactly that.
     */
    planChangeNote: text("plan_change_note"),
    recordedByPersonId: uuid("recorded_by_person_id").references(() => people.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    // Leads on the person column so deleting a person (a demo shop's cascade,
    // `discardUnusedBuyer`) probes this foreign key by index, not by scanning
    // every shop's rows; a (shop_id, …) composite cannot serve that probe.
    // `people-fk-indexes.test.ts` holds the list (fourth review, row 31).
    index("executed_dives_recorded_by_person_id_idx").on(table.recordedByPersonId),
    uniqueIndex("executed_dives_trip_number_live_unique")
      .on(table.tripId, table.diveNumber)
      .where(sql`${table.deletedAt} is null`),
    index("executed_dives_shop_trip_idx").on(table.shopId, table.tripId, table.diveNumber),
    check("executed_dives_number_positive", sql`${table.diveNumber} >= 1`),
    check(
      "executed_dives_depth_nonnegative",
      sql`${table.maxDepthMeters} is null or ${table.maxDepthMeters} >= 0`,
    ),
    check(
      "executed_dives_exit_after_entry",
      sql`${table.enteredAt} is null or ${table.exitedAt} is null or ${table.exitedAt} > ${table.enteredAt}`,
    ),
    check(
      "executed_dives_plan_change_note_length",
      sql`${table.planChangeNote} is null or (length(trim(${table.planChangeNote})) between 1 and 280)`,
    ),
    check(
      "executed_dives_plan_change_note_needs_reason",
      sql`${table.planChangeNote} is null or ${table.planChangeReason} is not null`,
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
    ...requirementColumns(),
    /** Whether a diver must have paid (or a deposit/waiver) to board. */
    requiresPayment: boolean("requires_payment").notNull().default(false),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [index("trip_requirements_shop_idx").on(table.shopId)],
);

export type Trip = typeof trips.$inferSelect;

export type TripDive = typeof tripDives.$inferSelect;

export type ExecutedDive = typeof executedDives.$inferSelect;

export type TripRequirement = typeof tripRequirements.$inferSelect;

/**
 * **What a crew actually saw at a site, tallied** — the living reef.
 *
 * `dive_site_creatures` is the shop's standing claim about a reef, and
 * `executed_dives.observed_species_slug` is one species one crew member wrote
 * on one dive's record. This is the third thing and the one a diver deciding on
 * a Saturday can read: the running tally the crew builds by tapping a chip at
 * the rail, per departure and per site, which adds up over a month into "eagle
 * ray on 3 of the last 11 dives here".
 *
 * **A row is a count, not an event.** One live row per (trip, site, species):
 * the first tap inserts it at 1, every later tap on the same chip increments
 * it. Two turtles on one dive is a fact about that dive; a hundred rows saying
 * "turtle" would be a fact about a thumb. That also makes the write idempotent
 * enough to survive a double-tap on a wet screen without inventing a school.
 *
 * **The site is required and its name is snapshotted.** The public read is per
 * site — "seen here this month" — so a sighting with no site has no reader, and
 * the crew's group only appears once the dive has one. The name is copied at
 * record time so a shop that renames or deletes a site later still has a legible
 * log; the id is what the monthly read groups by.
 *
 * **It informs and gates nothing.** Nothing in `src/lib/readiness.ts` or
 * `src/lib/trip-admission.ts` reads this table, it sits nowhere near the roll
 * call's commit path or the manifest's head count, and a shop that never taps a
 * chip has a product that looks exactly as it did.
 */
export const tripSightings = pgTable(
  "trip_sightings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    diveSiteId: uuid("dive_site_id")
      .notNull()
      .references(() => diveSites.id),
    /** The site's name as it stood when the crew tapped, so a rename never rewrites the log. */
    diveSiteName: text("dive_site_name").notNull(),
    /**
     * A `MARINE_LIFE_CATALOG` slug, refused by `recordTripSighting` when the
     * catalog does not carry it. Never free text: what a diver reads is
     * DiveDay's copy in their own language (ADR
     * 20260813-marine-life-is-diveday-copy), and a slug with no words would
     * reach a public page as punctuation.
     */
    speciesSlug: text("species_slug").notNull(),
    /** How many the crew tapped for. At least one — a row at zero is a delete. */
    count: integer("count").notNull().default(1),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    /** When the first tap landed; `updated_at` moves with every later one. */
    recordedAt: appNowTimestamp("recorded_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    // The tally's identity: one live row per species per site per departure, so
    // a second tap lands on the first one's row rather than beside it.
    uniqueIndex("trip_sightings_trip_site_species_live_unique")
      .on(table.tripId, table.diveSiteId, table.speciesSlug)
      .where(sql`${table.deletedAt} is null`),
    // The crew's own read: this departure's tally, at a checkpoint.
    index("trip_sightings_shop_trip_idx").on(table.shopId, table.tripId),
    // The public read: one site's last month, newest first.
    index("trip_sightings_site_recorded_idx").on(table.diveSiteId, table.recordedAt),
    check("trip_sightings_count_positive", sql`${table.count} >= 1`),
  ],
);

export type TripSighting = typeof tripSightings.$inferSelect;
