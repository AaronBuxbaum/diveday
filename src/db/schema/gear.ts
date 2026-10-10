import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { orders } from "./payments";
import { boats } from "./trips";

/**
 * Rental fit profiles and the gear register: items, service events,
 * reservations and prior assignments.
 */

/**
 * The pieces of a **fit** that have a size to remember — the values of
 * `SIZED_RENTAL_KINDS` (`src/lib/rentals.ts`), mirrored so a stored
 * confirmation can only ever name one of them.
 *
 * Deliberately not `gear_item_kind` below: that one is the *register's*
 * alphabet and carries `regulator`, `tank` and a split `mask`/`fins`,
 * none of which has a size column on `rental_fit_profiles`. A confirmation
 * naming one of those could not be printed back to a diver against any size
 * the shop actually holds.
 *
 * `drysuit` was in that excluded company until issue 1414 gave it `drysuit_size`
 * below; it is a sized piece now, on a scale of its own, and belongs here.
 * `hood` and `gloves` joined it when they became two kinds with a size each
 * (H-102, issue #1816).
 */
export const rentalFitItem = pgEnum("rental_fit_item", [
  "bcd",
  "wetsuit",
  "boots",
  "mask_fins",
  "weights",
  "drysuit",
  "hood",
  "gloves",
]);

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
    /**
     * Which pieces the shop supplies. A diver with their own kit rents none.
     *
     * **Every `rents_*` column defaults to `false`**, these five included, and
     * that is the whole of the column's opinion: a row is a claim about what a
     * diver answered, and a row nobody has answered for claims nothing. These
     * five defaulted to `true` until issue #1793 — the core kit a shop stocks
     * for everyone — which put the assumption in the one place it does no work
     * and real harm. A form seeds its checkboxes from `defaultRented`
     * (`src/lib/rentals.ts`), which is where that product fact belongs and
     * where it stays; a row that exists *without* a form having run is
     * precisely the row that must claim nothing, and it was the one the
     * defaults spoke for.
     */
    rentsBcd: boolean("rents_bcd").notNull().default(false),
    rentsRegulator: boolean("rents_regulator").notNull().default(false),
    rentsWetsuit: boolean("rents_wetsuit").notNull().default(false),
    rentsMaskFins: boolean("rents_mask_fins").notNull().default(false),
    rentsWeights: boolean("rents_weights").notNull().default(false),
    /**
     * Optional add-ons — a diver usually owns a computer, and the rest are kit
     * a particular dive calls for rather than kit everybody takes. All default
     * **false**, so a shop that never ticks one in its catalog is exactly where
     * it was before these columns existed and no diver is ever packed
     * something they did not ask for.
     */
    rentsDiveComputer: boolean("rents_dive_computer").notNull().default(false),
    rentsGopro: boolean("rents_gopro").notNull().default(false),
    rentsDrysuit: boolean("rents_drysuit").notNull().default(false),
    /**
     * Two kinds, not one "hood & gloves" (H-102, issue #1816): a warm-water
     * diver takes gloves and no hood, a quarry diver takes both in different
     * thicknesses, and one checkbox with one size could say neither.
     *
     * `rents_hood_gloves`, the one kind they replace, has no reader or writer
     * left and stays only for the deploy: the release still serving while
     * this migration runs selects it, so it is the contract half of an
     * expand/contract pair and is dropped by the next migration (H-49 waives
     * the backfill, not the deploy window).
     */
    rentsHoodGloves: boolean("rents_hood_gloves").notNull().default(false),
    rentsHood: boolean("rents_hood").notNull().default(false),
    rentsGloves: boolean("rents_gloves").notNull().default(false),
    rentsTorch: boolean("rents_torch").notNull().default(false),
    rentsSmb: boolean("rents_smb").notNull().default(false),
    bcdSize: text("bcd_size"),
    wetsuitSize: text("wetsuit_size"),
    /**
     * The one add-on that carries a size (issue 1414), and it is **not** the
     * wetsuit's. A drysuit is sized on the manufacturer grid a rental wall is
     * racked from — a girth letter, a trailing `T` for the tall cut — so a
     * plain wetsuit value written here drops the axis the wall is racked by.
     * `text`, not an enum: the grid varies by manufacturer, staff record an
     * off-grid size as free text, and which codes the diver's own select
     * offers is the owner's open call (H-76).
     *
     * Most rental drysuits have their boots vulcanised on, so this size
     * answers for them too — there is no boot piece to pull off the rack
     * separately, which is why `rents_drysuit` pushes one packing piece where
     * `rents_wetsuit` pushes two (`src/lib/dive-prep.ts`). A fleet stocking
     * neoprene-sock suits worn with separate rock boots says so in this same
     * free text ("ML, rock boot 9"): no column records a rock-boot size, so
     * this is the one size field with no companion column or packing piece for
     * what it implies — the only one whose free text is load-bearing beyond the
     * size itself. Every size reaches the packing list verbatim; only this one
     * carries a second fact with nothing on the list to notice its loss.
     */
    drysuitSize: text("drysuit_size"),
    /**
     * **Free text, like the drysuit's, on both fit forms** (H-102, issue
     * #1816). A rental hood and rental gloves both rack by size *and*
     * thickness ("M, 5 mm", "L, 3 mm"); a closed select would need two axes and somebody
     * to own them, so the shop's own words reach the packing list verbatim.
     */
    hoodSize: text("hood_size"),
    gloveSize: text("glove_size"),
    bootSize: text("boot_size"),
    finSize: text("fin_size"),
    weightPreference: text("weight_preference"),
    /**
     * **The diver is in a drysuit** — their own or one of ours (H-78, issue
     * #1752). The one fact on this row about what the diver *wears* rather
     * than what the shop hands over, and the one the drysuit's safety signals
     * key on: the in-water weight check (`weightPreference` is a wetsuit
     * answer, short by the two to four kilos a drysuit adds, and short is the
     * direction that cannot hold a safety stop), fins sized up over the
     * drysuit boot, and the drysuit-card advisory (`src/lib/drysuit-card.ts`).
     * `rents_drysuit` used to stand in for it, which left every diver in their
     * own suit — most drysuit divers — with a wetsuit number on the rail, fins
     * packed to the bare foot and no advisory at all.
     *
     * A standing answer, not a per-trip one: the diver who dives dry in winter
     * and wet in summer will sometimes be wrong for one trip, which is the cost
     * H-78 accepted. Every fit form asks it as one choice with the wetsuit
     * columns (`SuitChoice`, `src/lib/rentals.ts`), so a stated fit always
     * carries an answer; `false` on a row nobody has stated is the same
     * "claims nothing" every `rents_*` column defaults to.
     *
     * The two checks below hold the suit columns to one suit (issue #1800): a
     * rented drysuit is a dry diver, and a dry diver is not renting a wetsuit.
     * `saveRentalFit` resolves a post that asks for both before it reaches them.
     */
    divesDry: boolean("dives_dry").notNull().default(false),
    note: text("note"),
    /**
     * When a **fit** was last stated — by the diver's own gear form or by staff
     * editing it. Null means this row exists for something other than a fit.
     *
     * There is exactly one such something today, and it is why this column
     * exists: since issue 627 the diver's free-text note ("titanium hip, I run
     * heavy") is its own question on `/ready`, saved by `saveRentalFitNote`,
     * which will create this row for a diver who has never touched the gear
     * form. `rentalFitLine` and the prep checklist read a null here as "no fit
     * recorded", exactly as they already read a missing row.
     *
     * **This used to be the only thing standing between a note and a six-piece
     * packing line.** Five of the eleven `rents_*` columns above defaulted to
     * `true` (the core kit), so a diver who had only left the crew a note would
     * otherwise have appeared on the boat's packing list renting a BCD, a
     * regulator, a wetsuit, a mask, fins and weights — no sizes, nobody having
     * asked for any of them. Issue #1755 put a second defence under that, every
     * creating writer laying `NOTHING_RENTED` (src/lib/rentals.ts) beneath its
     * insert; issue #1793 removed the hazard instead, and the five columns
     * default to `false` like the other six.
     *
     * The discriminator still earns its keep, and always did for a reason
     * beyond the defaults: it is what separates a note from a fit for every
     * reader, and no amount of explicit `false` makes a row with no answers
     * into an answer.
     */
    fitStatedAt: timestamp("fit_stated_at", { withTimezone: true }),
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
    /**
     * **A staffer kept this fit after a trip** — recall, never inference (issue
     * #1174, ADR 20260904-reef-all-the-way-down, D14).
     *
     * Distinct from `fit_stated_at` above, and the distinction is the whole
     * point: that column means *a fit was stated*, by the diver on their own
     * form or by staff typing what the diver said. These three mean *somebody
     * watched a unit come back in a different size and said keep it*. D14's
     * boundary is that the app learns only from a staff-confirmed outcome, so a
     * fact that ages naturally is the honest shape rather than a confidence
     * score nobody calibrated.
     *
     * Written only by `confirmRentalFitSize` (src/db/rental-fit.ts), which the
     * evening's one-tap "Keep it" calls; a diver's own save never touches any
     * of the three. Their absence is the ordinary state — most rows — and it
     * gates nothing: an unconfirmed fit is still the fit. The diver-facing
     * sentence renders nothing without all three, so this can never become
     * "somebody kept your fit".
     *
     * Modelled on the `needs_staff_fit_*` trio above and, like it, carries no
     * check constraint tying the three together: `fit_confirmed_by` is nulled
     * when a staffer is anonymized, and that must age the sentence out rather
     * than break the row.
     */
    fitConfirmedAt: timestamp("fit_confirmed_at", { withTimezone: true }),
    /** Who kept it. Attribution, never authorization — the same call `needs_staff_fit_by` makes. */
    fitConfirmedBy: uuid("fit_confirmed_by").references(() => people.id),
    /** Which piece they kept, so the sentence can name it beside the size on file. */
    fitConfirmedItem: rentalFitItem("fit_confirmed_item"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rental_fit_profiles_shop_person_unique").on(table.shopId, table.personId),
    index("rental_fit_profiles_shop_person_idx").on(table.shopId, table.personId),
    check(
      "rental_fit_profiles_rented_drysuit_is_dry",
      sql`not ${table.rentsDrysuit} or ${table.divesDry}`,
    ),
    check(
      "rental_fit_profiles_dry_rents_no_wetsuit",
      sql`not (${table.divesDry} and ${table.rentsWetsuit})`,
    ),
  ],
);

/**
 * What a tracked unit of rental gear is. Mirrors the prep list's
 * `RentalItemKind` (the seven rentable kinds plus `boots`), keeps mask and fins
 * as separate physical units, and adds the two
 * kinds a fleet has that a fit never mentions: `tank` — the compliance-heavy
 * unit with its own hydro/VIP clocks — and `other` for the odd tagged thing
 * (torch, SMB, camera tray) a shop still wants on the register. `o2_kit`,
 * `aed`, `first_aid_kit` and `flares` are the boat's **safety kit**: units
 * with expiry clocks that may live aboard one hull (`gear_items.aboard_boat_id`,
 * roadmap N-08). Keep aligned with `GearItemKind` in `src/lib/gear.ts`.
 */
export const gearItemKind = pgEnum("gear_item_kind", [
  "bcd",
  "regulator",
  "wetsuit",
  "boots",
  "mask",
  "fins",
  "weights",
  "dive_computer",
  "gopro",
  "tank",
  "drysuit",
  "hood",
  "gloves",
  "torch",
  "dpv",
  "smb",
  "reel",
  "camera",
  "nitrox_analyzer",
  "o2_kit",
  "aed",
  "first_aid_kit",
  "flares",
  "other",
]);

/**
 * A unit's fitness for renting: on the wall, or off it for bench work.
 * `needs_service` pulls a unit out of the assignable pool without losing it,
 * and the note beside it says why.
 *
 * There is deliberately no third value for the end of a unit's life. That was
 * `retired` until 2026-08-21, and it was a soft delete wearing a banned name
 * (ADR 20260820-every-delete-is-soft): a unit a shop is finished with is
 * *deleted*, which stamps `deleted_at` below and keeps every service event and
 * rental window attached to the row.
 */
export const gearItemStatus = pgEnum("gear_item_status", ["in_service", "needs_service"]);

/**
 * **How a rental set came home** (issue #1186, delight report D26).
 *
 * Three answers, and the first is the one a counter gives at 4pm on almost
 * every set: the gear is back and there is nothing to say. The other two are
 * exceptions and are the only ones that open any further detail.
 *
 * `fit_adjusted` is a fact about the *diver* — the size on file was not the
 * size that worked. `service_concern` is a fact about the *unit*.
 *
 * A `service_concern` deliberately does **not** write a `gear_service_events`
 * row. Those drive the clocks a shop uses to decide when a regulator gets bench
 * time, and a busy desk tapping "concern" for a scratched mask would turn "this
 * needs a technician" into "somebody was mildly annoyed" — the way any
 * badly-tuned alert dies. It raises a flag a technician promotes deliberately,
 * which keeps the service record something somebody chose to write.
 */
export const gearReturnOutcome = pgEnum("gear_return_outcome", [
  "all_good",
  "fit_adjusted",
  "service_concern",
]);

/**
 * What kind of care a service event records. `service` is the manufacturer
 * service (regulators, BCDs, computers); `hydro_test` and `visual_inspection`
 * are a tank's two independent compliance clocks; `o2_clean` is the nitrox
 * cleanliness renewal; `aed_pads` and `aed_battery` are an AED's two printed
 * expiry dates (replaced on their own schedules, so two clocks); `expiry` is
 * the one printed date a consumable carries — flares, a first-aid kit's
 * contents; `note` is a dated condition observation with no clock
 * of its own. Deliberately not a work order: no parts, no labor, no billing
 * (vision non-goal — DiveDay never repairs customer gear).
 */
export const gearServiceKind = pgEnum("gear_service_kind", [
  "service",
  "hydro_test",
  "visual_inspection",
  "o2_clean",
  "aed_pads",
  "aed_battery",
  "expiry",
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
     *
     * **`COLLATE "und-x-icu"` in the database**, set by
     * `drizzle/20261010081009_site-gear-course-collation` — the same treatment
     * `people.full_name` has (see its comment in `core.ts`). The type here is
     * plain `text` because drizzle-orm's pg-core has no way to say it, and a
     * later `pnpm db:generate` will not take it back off.
     *
     * On the column so that every `orderBy` over it inherits it with no query
     * edit: the gear register puts "Ángel" beside "Ana"
     * rather than after "Zoe", on PGlite and on a real server alike.
     * Deterministic, so the per-shop unique index stays byte equality.
     * `src/db/name-collation.test.ts` proves it.
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
    /**
     * **Which boat this piece of safety kit lives aboard** — "the AED on
     * Mantis I". Only a safety-kit kind carries one (`SAFETY_KIT_KINDS`,
     * `src/lib/boat-safety.ts`; `updateGearItem` clears it for any other
     * kind), and it is what lets the departure's pre-departure check name the
     * pads that expire on *that* hull's AED. Null is ordinary: kit kept
     * ashore, or a shop that never said.
     *
     * `set null` on the boat's side is never exercised — a boat is
     * soft-deleted (`boats.deleted_at`) — and a deleted boat's kit simply
     * stops appearing on any departure.
     */
    aboardBoatId: uuid("aboard_boat_id").references(() => boats.id, { onDelete: "set null" }),
    /**
     * Set when staff delete a unit (ADR 20260820-every-delete-is-soft). The row
     * stays, and so do its `gear_service_events` and `gear_reservations` — a
     * fleet's care history is the last thing a delete should take, and it is
     * what makes putting the unit back a single column write.
     *
     * `deleteGearItem` refuses a unit that is still provisioned (reserved for
     * later, or out on a rental now), so a stamped row is never one somebody is
     * waiting on. Every register read filters on this column.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Staff member who deleted it, so the act is not anonymous. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial on the live rows, so deleting "BCD #14" frees that tag for the
    // unit that replaces it on the wall — and `restoreGearItem` refuses rather
    // than resurrecting a second unit wearing the same tape.
    uniqueIndex("gear_items_shop_label_unique")
      .on(table.shopId, table.label)
      .where(sql`${table.deletedAt} is null`),
    // Partial for the same reason: every read that means "the fleet" carries
    // `deleted_at is null`, and deleted units are rare enough that indexing the
    // tombstones beside them would pay for nothing.
    index("gear_items_shop_kind_idx")
      .on(table.shopId, table.kind)
      .where(sql`${table.deletedAt} is null`),
    // The command palette searches all three (issue #719), and a B-tree cannot
    // serve `ilike '%query%'` — only pg_trgm's GIN similarity index can
    // (CR-018, same reasoning as `people_full_name_trgm_idx`). The tag is the
    // one the schema comment above calls "how a wet hand finds the row"; the
    // serial is what a recall or a service centre names.
    // The pre-departure check's one question of this table: what lives aboard
    // this hull. Partial, because almost every unit lives on the wall.
    index("gear_items_aboard_boat_idx")
      .on(table.aboardBoatId)
      .where(sql`${table.aboardBoatId} is not null and ${table.deletedAt} is null`),
    index("gear_items_label_trgm_idx").using("gin", sql`${table.label} gin_trgm_ops`),
    index("gear_items_serial_trgm_idx").using("gin", sql`${table.serialNumber} gin_trgm_ops`),
    index("gear_items_brand_model_trgm_idx").using("gin", sql`${table.brandModel} gin_trgm_ops`),
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
    /**
     * The *other* clock: how many dives this unit may make before the same work
     * comes round again. Manufacturers publish both and mean "whichever comes
     * first" — ScubaPro's regulators are 24 months **or** 100 dives — and a
     * rental fleet in season reaches the dive number long before the date.
     *
     * Null is the ordinary case and means only the date clock applies. The
     * count it is compared against is **derived, never stored**
     * (`divesSinceServiceByUnit`), so it can never disagree with the
     * reservations it is read from — and it is honest about being a floor
     * rather than a fact: it counts the dives this shop wrote down.
     */
    nextDueDives: integer("next_due_dives"),
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
    // A dive clock of zero or less is not a shorter interval, it is a typo:
    // it would read as overdue the instant it was written, on a unit nobody
    // has dived since.
    check(
      "gear_service_events_due_dives_positive",
      sql`${table.nextDueDives} is null or ${table.nextDueDives} > 0`,
    ),
  ],
);

/**
 * One unit assigned to either a booking or a known person for a date range — the fulfillment record
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
    /** Set only for a bookingless counter rental; see the holder-shape check below. */
    personId: uuid("person_id").references(() => people.id),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    /**
     * The invoice a **counter rental** was billed on, when it was billed at
     * all (`src/db/gear-counter-rentals.ts`). A link, never money: the price,
     * the tax and whether it was paid stay on `orders`, and a rental with no
     * order is an ordinary one (paid in cash, free, or a shop with no Stripe).
     * Null on every booking-held row — a trip rental is billed on the booking's
     * own order lines (ADR 20260815-minimal-gear-register, amended 2026-10-08).
     */
    orderId: uuid("order_id").references(() => orders.id),
    /** Inclusive shop-local calendar dates — a rental window, not an instant. */
    reservedFrom: date("reserved_from").notNull(),
    reservedUntil: date("reserved_until").notNull(),
    /** When the unit physically left the counter; null while merely reserved. */
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    /** When it came home. Non-null ends the reservation and frees the window. */
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    /**
     * **How it came home** (issue #1186). Null on a row returned before this
     * existed, and on the two paths that still close a reservation without
     * asking — a cancelled booking letting go of what it never collected, and
     * the unit page's own quick return. Absent means "nobody said", never
     * "all good": inventing the reassuring answer for a row nobody answered is
     * exactly what makes the other two worth reading.
     */
    returnOutcome: gearReturnOutcome("return_outcome"),
    /**
     * Condition on return, when worth writing down ("torn strap, needs look").
     *
     * Required by the writer when the outcome is `service_concern` and refused
     * as the whole record on its own: a flag with no words is a note a
     * technician cannot act on. Written since the register shipped and read by
     * nothing at all until #1186 — the detail was there and invisible.
     */
    returnNote: text("return_note"),
    /**
     * Dives the person did on a **counter rental**, told at the return; null
     * when nobody said. A booking-held reservation leaves it null, because its
     * dives are the departure's planned dives. Summed into a unit's dive clock
     * (`completedDivesByUnit`), so gear lent across the counter wears its
     * clock like gear that rode a boat.
     */
    divesLogged: integer("dives_logged"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gear_reservations_item_idx").on(table.gearItemId),
    index("gear_reservations_booking_idx").on(table.bookingId),
    index("gear_reservations_person_idx").on(table.personId),
    index("gear_reservations_order_idx").on(table.orderId),
    index("gear_reservations_shop_until_idx").on(table.shopId, table.reservedUntil),
    check("gear_reservations_window", sql`${table.reservedUntil} >= ${table.reservedFrom}`),
    check(
      "gear_reservations_dives_logged",
      sql`${table.divesLogged} is null or (${table.divesLogged} >= 0 and ${table.divesLogged} <= 200)`,
    ),
    check(
      "gear_reservations_one_holder",
      sql`(${table.bookingId} is not null and ${table.personId} is null) or (${table.bookingId} is null and ${table.personId} is not null)`,
    ),
  ],
);

/** Historical rental/assignment evidence imported from a prior system. */
export const priorGearAssignments = pgTable(
  "prior_gear_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    gearItemId: uuid("gear_item_id")
      .notNull()
      .references(() => gearItems.id),
    assignedFrom: date("assigned_from").notNull(),
    assignedUntil: date("assigned_until").notNull(),
    statusLabel: text("status_label"),
    sourceReference: text("source_reference"),
    note: text("note"),
    dedupeKey: text("dedupe_key").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("prior_gear_assignments_shop_gear_idx").on(
      table.shopId,
      table.gearItemId,
      table.assignedFrom,
    ),
    index("prior_gear_assignments_shop_person_idx").on(
      table.shopId,
      table.personId,
      table.assignedFrom,
    ),
    uniqueIndex("prior_gear_assignments_shop_dedupe_unique").on(
      table.shopId,
      table.personId,
      table.gearItemId,
      table.dedupeKey,
    ),
    check("prior_gear_assignments_window", sql`${table.assignedUntil} >= ${table.assignedFrom}`),
  ],
);

export type GearItem = typeof gearItems.$inferSelect;

export type GearItemKindValue = (typeof gearItemKind.enumValues)[number];

export type GearItemStatus = (typeof gearItemStatus.enumValues)[number];

export type GearServiceEvent = typeof gearServiceEvents.$inferSelect;

export type GearServiceKindValue = (typeof gearServiceKind.enumValues)[number];

export type GearReservation = typeof gearReservations.$inferSelect;

export type PriorGearAssignment = typeof priorGearAssignments.$inferSelect;
