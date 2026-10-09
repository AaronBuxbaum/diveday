import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
import { people, shops } from "./core";
import { courseInquiries } from "./courses";
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
     * forgot cannot read as "booked as diver". The default is only the expand
     * half of expand/contract: the release this column lands in still serves
     * the previous code's inserts, which cannot name it, and a NOT NULL column
     * with no default fails every one of them (`pnpm check:migrations`). It is
     * dropped in the next release (the contract half, issue #2222).
     */
    bookedAs: participantType("booked_as").notNull().default("diver"),
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
    /** Optional staff-set pickup time for this booking (e.g., "07:15"). */
    pickupTime: text("pickup_time"),
    status: bookingStatus("status").notNull().default("booked"),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
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
    // A tick nobody is recorded as having made is not one the roster may show.
    check(
      "bookings_course_materials_done_attributed",
      sql`(${table.courseMaterialsDoneAt} is null) = (${table.courseMaterialsDoneByPersonId} is null)`,
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
    status: tripHelpRequestStatus("status").notNull().default("requested"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("trip_help_requests_booking_unique").on(table.bookingId),
    index("trip_help_requests_shop_status_idx").on(table.shopId, table.status, table.createdAt),
    index("trip_help_requests_trip_idx").on(table.tripId, table.createdAt),
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
 * The source discriminator separates a request-origin invitation from a direct
 * one without forcing those concepts to share a table's meaning (ADR
 * 20260816-trip-invitations).
 *
 * **`waitlist` was here and is gone** (issue #1616). The ADR left room for it
 * and nothing ever filled that room: no writer set the source, so no row ever
 * carried the `waitlist_entry_id` the branch required. What the dead column
 * *did* carry was a foreign key into `trip_waitlist_entries` with no
 * `onDelete`, and the erasure hard-deletes a diver's wait-list rows — so a
 * single populated row would have raised 23503 inside the erasure transaction
 * and rolled back every other redaction with it. `anonymizeDiver` catches
 * nothing and `eraseDiverAction` has no handler, so what an owner would have
 * met is a server-action error and an erasure that never happened — total and
 * opaque rather than silent. H-49 is the rule that applies: a column nothing
 * writes is dropped rather than defended, and dropping it removes the hazard
 * instead of sequencing around it.
 */
export const tripInvitationSource = pgEnum("trip_invitation_source", ["date_request", "direct"]);

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
    uniqueIndex("trip_invitations_trip_person_unique")
      .on(table.tripId, table.personId)
      .where(sql`${table.personId} is not null`),
    check(
      "trip_invitations_source_reference_check",
      sql`(
        (${table.source} = 'date_request' and ${table.courseInquiryId} is not null and ${table.personId} is null)
        or (${table.source} = 'direct' and ${table.courseInquiryId} is null and ${table.personId} is not null)
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /**
     * The token sealed under `SECRET_ENCRYPTION_KEY`, for a live `course_forms`
     * row only; null for every other purpose, and nulled when the row is
     * revoked. `token_hash` is still what every lookup matches.
     */
    tokenSealed: text("token_sealed"),
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

export type Booking = typeof bookings.$inferSelect;

export type LastMinuteListEntry = typeof lastMinuteListEntries.$inferSelect;

export type TripLastMinutePromo = typeof tripLastMinutePromos.$inferSelect;

export type TripLastMinutePromoRecipient = typeof tripLastMinutePromoRecipients.$inferSelect;

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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The month's count on Reports.
    index("booking_referrals_shop_idx").on(table.shopId),
  ],
);

export type BookingReferral = typeof bookingReferrals.$inferSelect;
