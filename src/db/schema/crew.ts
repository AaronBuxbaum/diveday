import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { appNowTimestamp } from "./columns";
import { certificationStatus, people, shops } from "./core";
import { tripSeries, trips } from "./trips";

/**
 * Staff credentials, trip crew assignments, shifts, availability and assignment
 * requests.
 */

export const staffCredentialKind = pgEnum("staff_credential_kind", [
  "instructor_rating",
  "assistant_instructor_rating",
  "divemaster_rating",
  "liability_insurance",
  "first_aid_cpr",
  "oxygen_provider",
  "captains_licence",
  "other",
]);

/**
 * Staff-owned evidence; warning-only and never an assignment/booking gate.
 * Decided permanently, not merely unbuilt — see H-59 in
 * docs/product/human-decisions/README.md. Its 2026-10-07 amendment (issue #1853) lets
 * a lapsed `instructor_rating` / `assistant_instructor_rating` /
 * `divemaster_rating` (the last rung's kind added by issue #1850) narrow the **supervision
 * claim** — Today, the staffing week, the trip page — through `lapsedRungs`
 * (src/lib/crew-roles.ts); the booking gate and the crew editor's refusals
 * still never read this table.
 */
export const staffCredentials = pgTable(
  "staff_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    kind: staffCredentialKind("kind").notNull(),
    name: text("name").notNull(),
    issuingBody: text("issuing_body"),
    identifier: text("identifier"),
    issuedAt: date("issued_at", { mode: "string" }),
    renewsAt: date("renews_at", { mode: "string" }),
    revision: integer("revision").notNull().default(0),
    status: certificationStatus("status").notNull().default("pending"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => people.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    index("staff_credentials_shop_person_idx").on(table.shopId, table.personId),
    index("staff_credentials_renewal_idx").on(table.shopId, table.renewsAt),
    uniqueIndex("staff_credentials_live_identity_unique")
      .on(table.shopId, table.personId, table.kind, sql`lower(${table.identifier})`)
      .where(sql`${table.deletedAt} is null`),
    check(
      "staff_credentials_renewal_after_issue",
      sql`${table.issuedAt} is null or ${table.renewsAt} is null or ${table.renewsAt} >= ${table.issuedAt}`,
    ),
  ],
);

/** Recorded credential states; a baseline begins history without inventing an earlier state. */
export const staffCredentialHistory = pgTable(
  "staff_credential_history",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => staffCredentials.id, { onDelete: "cascade" }),
    event: text("event", {
      enum: ["created", "baseline", "renewed", "corrected", "deleted"],
    }).notNull(),
    kind: staffCredentialKind("kind").notNull(),
    issuedAt: date("issued_at", { mode: "string" }),
    renewsAt: date("renews_at", { mode: "string" }),
    active: boolean("active").notNull(),
    recordedAt: appNowTimestamp("recorded_at").notNull(),
  },
  (table) => [
    index("staff_credential_history_shop_credential_idx").on(
      table.shopId,
      table.credentialId,
      table.seq,
    ),
  ],
);

/** Staff crewing a trip (captain, DM, instructor…). Roles live on person_roles. */
/**
 * What a person is rostered to do on **one trip**. A deliberate subset of
 * `person_role` — `owner`, `manager`, and `diver` are standing facts about a
 * person, never a job on a boat. Keep aligned with `TRIP_CREW_ROLES` in
 * src/lib/crew-roles.ts.
 *
 * `assistant_instructor` is deliberately **not** here either, and for a
 * different reason than those three: it is a *rating* rather than a job, and
 * the job an AI does on a sailing is the one this list already calls
 * `divemaster`. A rating in a list of jobs would also have nothing to narrow,
 * which is the property the whole column exists to hold (issue #1680).
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
    /**
     * Who put this person on the boat in this role: set by each crew writer
     * from its actor, and again whenever the role changes; null for a seed or
     * a system pass, and for every row written before the column existed. A
     * gate that trusts the roster to say who teaches a session (clearing a
     * training mark with forms owed, issue #2275) reads it, so nobody can
     * roster themselves into that trust.
     */
    assignedByPersonId: uuid("assigned_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.personId] }),
    // The crew-clash reads ask "which departures is this person on?", by
    // person first; the primary key leads with the trip (code review
    // 2026-10-11, item 27).
    index("trip_assignments_person_idx").on(table.personId),
    index("trip_assignments_assigned_by_idx").on(table.assignedByPersonId),
  ],
);

/**
 * **A repeating trip's standing crew** — who sails with the run, and the job
 * each does, as a fact of the run itself (ADR 20260810-open-ended-recurring-trips,
 * addendum 2026-10-12). The rows are the switch: a run with none has no standing
 * crew. Written whole by `setSeriesStandingCrew` from the date staff applied, and
 * read by the horizon roll for every date it adds, which seats each person only
 * if they are still on the staff and free in that date's hours
 * (`seatStandingCrew`). Reading the run's crew here, rather than off the
 * furthest-out date, is what keeps a date the roll had to leave short from
 * becoming every later date's crew. Like `trip_assignments`, a roster: replaced
 * as a set, never edited row by row.
 */
export const tripSeriesCrew = pgTable(
  "trip_series_crew",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => tripSeries.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    /** The job on every date, or null for not specified, as on `trip_assignments`. */
    tripRole: tripAssignmentRole("trip_role"),
  },
  (table) => [
    primaryKey({ columns: [table.seriesId, table.personId] }),
    index("trip_series_crew_shop_idx").on(table.shopId),
    index("trip_series_crew_person_idx").on(table.personId),
  ],
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
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    index("staff_shifts_shop_starts_idx").on(table.shopId, table.startsAt),
    index("staff_shifts_person_starts_idx").on(table.personId, table.startsAt),
    check("staff_shifts_ends_after_starts", sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

/**
 * **A range of days a crew member has said they are away.**
 *
 * The staffing week shipped as the owner's shift roster (ADR
 * 20260806-staffing-is-the-shift-roster): it shows who is working and which
 * departure has nobody, and every write on it is the owner's. Nobody on the
 * crew could say "I am away that week" or "I want that one" — which is
 * DiveCrewPro's entire product, at $49/month, and the recurring complaint in
 * the 2026-09-01 owner-sentiment sweep (issue #1235). This is the first half:
 * the crew member's own statement about their availability.
 *
 * **Calendar dates, not instants.** "I am away the week of the 14th" has no
 * clock in it — it is the shop's own days, inclusive at both ends, and storing
 * a timestamp would make the range shift under a reader in another zone.
 * `src/lib/calendar-date.ts` is how it meets the week's columns.
 *
 * **It informs; it never gates.** A blackout refuses a *request* the crew
 * member themselves makes, and adds a warning word to an assignment that
 * overlaps it — it does not remove anyone from a boat. The owner assigns crew,
 * and a shorthanded Saturday with somebody's holiday on it is a conversation,
 * not a validation error the roster silently loses a name to.
 */
export const crewAvailabilityBlocks = pgTable(
  "crew_availability_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    /** The crew member who is away. They own this row; see `src/db/crew-requests.ts`. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    /** Inclusive: a single day is `starts_on = ends_on`. */
    endsOn: date("ends_on", { mode: "string" }).notNull(),
    note: text("note"),
    /** Who wrote it — the crew member themselves, or an owner recording it for them. */
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    createdAt: appNowTimestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("crew_availability_blocks_shop_person_idx")
      .on(table.shopId, table.personId, table.startsOn)
      .where(sql`deleted_at is null`),
    index("crew_availability_blocks_shop_range_idx")
      .on(table.shopId, table.startsOn, table.endsOn)
      .where(sql`deleted_at is null`),
    check("crew_availability_blocks_ends_on_or_after", sql`${table.endsOn} >= ${table.startsOn}`),
  ],
);

/**
 * **"Working it anyway"** (issue #2678, decided by Aaron 2026-10-17): a staffer
 * saying a crew member who is away on a day this departure meets is working it
 * all the same ("we asked Marcus, he is teaching Sunday anyway"). Per crew
 * assignment: it clears the diver-side "to be confirmed" mark and Today's
 * `crew_away` row for this departure only, and never touches the person's own
 * block or its note. Taking the person off the departure, moving the
 * departure's dates, or a staffer saying "no longer working it" soft-deletes
 * it (`clearCrewAwayAcknowledgements`, `withdrawCrewAwayAcknowledgement`), so
 * a later re-assignment starts unconfirmed; and a day away added after it is
 * not covered by it (`crewAwayByTrip` compares `created_at`). The person
 * cannot say it about themself (security review of #2678).
 */
export const crewAwayAcknowledgements = pgTable(
  "crew_away_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    /** The crew member who is away and working it anyway. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    /** The staffer who said so. */
    acknowledgedByPersonId: uuid("acknowledged_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    createdAt: appNowTimestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /**
     * The staffer who said "no longer working it" (records review S2). Null on
     * a live row, and on one cleared by a crew or date change, which the
     * writer of that change already records.
     */
    clearedByPersonId: uuid("cleared_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("crew_away_acknowledgements_live_uidx")
      .on(table.tripId, table.personId)
      .where(sql`deleted_at is null`),
    index("crew_away_acknowledgements_shop_trip_idx")
      .on(table.shopId, table.tripId)
      .where(sql`deleted_at is null`),
    index("crew_away_acknowledgements_person_idx").on(table.personId),
    index("crew_away_acknowledgements_acknowledged_by_idx").on(table.acknowledgedByPersonId),
    index("crew_away_acknowledgements_cleared_by_idx").on(table.clearedByPersonId),
  ],
);

/**
 * What the owner did about a request. Null on the row means it is still
 * waiting, which is the state the week draws.
 */
export const crewRequestDecision = pgEnum("crew_request_decision", ["approved", "declined"]);

/**
 * **A crew member asking to work one departure.**
 *
 * The other half of #1235. It is a *request*, never an assignment: approving
 * one runs the ordinary `changeTripCrew` mutation, so the agency training
 * ratio, the course rules and the roll-call guard all apply exactly as they do
 * when the owner assigns somebody directly. Nothing here is a second path onto
 * a boat.
 *
 * A decided row is kept rather than deleted — "I asked and was turned down" is
 * the fact the crew member came back to check, and a shop that declines the
 * same person three Saturdays running should be able to see that it did.
 * Deleting is withdrawing, and is soft like every other delete.
 */
export const crewAssignmentRequests = pgTable(
  "crew_assignment_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    /** The crew member asking. They own this row. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
    requestedAt: appNowTimestamp("requested_at").notNull(),
    decision: crewRequestDecision("decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** The owner or manager who answered. */
    decidedByPersonId: uuid("decided_by_person_id").references(() => people.id),
    createdAt: appNowTimestamp("created_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // One live ask per person per departure. A second tap is the same ask, not
    // a second one, and a partial unique index is what makes that true under a
    // race rather than under a pre-check.
    uniqueIndex("crew_assignment_requests_live_idx")
      .on(table.tripId, table.personId)
      .where(sql`deleted_at is null`),
    index("crew_assignment_requests_shop_trip_idx").on(table.shopId, table.tripId),
    index("crew_assignment_requests_shop_person_idx").on(table.shopId, table.personId),
    // A decision is a moment and an author, or it has not happened.
    check(
      "crew_assignment_requests_decided_together",
      sql`(${table.decision} is null) = (${table.decidedAt} is null)
        and (${table.decision} is null) = (${table.decidedByPersonId} is null)`,
    ),
  ],
);

/**
 * What happened to a crew member's place on one departure, from their side.
 * Keep aligned with `CREW_NOTICE_CHANGES` in src/lib/crew-notices.ts.
 */
export const crewNoticeChange = pgEnum("crew_notice_change", [
  "assigned",
  "removed",
  "request_approved",
  "request_declined",
  /** An approval whose assignment the boat then refused (ratio, course rules, a clash). */
  "request_refused",
  /** Still aboard, in a different role. */
  "role_changed",
  /** The departure itself was cancelled (a blow-out, a day call, a plain cancel). */
  "called_off",
  /** The departure's start time moved (#2283); `previous_starts_at` is when it left before. */
  "time_moved",
]);

/**
 * What became of a settled notice — so a row is never settled in silence
 * (ADR 20261009-crew-hear-about-their-boats). `skipped` is a departure that had
 * started, or stopped existing, before the news could go out.
 */
export const crewNoticeOutcome = pgEnum("crew_notice_outcome", [
  "sent",
  "failed",
  "netted",
  "skipped",
  "no_recipient",
  "demo",
]);

/**
 * **Crew news waiting to be told** (ADR 20261009-crew-hear-about-their-boats).
 *
 * One row per real change to somebody's place on a departure, written in the
 * same transaction as the change itself by the one write path that makes it
 * (`setTripCrew` / `changeTripCrewOutcome` in src/db/trips-crew.ts, and
 * `decideCrewAssignmentRequest` for an answer to an ask). Never written for the
 * staffer who made the change about their own act.
 *
 * Rows wait until the person's crew has been still for the settle window, then
 * one pass nets them per departure and sends one message
 * (`sendDueCrewNotices`, src/db/crew-notices.ts). `settled_at` is that pass's
 * stamp, whether or not anything was left to say after netting.
 */
export const crewNotices = pgTable(
  "crew_notices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    /** The crew member the news is for. */
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    change: crewNoticeChange("change").notNull(),
    /**
     * On a `time_moved` row, when the departure left before that move, so the
     * crew are told the time they knew beside the time it leaves now. Null on
     * every other change.
     */
    previousStartsAt: timestamp("previous_starts_at", { withTimezone: true }),
    /** Who made the change; null when no person did (a seed, a system pass). */
    actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
    createdAt: appNowTimestamp("created_at").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    /** Set with `settled_at`: what the pass did with this row. */
    outcome: crewNoticeOutcome("outcome"),
    /**
     * The order these were written in, which `created_at` cannot answer for an
     * assign and a remove inside one instant — and netting needs the order.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("crew_notices_pending_idx")
      .on(table.shopId, table.personId, table.seq)
      .where(sql`settled_at is null`),
    index("crew_notices_person_idx").on(table.personId),
    index("crew_notices_trip_idx").on(table.tripId),
    index("crew_notices_actor_idx").on(table.actorPersonId),
    index("crew_notices_settled_idx").on(table.settledAt),
  ],
);

export type CrewNoticeChangeValue = (typeof crewNoticeChange.enumValues)[number];
export type CrewNoticeOutcomeValue = (typeof crewNoticeOutcome.enumValues)[number];

export type TripAssignmentRole = (typeof tripAssignmentRole.enumValues)[number];

export type StaffCredential = typeof staffCredentials.$inferSelect;

export type StaffCredentialKind = (typeof staffCredentialKind.enumValues)[number];
