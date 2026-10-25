import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
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
import { PARTICIPANT_TYPES } from "@/lib/participant-types";
import { TURN_AWAY_REASONS } from "@/lib/turn-away";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * Seats: `bookings`, help requests, waitlist, invitations, the last-minute list
 * and promos, booking capabilities and referrals.
 */

/**
 * What a flagged booking was matched to its person by (H-13): a reused email
 * under a different name, or a name a staffer picked off the counter's
 * "is this the same diver?" prompt. Read only to tell the staffer why the seat
 * is held; it gates nothing the flag itself does not.
 */
export const identityMatchKind = pgEnum("identity_match_kind", ["shared_email", "picked_name"]);

export const bookingStatus = pgEnum("booking_status", [
  "booked",
  "checked_in",
  "cancelled",
  "no_show",
]);

/**
 * **Why the desk turned a diver away** (safety sheet 2026-10-15, item 6;
 * H-135): one category from that seat's own readiness blockers, never the
 * evidence behind it. Kept in step with `TURN_AWAY_REASONS` in
 * `src/lib/turn-away.ts`.
 */
export const turnAwayReason = pgEnum("turn_away_reason", TURN_AWAY_REASONS);

/**
 * **What this person is doing on the boat** (ADR 20261007-participant-types).
 *
 * A diver dives; a snorkeler is in the water on the surface with no tank; a
 * rider stays aboard. All three are a seat, a body the crew counts at every
 * checkpoint, and a waiver. Only a diver is asked for a certification card, put
 * on a buddy team, or packed tanks for. Kept in step with `PARTICIPANT_TYPES`
 * in `src/lib/participant-types.ts`.
 */
export const participantType = pgEnum("participant_type", PARTICIPANT_TYPES);

/** A small, non-medical day-of request a diver can make from `/ready`. */
export const tripHelpRequestKind = pgEnum("trip_help_request_kind", [
  "carry_gear",
  "first_timer",
  "find_group",
]);

/** The visible hand-off state for a day-of request. */
export const tripHelpRequestStatus = pgEnum("trip_help_request_status", [
  "requested",
  "acknowledged",
  "handled",
  "withdrawn",
]);

/**
 * **How recently this diver has been in the water** — their own word, in coarse
 * bands rather than a date (ADR 20260821-currency-is-what-catches-people).
 *
 * Not a card and deliberately not in `certifications`: it is a self-report about
 * *behaviour*, it does not expire, and nothing verifies it. An honest "Advanced
 * Open Water, 1998" with no dive since 2013 is the claim that hurts a shop, and
 * no rung on the ladder can express it.
 *
 * Bands, not a date, because the answer is worth exactly as much as the diver's
 * memory. Somebody who last dived "a few years back" cannot name the month, and
 * a date field would invite them to invent one that then reads as precision
 * nobody earned.
 *
 * `never` is a real answer and distinct from the level question's "I'm not
 * certified yet": a diver certified last month who has not been in open water
 * since their course is exactly the person a divemaster wants to know about.
 */
export const diveRecencyBand = pgEnum("dive_recency_band", [
  "this_season",
  "within_a_year",
  "one_to_five_years",
  "over_five_years",
  "never",
]);

/**
 * **What this dive is for, in the diver's own words** — one optional choice on
 * the booking form (ADR 20260904-reef-all-the-way-down, D12/#1172).
 *
 * Five plain answers rather than a free-text box, because the crew reads a
 * *count*: "4 came for an easygoing reef, 2 are getting comfortable again" is a
 * sentence a divemaster can act on, and a paragraph per seat is not.
 *
 * **A soft cue, never a promise or a pairing rule.** Nothing here gates a
 * booking, ranks a diver, or builds a buddy team; a shop that reads it and does
 * nothing has lost nothing.
 */
export const diveIntent = pgEnum("dive_intent", [
  "easing_back",
  "small_life",
  "a_wreck",
  "skills",
  "good_day",
]);

/**
 * **What a first-timer chose to tell the crew** (issue #2425, delight report
 * D22), asked on `/ready` beside the `welcome_shared_at` consent and nowhere
 * else. A fixed choice, never free text: a free-text channel to the crew can
 * carry medical details onto a roster, and three true things give the crew
 * something to say hello with. Not a safety signal and not a gate — a diver who
 * is nervous is told hello to, and any real concern goes through the medical
 * path.
 */
export const welcomeHello = pgEnum("welcome_hello", ["first_ocean_dive", "celebrating", "nervous"]);

/**
 * **The one support a diver easing back asked for** (ADR
 * 20260904-reef-all-the-way-down, D18/#1178). Offered only to a diver who has
 * just said they are getting comfortable again, and only when the departure is
 * far enough out that the shop can still act on it.
 *
 * **None of these gates a booking**, and none of them is a warning: D18's
 * boundary is support without shame and without a silent gate.
 */
export const reEntryAsk = pgEnum("re_entry_ask", [
  "deck_word",
  "easy_first_dive",
  "refresher_course",
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
    /**
     * The rental kinds ticked and paid for at checkout, kept on the booking
     * itself. Every seat writes it; it matters for a **held seat**
     * (`identity_unconfirmed_at`), which writes nothing to the matched
     * person's fit, so without this the paid gear would vanish from the rack.
     * Prep lists a held seat's kinds as unsized "fit at check-in" lines, and
     * "Same person" offers to copy them into the fit. Never nitrox (that is
     * `wants_nitrox`).
     */
    paidRentalKinds: jsonb("paid_rental_kinds").$type<string[]>().notNull().default([]),
    /**
     * **Diver, snorkeler or rider** (ADR 20261007-participant-types). Every
     * type holds a seat against `trips.capacity` and is counted at every
     * roll-call checkpoint; only a diver also holds one against
     * `trips.diver_capacity`, is asked for a card, and can be on a buddy team.
     * A held seat that is not a diver's never carries a nitrox request.
     */
    participantType: participantType("participant_type").notNull().default("diver"),
    /**
     * **What this seat was sold as**, written once when the booking is made and
     * never changed after (ADR 20261007-participant-types). A seat that was
     * booked to dive and is now snorkeling or riding carries a warning-toned
     * "booked as diver" note on every crew surface, because the card check it
     * no longer faces is one it was sold under: a change of type at the desk is
     * the one door that clears a certification block without a card, and the
     * crew at the rail should be able to see it was used. Every writer that
     * makes a seat states what it sold, so a snorkeler inserted by a path that
     * forgot cannot read as "booked as diver". No default, so an insert that
     * forgets it fails to compile: the `diver` default was only the expand half
     * of expand/contract, for the one release whose predecessor's inserts could
     * not name it, and was dropped once that release served (issue #2222).
     */
    bookedAs: participantType("booked_as").notNull(),
    conditionsBriefedAt: timestamp("conditions_briefed_at", { withTimezone: true }),
    /**
     * **The diver answered "Anything changed?" for this seat** (ADR
     * 20260904-reef-all-the-way-down, D15 with D19 folded in) — by saying
     * nothing changed, or by changing one of the three facts the question
     * covers. Acting on a fact *is* answering it.
     *
     * Per booking rather than per person, because the question is "since last
     * time" and it is asked once per departure: a diver who confirmed their
     * sizes in March is not thereby answering for a November boat. Null is the
     * ordinary absent state and nothing backfills it.
     */
    carriedFactsConfirmedAt: timestamp("carried_facts_confirmed_at", { withTimezone: true }),
    /**
     * The diver's own answer to "when did you last dive?", asked on `/ready`
     * (ADR 20260821-currency-is-what-catches-people). Null is "not said" — a
     * real state, never a default that reads as a claim.
     *
     * **On the booking rather than the person**, because currency is a fact with
     * a date on it: an answer given in March is not evidence about a diver
     * booking again in November, and a person-level column would quietly become
     * one. Staff read the answer beside the seat it was given for; "their most
     * recent answer" is a query over their bookings, not a stored value that
     * silently goes stale.
     *
     * **Gates nothing.** No readiness blocker, no admission decision, no filter.
     * "Last dived 5+ years ago" is a refresher conversation a divemaster has,
     * not a refusal the software makes.
     *
     * **Erasure takes it** (issue #1404). It is coarse and it names nobody, so
     * a case could be made that it describes the departure rather than the
     * diver — but it is an answer a person gave about themselves, and after an
     * erasure there is nobody it is about. `dive_intent` and `re_entry_ask`
     * below are the same kind of value, both cite this column by name for why
     * they sit on the booking, and both have always been cleared; the
     * consistency is the point, and no reader's numbers change, because an
     * aggregate over erased seats would have to exclude them anyway.
     */
    lastDivedBand: diveRecencyBand("last_dived_band"),
    /**
     * The diver's own answer to "what's this dive for?", asked on the booking
     * form and changeable on `/ready` (ADR 20260904-reef-all-the-way-down,
     * D12). Null is "not said" — a real state, never a default that reads as a
     * claim.
     *
     * **On the booking rather than the person**, for the same reason
     * `last_dived_band` above is: it is a fact with a date on it. What a diver
     * came for in March says nothing about the trip they book in November, and
     * a person-level column would quietly become that claim.
     *
     * **Gates nothing and names nobody.** The crew reads the departure's tally,
     * not a row per seat.
     */
    diveIntent: diveIntent("dive_intent"),
    /**
     * The one support this diver asked for when they said they were easing back
     * (ADR 20260904-reef-all-the-way-down, D18). Null is "asked for nothing",
     * which is every booking that never saw the question.
     *
     * On the booking for the reason above, and **gates nothing**: it is a line
     * the crew answers, never a blocker on a seat.
     */
    reEntryAsk: reEntryAsk("re_entry_ask"),
    /** Optional lodging / hotel pickup address or landmark provided by the diver on /ready. */
    hotelPickupLocation: text("hotel_pickup_location"),
    /**
     * This diver's meal preference for the galley, as they wrote it on /ready
     * or the desk did on the roster (fifth-loop ideas, item 56), asked only on
     * a departure with lunch aboard. Not an allergy record (dive-domain review
     * B1): the question's hint sends a food allergy to the shop.
     */
    dietaryNote: text("dietary_note"),
    /** Optional staff-set pickup time for this booking (e.g., "07:15"). */
    pickupTime: text("pickup_time"),
    status: bookingStatus("status").notNull().default("booked"),
    /**
     * **The desk saw this diver and turned them away**, and why: one category
     * from the seat's own blockers (`turnAwayReasons`, src/lib/turn-away.ts).
     * Set with `status = 'no_show'` by `turnBookingAway` (src/db/turn-away.ts),
     * which frees the seat exactly as a no-show does; null on a plain "Not
     * here", which records that the diver did not arrive.
     *
     * A category only — never a medical answer or a card's details. The check
     * below keeps it off any seat that holds a place on the boat, so every
     * writer that puts a released seat back clears it. Erasure clears it too
     * (`medical` is health-adjacent) and keeps `turned_away_at`.
     */
    turnedAwayReason: turnAwayReason("turned_away_reason"),
    /**
     * **When the desk turned this diver away** (layer 3 review, 2026-10-16):
     * the fact, apart from its category, so erasure can clear the reason and
     * the record still never reads "did not arrive". Set with the reason by
     * `turnBookingAway`; cleared with it by every writer that puts the seat
     * back. A turned-away seat later removed keeps it ("turned away, then
     * removed"); a split keeps it and clears only the reason.
     */
    turnedAwayAt: timestamp("turned_away_at", { withTimezone: true }),
    /**
     * **The diver said they are running late** (J3): the instant they tapped
     * "Running late" on `/ready` or replied LATE to a shop message
     * (`src/db/running-late.ts`). Null is the ordinary state. The first
     * statement stands — a second tap or a redelivered reply changes nothing —
     * and the counter's check-in clears it, because an arrived diver is no
     * longer late. Gates nothing: the arrivals list says it instead of a
     * blank, and readiness, admission and boarding never read it.
     */
    runningLateAt: timestamp("running_late_at", { withTimezone: true }),
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
     * The name this booking was made under when that differs from the matched
     * person's, written with `identity_unconfirmed_at` and cleared with it.
     * It is what lets a staffer see the question ("booked as Sam Rivera, on
     * record as Alex Rivera") and, when the answer is "not the same person",
     * what the split-off diver record is named (`splitBookingIdentity`).
     * Null on every booking that was never flagged.
     */
    identityBookedAs: text("identity_booked_as"),
    /** Why the flag was raised — see {@link identityMatchKind}. Set and cleared with it. */
    identityMatchedBy: identityMatchKind("identity_matched_by"),
    /**
     * **An emergency contact for the person on a held seat** (issue #2145,
     * Aaron 2026-10-13, option b). While `identity_unconfirmed_at` is set the
     * matched record's contact is withheld from the manifest, its sheet and the
     * crew phone's copy, because it is somebody else's next of kin; the desk
     * writes the contact for the person in front of them here instead, never on
     * the matched record. Read only while the seat is held, in place of the
     * withheld one; copied onto the new record at a split and cleared there and
     * at a confirm. A pair or nothing (`bookings_held_emergency_contact_pair`).
     */
    heldEmergencyContactName: text("held_emergency_contact_name"),
    heldEmergencyContactPhone: text("held_emergency_contact_phone"),
    /**
     * **A reschedule notice this seat was skipped for** (#2445). While
     * `identity_unconfirmed_at` is set the reschedule notice does not go (the
     * address may be somebody else's), and nothing re-sends it when staff
     * confirm. So the skip leaves this behind: the start the seat last knew,
     * kept as the earliest of any skipped moves, and whether the meeting point
     * moved too. Confirming the diver sends the one catch-up notice and clears
     * both; null and false on every seat that missed nothing.
     */
    rescheduleMissedFrom: timestamp("reschedule_missed_from", { withTimezone: true }),
    rescheduleMissedPlace: boolean("reschedule_missed_place").notNull().default(false),
    /**
     * **The fly-safe wait the night-before email told this seat, in hours**
     * (issue #2927; H-150). Written once that email is sent with the line, so
     * a departure later marked as decompression diving knows exactly who holds
     * a figure that no longer applies. Null on every seat told nothing.
     */
    flySafeHoursTold: integer("fly_safe_hours_told"),
    /**
     * When this seat was sent the one correction to that figure (issue
     * #2927), claimed before the send so a diver hears it once. Null while
     * nothing is owed or the correction has not gone.
     */
    flySafeCorrectedAt: timestamp("fly_safe_corrected_at", { withTimezone: true }),
    /**
     * **Whoever booked this seat said its diver is under 18** (the "Under 18"
     * box on the public party form; H-21 follow-up, decision of 2026-10-13).
     * The guardian co-signature rule reads it beside the date of birth
     * (`guardianSignatureRequired`): a date of birth on file decides, and with
     * none this asks a parent or guardian to co-sign the release. It gates
     * nothing at the sale, so it is no age oracle, and it lives on the seat,
     * never the person, so an anonymous form can only mark the seat it
     * created. Null on every seat nobody said this about.
     */
    minorDeclaredAt: timestamp("minor_declared_at", { withTimezone: true }),
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
    /**
     * The partner whose link sent this diver — the slug the embed generator
     * wrote into `utm_campaign` (`partnerLinkUrl`, src/lib/embed-snippets.ts),
     * carried from the storefront visit to this booking by the short-lived
     * `diveday_ref` cookie and normalised again on the way in
     * (`partnerReferralSlug`, src/lib/referrals.ts). Null is the ordinary case:
     * most divers arrive without a partner link, and nothing about a booking
     * depends on this.
     *
     * **A slug, never a name, and never rendered** (issue #1294). It is a third
     * party's identity stored against a person's booking, so it is bounded and
     * character-restricted — and this comment used to go on to call it "the
     * shop's own label for a link it generated", which is what made an order
     * page print it. It is not. `partnerLinkUrl` writes no row, so nothing can
     * tell a hotel's slug from one an anonymous visitor invented by editing the
     * storefront URL and booking a seat. Every value here is
     * attacker-influenceable text until a stored partner list exists.
     *
     * So no surface prints it: the month's report counts these seats and names
     * none of them, and the order page's "Sent by" line is gone. The column
     * stays because the arrival is real and a partner list arriving later can
     * name these seats retroactively; the full-shop export still carries it,
     * which is a shop's own database handed back to it rather than a page
     * presenting a stranger's text as a fact.
     *
     * On the booking rather than the person for the same reason
     * `lastDivedBand` is: it is a fact about one visit. "Which hotel sends us
     * divers" is a query over bookings, not a value that silently goes stale on
     * a person who came back on their own the second time (issue #1285).
     */
    referralSource: text("referral_source"),
    /**
     * **The diver said the crew may know this is a first trip, or a long
     * return** (issue #1182, delight report D22). The consent stamp, and the
     * whole of it: what the cue then *says* is derived at read from this
     * diver's own booking history, so nothing about them is copied onto a row
     * and nothing goes stale.
     *
     * Null is the ordinary state and renders nothing — a cue nobody consented
     * to does not exist, which is what makes this a welcome rather than a
     * profile badge. Written and cleared by the diver on their own `/ready`
     * thread and nowhere else; staff cannot set it.
     *
     * On the booking rather than the person, for the reason `lastDivedBand`
     * above is: it is permission for **one departure's** crew, given on the
     * day. A person-level flag would quietly become standing permission for
     * every shop surface forever, which is the badge D22 exists to refuse.
     */
    welcomeSharedAt: timestamp("welcome_shared_at", { withTimezone: true }),
    /**
     * What the diver chose to add to the hello (issue #2425). **Only ever
     * non-null while `welcome_shared_at` is**: withdrawing the consent clears
     * it in the same write, and the staff readers return it only for a
     * consented seat. Cleared on erasure with the stamp it hangs from.
     */
    welcomeHello: welcomeHello("welcome_hello"),
    /**
     * **What the instructor told this student to do next** (issues #1196 and
     * #1205), written from the course session's own roster and read back by
     * the student on their recap.
     *
     * The instructor's own words, in the instructor's own language, printed
     * verbatim under their name — never DiveDay inferring a next step, and
     * never a credential. A note is refused outright on a departure with no
     * course (`recordCourseNextStep`), which is where the LMS boundary lives
     * in code rather than in a comment.
     *
     * All three columns move together, and clearing the words clears the
     * stamp and the author with them.
     */
    courseNextStep: text("course_next_step"),
    courseNextStepAt: timestamp("course_next_step_at", { withTimezone: true }),
    courseNextStepByPersonId: uuid("course_next_step_by_person_id").references(() => people.id),
    /**
     * **When a staffer marked this student's learning materials done, and who**
     * (ADR 20261008-course-learning-materials). Ticked on the course session's
     * roster; null is "not yet", which is what keeps the materials in the
     * week-out reminder and on the student's `/ready` page as a to-do.
     *
     * A staff record of what a student said or showed, never agency evidence:
     * no agency exposes an eLearning API (H-10), and nothing reads this as a
     * gate — admission and readiness never look at it. Refused on a departure
     * with no course (`recordCourseMaterialsDone`), the same LMS boundary as the
     * next step above. Both columns move together.
     */
    courseMaterialsDoneAt: timestamp("course_materials_done_at", { withTimezone: true }),
    courseMaterialsDoneByPersonId: uuid("course_materials_done_by_person_id").references(
      () => people.id,
    ),
    /**
     * **A training mark** (issue #2275, ADR
     * 20261012-course-forms-on-charters-and-counter): staff said this seat on
     * an ordinary departure carries a training dive for the course seat named
     * here (the enrollment). The seat is then asked that course's forms, and
     * signing them once on the enrollment covers both.
     *
     * Only ever a staff act on the departure's Divers tab, never inferred from
     * a diver's open enrollment or card level (`src/db/training-marks.ts`).
     * One enrollment per seat: a second mark is refused until this one is
     * cleared. Checked again at every read (`trainingMarkValidity`): a mark
     * whose enrollment is canceled, held, moved off a course or ends before
     * this departure sails raises `training_mark_invalid` until staff clear
     * it, so a stale mark never quietly relaxes boarding. A training mark is
     * not "In training": the booking gate never reads it.
     *
     * The three columns move together. The foreign key takes the default
     * action: a hard delete of a marked enrollment fails rather than clearing
     * the mark in silence.
     */
    trainingEnrollmentBookingId: uuid("training_enrollment_booking_id"),
    trainingMarkedAt: timestamp("training_marked_at", { withTimezone: true }),
    trainingMarkedByPersonId: uuid("training_marked_by_person_id").references(() => people.id),
    /**
     * **Who cleared a training mark that relaxed a boarding block, when, and
     * why**: its course forms still owed (`forms_owed`), or every form signed
     * but the mark no longer holding (`mark_invalid`). The manifest names who
     * did it. A new mark keeps the stamp, so the crew still read the earlier
     * decision; the next clear replaces it, with null when it relaxed nothing.
     * All three columns move together.
     */
    trainingClearedAt: timestamp("training_cleared_at", { withTimezone: true }),
    trainingClearedByPersonId: uuid("training_cleared_by_person_id").references(() => people.id),
    trainingClearedReason: text("training_cleared_reason", {
      enum: ["forms_owed", "mark_invalid"],
    }),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // The course seat a mark names is this shop's, in the database and not
    // only in every reader (security review U6): the key runs over the shop
    // too, against the (shop_id, id) pair below.
    foreignKey({
      name: "bookings_training_enrollment_fk",
      columns: [table.shopId, table.trainingEnrollmentBookingId],
      foreignColumns: [table.shopId, table.id],
    }),
    uniqueIndex("bookings_shop_id_id_unique").on(table.shopId, table.id),
    // The charter seats marked as training on one enrollment, and the foreign
    // key's probe when a booking is deleted.
    index("bookings_training_enrollment_idx")
      .on(table.trainingEnrollmentBookingId)
      .where(sql`${table.trainingEnrollmentBookingId} is not null`),
    // A mark nobody is recorded as having made is not one boarding may read.
    check(
      "bookings_training_mark_attributed",
      sql`(${table.trainingEnrollmentBookingId} is null) = (${table.trainingMarkedAt} is null)
        and (${table.trainingMarkedAt} is null) = (${table.trainingMarkedByPersonId} is null)`,
    ),
    check(
      "bookings_training_cleared_attributed",
      sql`(${table.trainingClearedAt} is null) = (${table.trainingClearedByPersonId} is null)
        and (${table.trainingClearedAt} is null) = (${table.trainingClearedReason} is null)
        and (${table.trainingClearedReason} is null or ${table.trainingClearedReason} in ('forms_owed', 'mark_invalid'))`,
    ),
    check(
      "bookings_training_mark_not_self",
      sql`${table.trainingEnrollmentBookingId} is null or ${table.trainingEnrollmentBookingId} <> ${table.id}`,
    ),
    // Leads on the person column so deleting a person (a demo shop's cascade,
    // `discardUnusedBuyer`) probes this foreign key by index, not by scanning
    // every shop's rows; a (shop_id, …) composite cannot serve that probe.
    // `people-fk-indexes.test.ts` holds the list (fourth review, row 31).
    index("bookings_person_id_idx").on(table.personId),
    uniqueIndex("bookings_trip_person_unique").on(table.tripId, table.personId),
    // Enriched air is a gas a diver breathes; a snorkeler or a rider asking for
    // it is a write that went wrong somewhere, and the prep list would pack it.
    check(
      "bookings_nitrox_is_a_divers",
      sql`not ${table.wantsNitrox} or ${table.participantType} = 'diver'`,
    ),
    // A next step nobody is recorded as having written is not one a student
    // should read, and a stamp with no words under it renders nothing.
    check(
      "bookings_course_next_step_attributed",
      sql`(${table.courseNextStep} is null) = (${table.courseNextStepAt} is null)
        and (${table.courseNextStepAt} is null) = (${table.courseNextStepByPersonId} is null)`,
    ),
    check(
      "bookings_course_next_step_bounded",
      sql`${table.courseNextStep} is null
        or (length(btrim(${table.courseNextStep})) > 0 and length(${table.courseNextStep}) <= 280)`,
    ),
    // A name nobody can ring, or a number with nobody to ask for, is not a
    // contact the crew can use (`readEmergencyContact`'s rule, held here too).
    check(
      "bookings_held_emergency_contact_pair",
      sql`(${table.heldEmergencyContactName} is null) = (${table.heldEmergencyContactPhone} is null)`,
    ),
    // A tick nobody is recorded as having made is not one the roster may show.
    check(
      "bookings_course_materials_done_attributed",
      sql`(${table.courseMaterialsDoneAt} is null) = (${table.courseMaterialsDoneByPersonId} is null)`,
    ),
    // A turn-away on a seat that is on the boat is a record contradicting itself:
    // only a released seat (or one given up since) can carry it.
    check(
      "bookings_turned_away_is_released",
      sql`${table.turnedAwayAt} is null or ${table.status} in ('no_show', 'cancelled')`,
    ),
    // A reason with no turn-away is a category about nothing. The reverse is
    // allowed: erasure clears the category and keeps the fact.
    check(
      "bookings_turned_away_reason_has_time",
      sql`${table.turnedAwayReason} is null or ${table.turnedAwayAt} is not null`,
    ),
    index("bookings_trip_idx").on(table.tripId),
    /** Backs the diver-record lookups (getDiverProfile, payment/booking history joins). */
    index("bookings_shop_person_idx").on(table.shopId, table.personId),
    /** Backs the organizer's "who has claimed" panel — member seats by their lead. */
    index("bookings_party_lead_idx").on(table.partyLeadBookingId),
    /**
     * Backs the referred-seat count on Reports — one shop's seats carrying any
     * partner slug. There is no `group by` any more (issue #1294): the report
     * is a count, so this covers the `shop_id` + is-not-null half of it. Two
     * columns, not three: the report's month window is on `trips.starts_at`,
     * never on `bookings.created_at`, so a third column here would buy the
     * query that names it nothing.
     */
    index("bookings_shop_referral_idx").on(table.shopId, table.referralSource),
  ],
);

/**
 * One small, non-medical request from a diver for this departure. It is a
 * single mutable hand-off rather than a notes stream: the staff queue needs
 * one thing to settle, and the diver needs one visible answer. Past trips keep
 * their rows for auditability, but readers only surface requests before the
 * departure has ended.
 */
export const tripHelpRequests = pgTable(
  "trip_help_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    kind: tripHelpRequestKind("kind").notNull(),
    /** Monotonic form token; changes even when status/helper return to earlier values. */
    revision: integer("revision").notNull().default(0),
    status: tripHelpRequestStatus("status").notNull().default("requested"),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    /** The crew member the desk spoke with and assigned to this request. */
    helperPersonId: uuid("helper_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    /** Staff member who recorded the latest hand-off or completion. */
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("trip_help_requests_booking_unique").on(table.bookingId),
    index("trip_help_requests_shop_status_idx").on(table.shopId, table.status, table.createdAt),
    index("trip_help_requests_trip_idx").on(table.tripId, table.createdAt),
    index("trip_help_requests_helper_person_idx").on(table.helperPersonId),
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
    /** Percent off, or null for a fixed-amount deal; exactly one of the two is set. */
    discountPercent: integer("discount_percent"),
    /**
     * A fixed amount off the whole booking, in minor units — "$20 off". Same
     * rule as a shop-wide code: once per checkout, never below zero.
     */
    discountAmountCents: integer("discount_amount_cents"),
    /** The human-typed code, e.g. "SAVE50-A1B2C3" — unique per shop's Stripe account. */
    code: text("code").notNull(),
    stripeCouponId: text("stripe_coupon_id"),
    stripePromotionCodeId: text("stripe_promotion_code_id"),
    /**
     * The redemption cap Stripe was given: the departure's open seats when the
     * deal went out. Kept so the checkout can hold the same cap where Stripe
     * cannot see it (a pass-through fee's one-off coupon). Null on a deal sent
     * before this column existed.
     */
    maxRedemptions: integer("max_redemptions"),
    /** Pinned to the trip's departure at creation; a later reschedule does not move it. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** How many last-minute-list entries the blast email actually went to. */
    recipientCount: integer("recipient_count").notNull().default(0),
    createdByPersonId: uuid("created_by_person_id").references(() => people.id),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("trip_last_minute_promos_trip_created_idx").on(table.tripId, table.createdAt),
    uniqueIndex("trip_last_minute_promos_shop_code_unique").on(table.shopId, table.code),
    check(
      "trip_last_minute_promos_discount_range",
      sql`${table.discountPercent} is null or ${table.discountPercent} between 5 and 90`,
    ),
    check(
      "trip_last_minute_promos_discount_amount_positive",
      sql`${table.discountAmountCents} is null or ${table.discountAmountCents} > 0`,
    ),
    check(
      "trip_last_minute_promos_one_discount",
      sql`(${table.discountPercent} is null) <> (${table.discountAmountCents} is null)`,
    ),
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
  // The door remembers who opened it (ADR 20260906-before-you-ask, decision
  // 3): ten minutes, minted by the diver's own thread and consumed by the
  // booking it leads to. The one purpose whose expiry is not the trip's.
  "handoff",
  // A course's forms and nothing else (ADR 20261008-course-forms): what staff
  // copy or send when the release is signed and the forms are not. It opens
  // `/ready/<token>/forms` and is refused by every other `/ready` door, so a
  // link handed over the counter cannot read or change the diver's trip prep.
  "course_forms",
]);

/**
 * A revocable, expiring bearer credential over one booking (CR-002/CR-003).
 * Unlike a waiver link, issuing a new capability does not supersede an
 * earlier still-valid one for the same booking+purpose — a diver may be
 * holding an earlier email's link and a later reminder's link at once, and
 * both should keep working until they individually expire or are revoked.
 * Only the hash is stored; the raw bearer token exists solely in the
 * response that issued it — except a live `course_forms` link, which is also
 * kept sealed (`token_sealed`) so a second send hands back the link the diver
 * already holds, the waiver link's rule (ADR 20260820-waiver-links-are-reused-not-reissued).
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
    issuedAt: appNowTimestamp("issued_at").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * The token sealed under `SECRET_ENCRYPTION_KEY`, for a live `course_forms`
     * row only; null for every other purpose, and nulled when the row is
     * revoked. `token_hash` is still what every lookup matches.
     */
    tokenSealed: text("token_sealed"),
    /**
     * True when the token left only inside a message to the contact on file
     * (an email or a text), never handed to the browser that asked for it.
     * A link the booking form or a seat claim redirects to proves only that
     * someone typed a name and an address, so what the page shows about the
     * person's *other* bookings ("Your days") waits for a delivered link
     * (security review of layer r5-4, F1). False unless the minter says so.
     */
    delivered: boolean("delivered").notNull().default(false),
    createdAt: appNowTimestamp("created_at").notNull(),
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

export type Booking = typeof bookings.$inferSelect;

export type TripLastMinutePromo = typeof tripLastMinutePromos.$inferSelect;

/**
 * **Which diver's link brought this seat** (ADR 20260908-one-hand, decision 6,
 * lever W: the buddy seat).
 *
 * The recap's "Bring a buddy next time" is a link to the shop carrying a
 * non-secret id derived from the recapping diver's own booking
 * (`src/lib/buddy-links.ts`). When a booking arrives behind one and the id
 * resolves, this row records it; when it does not, the seat books exactly as an
 * unreferred one does and nothing is written.
 *
 * **A count, never a reward.** No discount, no code, no balance — the shop is
 * told how many seats its divers brought, which is the whole of what the lever
 * promises. `bookings.referral_source` is the *partner* fact (a hotel's link)
 * and stays what it is; this is divers, and the two are never summed.
 *
 * **No personal data, and therefore no retention window of its own** (security
 * review of this slice, finding 5): a row is two booking ids and a timestamp.
 * Both bookings carry their own erasure and their own pruning, so there is
 * nothing here to age out that the seats either side of it do not already age
 * out.
 */
export const bookingReferrals = pgTable(
  "booking_referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** The new seat. One row per booking: a seat arrives from one link. */
    bookingId: uuid("booking_id")
      .notNull()
      .unique()
      .references(() => bookings.id),
    /** The booking whose recap carried the link. Always this shop's. */
    referredByBookingId: uuid("referred_by_booking_id")
      .notNull()
      .references(() => bookings.id),
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // The month's count on Reports.
    index("booking_referrals_shop_idx").on(table.shopId),
  ],
);

export type BookingReferral = typeof bookingReferrals.$inferSelect;
