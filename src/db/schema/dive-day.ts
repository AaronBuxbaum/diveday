import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
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
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { trips } from "./trips";

/**
 * The day on the boat: roll call (divers and crew), the pre-departure
 * checklist, counter arrivals, buddy teams, and blow-outs.
 */

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
    /**
     * What a crew member observed about a person who is unaccounted for
     * (ADR 20260828-a-missing-diver-gets-a-sentence). **After-dive checkpoints
     * only** — `rollCallNoteAllowed` in src/lib/roll-call.ts is the rule, and
     * both writers apply it, so a note arriving on a departure event is
     * dropped rather than written. At the dock `not_boarded` means "never
     * left", which is clerical and has never needed a sentence.
     *
     * Written with the event and never edited afterwards: it rides the same
     * submit as the tap that states the alarm, so the recorded fact and the
     * observation behind it are one append-only row. `updateLatestRollCallNote`
     * is deliberately gone.
     */
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
    /**
     * What a crew member observed about a person who is unaccounted for
     * (ADR 20260828-a-missing-diver-gets-a-sentence). **After-dive checkpoints
     * only** — `rollCallNoteAllowed` in src/lib/roll-call.ts is the rule, and
     * both writers apply it, so a note arriving on a departure event is
     * dropped rather than written. At the dock `not_boarded` means "never
     * left", which is clerical and has never needed a sentence.
     *
     * Written with the event and never edited afterwards: it rides the same
     * submit as the tap that states the alarm, so the recorded fact and the
     * observation behind it are one append-only row. `updateLatestRollCallNote`
     * is deliberately gone.
     */
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
 * One line a shop wants confirmed before a boat leaves the dock — "Emergency
 * oxygen aboard", "Life jackets counted" — in the order the shop wants it read
 * (ADR 20260824-pre-departure-safety-check).
 *
 * **DiveDay authors none of this.** The required set differs by flag state,
 * vessel class and jurisdiction, so the label is free text the shop writes for
 * itself, not a code this table looks up. `sortOrder` is the shop's own
 * reading order, not a priority; it may repeat or skip after edits, and reads
 * always resolve ties on `createdAt`.
 */
export const preDepartureChecklistItems = pgTable(
  "pre_departure_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Set when staff remove an item (ADR 20260820-every-delete-is-soft). The
     * row stays so `pre_departure_check_events` naming it keeps reading. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("pre_departure_checklist_items_shop_order_idx")
      .on(table.shopId, table.sortOrder, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    // A shop retyping the same line twice is a mistake, not a second item —
    // mirrors gear_items_shop_label_unique.
    uniqueIndex("pre_departure_checklist_items_shop_label_unique")
      .on(table.shopId, table.label)
      .where(sql`${table.deletedAt} is null`),
  ],
);

/**
 * `cleared` mirrors roll call's own undo grammar: a re-tap of an already-
 * checked item retracts it rather than being silently ignored, so an accidental
 * tap leaves a correction in the trail instead of a claim nobody can take back.
 */
export const preDepartureCheckStatus = pgEnum("pre_departure_check_status", ["checked", "cleared"]);

/**
 * Append-only, one row per tap — never a boarding gate. `divemaster-ratio.ts`
 * and the gear service clocks are both "informs, never gates"; this is
 * modeled on the same stance and nothing here may block a departure page from
 * rendering or a trip from sailing (see the ADR — whether it *should* gate is
 * recorded as an open call, H-51, not decided by this table's shape).
 *
 * The newest event per `checklistItemId` is the current answer, exactly like
 * `rollCallEvents`; absence means not yet checked, and the manifest and the
 * departure log both say so explicitly rather than rendering nothing.
 */
export const preDepartureCheckEvents = pgTable(
  "pre_departure_check_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => preDepartureChecklistItems.id, { onDelete: "cascade" }),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    status: preDepartureCheckStatus("status").notNull(),
    /** Same offline contract as `rollCallEvents.source` — rides the same queue. */
    source: rollCallSource("source").notNull().default("live"),
    /** Device-generated idempotency key. Live events leave this null. */
    clientEventId: uuid("client_event_id"),
    note: text("note"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** The same final tiebreak `rollCallEvents.seq` carries, and for the same
     * reason: this document is hashed for the incident export, and `occurred_at`
     * ties constantly under a frozen e2e clock or a batched offline sync. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("pre_departure_check_events_shop_trip_item_occurred_idx").on(
      table.shopId,
      table.tripId,
      table.checklistItemId,
      table.occurredAt,
    ),
    uniqueIndex("pre_departure_check_events_shop_client_event_unique").on(
      table.shopId,
      table.clientEventId,
    ),
  ],
);

/**
 * `cleared` is the counter's undo, mirroring roll call's own grammar: a
 * settled "Checked in" row tapped again retracts the arrival rather than
 * deleting it, so a mis-tap leaves a correction in the trail instead of a
 * claim nobody can take back.
 *
 * **There is deliberately no `boarded` here.** Arrival is the desk's question
 * and boarding is the rail's, and the two vocabularies are kept apart at the
 * type and the table so a queue reconciling with no human present cannot
 * promote one into the other (ADR 20260907-the-counter-survives-offline).
 */
export const arrivalStatus = pgEnum("arrival_status", ["arrived", "cleared"]);

/**
 * **One tap at the counter** — a diver turned up, or that was taken back.
 * Append-only, one row per tap, and the newest row per booking is the current
 * answer, exactly like `rollCallEvents` and `preDepartureCheckEvents`.
 *
 * `bookings.status` stays the projection every existing reader looks at
 * (`checked_in` / `booked`); this table is the *history* underneath it, and
 * both are written in one transaction by `checkInBooking` /
 * `undoCheckInBooking` (`src/db/check-in.ts`). The projection alone could not
 * answer the three questions an offline queue asks — has this exact tap
 * already been applied, is the device's copy older than what stands now, and
 * is the arrival this undo names still the one standing — which is why the
 * counter needed a trail before it could survive a lost signal.
 *
 * **Every tap is written, including the ones made with a signal.** A live
 * check-in that left no row here would read as "nothing has been said" to a
 * device syncing an hour-old retraction, and the retraction would win. The
 * `source` column is what tells the two apart afterwards.
 *
 * Not soft-deletable and not pruned, the same posture as the two tables it
 * mirrors: an undo is a `cleared` row rather than a delete, and the trail is
 * evidentiary — it is what a departure log says about who was at the desk and
 * when. Erasure reaches it through the live join to `people`, not through a
 * window.
 */
export const bookingArrivalEvents = pgTable(
  "booking_arrival_events",
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
      .references(() => bookings.id, { onDelete: "cascade" }),
    /**
     * Who said so: the staffer at the desk.
     */
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    status: arrivalStatus("status").notNull(),
    /** Same offline contract as `rollCallEvents.source` — rides the same queue. */
    source: rollCallSource("source").notNull().default("live"),
    /** Device-generated idempotency key. Live taps leave this null. */
    clientEventId: uuid("client_event_id"),
    /**
     * When the device's copy of the board was saved, for an offline tap. The
     * staleness bound is checked against it before the event is applied, and
     * it stays on the row so a later reader can see how old the copy behind a
     * queued arrival was — the same field and the same reason as
     * `rollCallEvents.offlineSnapshotSavedAt`.
     */
    offlineSnapshotSavedAt: timestamp("offline_snapshot_saved_at", { withTimezone: true }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** The same final tiebreak `rollCallEvents.seq` carries, and for the same
     * reason: `occurred_at` ties constantly under a frozen e2e clock or a
     * batched offline sync, and this trail is replayed in order. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("booking_arrival_events_shop_trip_booking_occurred_idx").on(
      table.shopId,
      table.tripId,
      table.bookingId,
      table.occurredAt,
    ),
    uniqueIndex("booking_arrival_events_shop_client_event_unique").on(
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

export type BlowoutMessageStatus = (typeof blowoutMessageStatus.enumValues)[number];
