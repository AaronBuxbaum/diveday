import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
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
import type { BoatPaperRecord, BoatRadioRecord, BoatSafetyNotice } from "@/lib/boat-safety";
import type { CrewCredentialSnapshot } from "@/lib/crew-credential-snapshot";
import type { IncidentCertificationEvidence } from "@/lib/incident-export";
import { SNAG_NOTE_MAX } from "@/lib/pre-departure-check";
import type { ReadinessBlocker } from "@/lib/readiness";
import { ROLL_CALL_EVENT_STATUSES, ROLL_CALL_SUBJECT_KINDS } from "@/lib/roll-call";
import { DRILL_KINDS } from "@/lib/safety-drills";
import { bookings } from "./bookings";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { boats, trips } from "./trips";

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
export const rollCallStatus = pgEnum("roll_call_status", ROLL_CALL_EVENT_STATUSES);

export const rollCallSource = pgEnum("roll_call_source", ["live", "offline"]);

/** Seat or crew: see `ROLL_CALL_SUBJECT_KINDS` (src/lib/roll-call.ts). */
export const rollCallSubjectKind = pgEnum("roll_call_subject_kind", ROLL_CALL_SUBJECT_KINDS);

/**
 * Append-only safety history: one row per tap, about one subject at one
 * checkpoint. Absence means the subject is still awaiting roll call; the
 * newest row per (trip, checkpoint, subject) answers their current state
 * without rewriting what staff recorded earlier.
 *
 * **Every read names its subject kind** (`seatMarks()` or `crewMarks()` in
 * `src/db/roll-call-subject.ts`): a diver count that picked up a crew row, or
 * the reverse, would put somebody aboard who is not. The roll-call subject
 * guard (`scripts/check-roll-call-subject.mjs`) refuses a read that does not.
 *
 * `roll_call_events_subject` is the shape: a seat row names a booking and no
 * crew member, a crew row names a crew member and no booking, so neither
 * subject column is ever optional for the row that needs it. This replaces
 * the separate `roll_call_crew_events` table, which existed only to keep
 * `booking_id` NOT NULL; the check keeps that invariant per kind.
 *
 * `recorded_by_person_id` is who said so. For a crew row it is routinely the
 * subject too (a divemaster boarding herself), and that is fine: the count
 * names somebody, not a second witness.
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
    /**
     * Seat or crew. The database default is `seat` only so a release still
     * serving while this migration runs keeps writing diver rows; every crew
     * writer names `crew`, and a crew row left at the default fails
     * `roll_call_events_subject` for want of a booking.
     */
    subjectKind: rollCallSubjectKind("subject_kind").notNull().default("seat"),
    /** The seat this is about. Set exactly when `subject_kind = 'seat'`. */
    bookingId: uuid("booking_id").references(() => bookings.id),
    /**
     * The crew member this is about, a `trip_assignments` row's person. Set
     * exactly when `subject_kind = 'crew'`. Writers prove the person is
     * assigned to the trip, joining through `trips`.
     */
    crewPersonId: uuid("crew_person_id").references(() => people.id),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    status: rollCallStatus("status").notNull(),
    /** `departure` or `after_dive_N`; validated against the trip's planned dive count. */
    checkpoint: text("checkpoint").notNull().default("departure"),
    source: rollCallSource("source").notNull().default("live"),
    /**
     * Device-generated idempotency key. Live events leave this null. Seat and
     * crew keys share one namespace, so a replayed sync is idempotent across
     * both halves; the sync reader still checks the stored row's subject
     * before treating a key as already applied.
     */
    clientEventId: uuid("client_event_id"),
    /**
     * **The event a `cleared` takes back** (issue #3995, ADR
     * 20260815-an-offline-retraction-names-its-target). Written only after the
     * writer proved it was the mark the manifest showed at this subject and
     * checkpoint, so it is what lets an undo of an earlier meeting day's
     * carried "did not come back" reach that day (`standingByDay`). Null on
     * every other status and on a bare dock undo.
     */
    retractsEventId: uuid("retracts_event_id").references((): AnyPgColumn => rollCallEvents.id),
    /**
     * Which encrypted snapshot supplied the offline readiness evidence. Seat
     * rows only: crew have no readiness to evidence (nothing gates a crew
     * member at departure), so a crew row leaves it null even though the
     * snapshot time is still the input its staleness bound is computed from.
     */
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
    /**
     * **What readiness said when this diver was counted aboard**
     * (ADR 20261015-roll-call-records-readiness, issue #2414): `ready` or
     * `blocked`, written with a seat's `boarded` event and null on every other
     * one. Readiness is recomputed live, so without this a card verified at
     * 09:00 after a 05:30 boat would make "was blocked" unsayable afterwards,
     * and a finished departure's record would file a diver counted aboard
     * while blocked under "Sailed" with no trace. A record of what was true,
     * never a gate: nothing reads it to refuse or allow anything.
     */
    readinessStatus: text("readiness_status"),
    /** The card evidence captured in a seat's live boarding INSERT; null means unavailable. */
    certificationSnapshot:
      jsonb("certification_snapshot").$type<
        (IncidentCertificationEvidence & { reviewedByPersonId: string | null })[]
      >(),
    /** The app clock before issuing the statement that reads the cards. */
    certificationSnapshotStartedAt: timestamp("certification_snapshot_started_at", {
      withTimezone: true,
    }),
    /** When the statement finished; it can be later than the snapshot it read. */
    certificationSnapshotCapturedAt: timestamp("certification_snapshot_captured_at", {
      withTimezone: true,
    }),
    /** The blockers behind a `blocked` snapshot, as the engine raised them; null otherwise. */
    readinessBlockers: jsonb("readiness_blockers").$type<ReadinessBlocker[]>(),
    /**
     * A crew member's live boarding mark: the credential state observed, never
     * an assertion about sailing time. Crew rows only.
     */
    credentialSnapshot: jsonb("credential_snapshot").$type<CrewCredentialSnapshot[]>(),
    credentialSnapshotStartedAt: timestamp("credential_snapshot_started_at", {
      withTimezone: true,
    }),
    credentialSnapshotCapturedAt: timestamp("credential_snapshot_captured_at", {
      withTimezone: true,
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
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
     * mode as the bug that prompted this, one layer down. Seat and crew share
     * it, so the two halves of a head count, read minutes apart on one
     * screen, can never order differently.
     *
     * `id` cannot stand in for it: `defaultRandom()` is as arbitrary as the
     * heap, merely arbitrary consistently. `activity_events.seq` is the same
     * column for the same reason.
     *
     * **Never serialise it.** The sequence is database-global, not per shop, so
     * a value reaching a response body, an export file or a client component
     * would publish a monotonic counter every tenant shares — one shop able to
     * read another's roll-call volume from two samples (security review,
     * 2026-08-15). Readers that select the whole row
     * (`select({ event: rollCallEvents, … })`) reduce it to named fields, and
     * a `...event` spread would quietly undo that.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    // Lead on the person columns so deleting a person (a demo shop's cascade,
    // `discardUnusedBuyer`) probes each foreign key by index, not by scanning
    // every shop's rows; a (shop_id, …) composite cannot serve that probe.
    // `people-fk-indexes.test.ts` holds the list (fourth review, row 31).
    index("roll_call_events_recorded_by_person_id_idx").on(table.recordedByPersonId),
    index("roll_call_events_crew_person_id_idx").on(table.crewPersonId),
    // The self-reference's probe: a demo shop's ledger delete checks it per row.
    index("roll_call_events_retracts_event_id_idx").on(table.retractsEventId),
    index("roll_call_events_shop_trip_checkpoint_booking_occurred_idx")
      .on(table.shopId, table.tripId, table.checkpoint, table.bookingId, table.occurredAt)
      .where(sql`${table.subjectKind} = 'seat'`),
    index("roll_call_events_shop_trip_checkpoint_crew_occurred_idx")
      .on(table.shopId, table.tripId, table.checkpoint, table.crewPersonId, table.occurredAt)
      .where(sql`${table.subjectKind} = 'crew'`),
    uniqueIndex("roll_call_events_shop_client_event_unique").on(table.shopId, table.clientEventId),
    check(
      "roll_call_events_subject",
      sql`(${table.subjectKind} = 'seat' and ${table.bookingId} is not null and ${table.crewPersonId} is null) or (${table.subjectKind} = 'crew' and ${table.crewPersonId} is not null and ${table.bookingId} is null)`,
    ),
    check(
      "roll_call_events_retracts_only_cleared",
      sql`${table.retractsEventId} is null or ${table.status} = 'cleared'`,
    ),
    check(
      "roll_call_events_offline_snapshot_seat_only",
      sql`${table.offlineSnapshotSavedAt} is null or ${table.subjectKind} = 'seat'`,
    ),
    check(
      "roll_call_events_certification_snapshot_shape",
      sql`(${table.certificationSnapshot} is null and ${table.certificationSnapshotStartedAt} is null and ${table.certificationSnapshotCapturedAt} is null) or (${table.certificationSnapshot} is not null and ${table.certificationSnapshotStartedAt} is not null and ${table.certificationSnapshotCapturedAt} is not null and ${table.certificationSnapshotStartedAt} <= ${table.certificationSnapshotCapturedAt} and ${table.subjectKind} = 'seat' and ${table.status} = 'boarded' and ${table.checkpoint} = 'departure' and ${table.source} = 'live' and jsonb_typeof(${table.certificationSnapshot}) = 'array')`,
    ),
    check(
      "roll_call_events_readiness_snapshot_shape",
      sql`(${table.readinessStatus} is null and ${table.readinessBlockers} is null) or (${table.subjectKind} = 'seat' and ${table.status} = 'boarded' and ${table.readinessStatus} in ('ready', 'blocked'))`,
    ),
    check(
      "roll_call_events_credential_snapshot_shape",
      sql`(${table.credentialSnapshot} is null and ${table.credentialSnapshotStartedAt} is null and ${table.credentialSnapshotCapturedAt} is null) or (${table.credentialSnapshot} is not null and ${table.credentialSnapshotStartedAt} is not null and ${table.credentialSnapshotCapturedAt} is not null and ${table.credentialSnapshotStartedAt} <= ${table.credentialSnapshotCapturedAt} and ${table.subjectKind} = 'crew' and ${table.status} = 'boarded' and ${table.checkpoint} = 'departure' and ${table.source} = 'live' and jsonb_typeof(${table.credentialSnapshot}) = 'array')`,
    ),
  ],
);

/** The four drills (`DRILL_KINDS`, src/lib/safety-drills.ts). */
export const safetyDrillKind = pgEnum("safety_drill_kind", DRILL_KINDS);

/**
 * **The drill log** (loop 5, row 2; roadmap E3; `src/lib/safety-drills.ts`):
 * one dated safety drill the shop held (emergency oxygen, missing diver,
 * person overboard, fire) with a note. Read by the Safety tab ("Last oxygen
 * drill: 94 days ago") and printed with it for an insurer. A record, never a
 * gate. A wrong entry is deleted softly (`deleted_at`); every live read says
 * `deleted_at is null`.
 */
export const safetyDrills = pgTable(
  "safety_drills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: safetyDrillKind("kind").notNull(),
    /** The shop's calendar date the drill was held on. */
    heldOn: date("held_on", { mode: "string" }).notNull(),
    note: text("note"),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    recordedAt: appNowTimestamp("recorded_at").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Who deleted the drill: an insurer's record says who took a line out. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
  },
  (table) => [
    check(
      "safety_drills_deleted_by_whom",
      sql`(${table.deletedAt} is null) = (${table.deletedByPersonId} is null)`,
    ),
    index("safety_drills_deleted_by_person_id_idx").on(table.deletedByPersonId),
    index("safety_drills_shop_held_live_idx")
      .on(table.shopId, table.heldOn)
      .where(sql`${table.deletedAt} is null`),
    index("safety_drills_recorded_by_person_id_idx").on(table.recordedByPersonId),
  ],
);

/**
 * Who took part in one drill: staff of the shop, one row each. Goes with its
 * drill (cascade); a deleted drill keeps its rows and is read by nobody.
 */
export const safetyDrillParticipants = pgTable(
  "safety_drill_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    drillId: uuid("drill_id")
      .notNull()
      .references(() => safetyDrills.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id),
  },
  (table) => [
    uniqueIndex("safety_drill_participants_drill_person_unique").on(table.drillId, table.personId),
    index("safety_drill_participants_person_id_idx").on(table.personId),
  ],
);

/**
 * One line a shop wants confirmed before a boat leaves the dock — "Emergency
 * oxygen aboard", "Life jackets counted" — in the order the shop wants it read
 * (ADR 20260824-pre-departure-safety-check).
 *
 * **DiveDay authors none of this** but the oxygen line a new shop starts with
 * (`createSignedUpShop`, issue #2301), which is the shop's to edit from then.
 * The required set differs by flag state, vessel class and jurisdiction, so the
 * label is free text, not a code this table looks up. `sortOrder` is the shop's own
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
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
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
 * recorded as an open call, H-20261025-shop-authored-pre-departure, not decided by this table's shape).
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
    createdAt: appNowTimestamp("created_at").notNull(),
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
 * **A snag**: a problem the crew wrote against one checklist line on one boat
 * ("VHF crackles on 16"), carried to that boat's next departures until somebody
 * says it is fixed (fifth-loop ideas, item 1; glossary "Snag").
 *
 * Its own table, not a note on `pre_departure_check_events`: those rows are
 * append-only and hashed into the departure log, and a snag has a life the
 * tap does not (open, still there, fixed). The tap's own `note` column stays
 * what it was, the offline queue's.
 *
 * Informs, never gates, like the checklist it hangs from (ADR
 * 20260824-pre-departure-safety-check): an open snag blocks no departure.
 *
 * `still_there_*` is the newest crew to look and find it still there, so the
 * next departure says who last saw it. `fixed_*` closes it; a fixed snag is
 * never reopened, a recurring problem is a new note.
 */
export const boatSnags = pgTable(
  "boat_snags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    boatId: uuid("boat_id")
      .notNull()
      .references(() => boats.id),
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => preDepartureChecklistItems.id),
    /** The departure whose crew wrote it. */
    notedOnTripId: uuid("noted_on_trip_id")
      .notNull()
      .references(() => trips.id),
    note: text("note").notNull(),
    notedByPersonId: uuid("noted_by_person_id")
      .notNull()
      .references(() => people.id),
    notedAt: timestamp("noted_at", { withTimezone: true }).notNull(),
    stillThereOnTripId: uuid("still_there_on_trip_id").references(() => trips.id),
    stillThereByPersonId: uuid("still_there_by_person_id").references(() => people.id),
    stillThereAt: timestamp("still_there_at", { withTimezone: true }),
    fixedOnTripId: uuid("fixed_on_trip_id").references(() => trips.id),
    fixedByPersonId: uuid("fixed_by_person_id").references(() => people.id),
    fixedAt: timestamp("fixed_at", { withTimezone: true }),
    createdAt: appNowTimestamp("created_at").notNull(),
    updatedAt: appNowTimestamp("updated_at").notNull(),
  },
  (table) => [
    index("boat_snags_shop_boat_open_idx")
      .on(table.shopId, table.boatId, table.notedAt)
      .where(sql`${table.fixedAt} is null`),
    index("boat_snags_noted_on_trip_idx").on(table.shopId, table.notedOnTripId),
    // Led by the person column, so removing a person probes each by index
    // (`people-fk-indexes.test.ts`).
    index("boat_snags_noted_by_person_id_idx").on(table.notedByPersonId),
    index("boat_snags_still_there_by_person_id_idx").on(table.stillThereByPersonId),
    index("boat_snags_fixed_by_person_id_idx").on(table.fixedByPersonId),
    check(
      "boat_snags_note_length",
      sql`char_length(${table.note}) between 1 and ${sql.raw(String(SNAG_NOTE_MAX))}`,
    ),
    check(
      "boat_snags_fixed_whole",
      sql`(${table.fixedAt} is null) = (${table.fixedByPersonId} is null)`,
    ),
    check(
      "boat_snags_still_there_whole",
      sql`(${table.stillThereAt} is null) = (${table.stillThereByPersonId} is null)`,
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
 * **This table is the only record of an arrival** (issue #2702, ADR
 * 20261104-arrival-is-a-trail): `bookings.status` says what the shop decided
 * about the seat and has no arrival word to mirror it with. A reader asks
 * `seatCheckedIn` (`src/db/arrival-provenance.ts`); the only writers are
 * `checkInBooking` / `undoCheckInBooking` (`src/db/check-in.ts`). A projection
 * could not answer the three questions an offline queue asks — has this exact
 * tap already been applied, is the device's copy older than what stands now,
 * and is the arrival this undo names still the one standing — which is why the
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
    createdAt: appNowTimestamp("created_at").notNull(),
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
 * The writers live in src/db/buddy-teams.ts, one per act, each writing every
 * row it needs in one transaction. Dissolving deletes the membership rows —
 * `buddy_team_events` below is the append-only record that outlives them.
 * Teams inform the roll call's attention state and never gate readiness,
 * admission, capacity, or checkpoint completeness.
 */
export const buddyTeamMembers = pgTable(
  "buddy_team_members",
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
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // A diver is in at most one team per departure — the invariant that keeps
    // the manifest unambiguous. Holds under concurrency, where a check in
    // application code cannot.
    uniqueIndex("buddy_team_members_booking_unique").on(table.bookingId),
    index("buddy_team_members_shop_trip_idx").on(table.shopId, table.tripId),
    index("buddy_team_members_pair_idx").on(table.pairId),
    check(
      "buddy_team_members_one_subject",
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
 * safety evidence about a departure, in the same class as `roll_call_events`,
 * which is not pruned either — a window here
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
    /**
     * The recorder said everyone on the team is 18 or over, where no date of
     * birth or "Under 18" box on file said so ("Team up each party", issue
     * 2808). The attestation and who gave it, kept with the act.
     */
    adultsConfirmed: boolean("adults_confirmed").notNull().default(false),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: appNowTimestamp("created_at").notNull(),
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
 * Why the shop called a departure off, which is what the diver's message says
 * happened. `weather` is the blow-out proper (glossary **Blow-out**);
 * `run_ended` is a repeating trip's "Cancel every upcoming date", which sends
 * each of those dates through the same cascade (refunds, one message each, the
 * record) but must not tell anybody it was the weather (ADR
 * 20260810-open-ended-recurring-trips, addendum 2026-10-12).
 */
export const blowoutCause = pgEnum("trip_blowout_cause", ["weather", "run_ended"]);

export type BlowoutCause = (typeof blowoutCause.enumValues)[number];

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
    /** What the diver is told the cancellation was; see `blowoutCause`. */
    cause: blowoutCause("cause").notNull().default("weather"),
    createdAt: appNowTimestamp("created_at").notNull(),
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
    createdAt: appNowTimestamp("created_at").notNull(),
  },
  (table) => [
    // A booking belongs to exactly one trip and a trip to one blow-out, so the
    // booking alone is the natural key — the send loop's resume guarantee.
    uniqueIndex("trip_blowout_divers_booking_unique").on(table.bookingId),
    index("trip_blowout_divers_blowout_idx").on(table.blowoutId),
  ],
);

export type BlowoutMessageStatus = (typeof blowoutMessageStatus.enumValues)[number];

/**
 * **The boat's papers and kit notices as they stood at the departure
 * checkpoint** (#2300, Aaron 2026-10-13). The live boat-safety section reads
 * the boat as it is *now*, so once a departure has sailed it is hidden: paper
 * dates are typed over when renewed and kit moves between hulls. This is the
 * record the departure log and its incident export read instead.
 *
 * One row per departure, rewritten by each departure-checkpoint roll-call
 * write until the boat sails (`hasSailed`) and never after, so it holds what
 * the crew had in front of them as the boat left. No row means nobody recorded
 * roll call at the departure checkpoint before it sailed, which the log says.
 *
 * `papers` keeps the certificate's limits and every paper date verbatim;
 * `notices` keeps the codes the pre-departure check raised about papers and
 * kit (never the head-count lines, which the roll call itself records), worded
 * at render time like every other code on that document.
 */
export const departureBoatSafetySnapshots = pgTable(
  "departure_boat_safety_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id),
    boatId: uuid("boat_id")
      .notNull()
      .references(() => boats.id),
    /** The hull's name then: a boat renamed later still reads as it sailed. */
    boatName: text("boat_name").notNull(),
    /** The departure's own local day the notices were judged on. */
    judgedOn: date("judged_on").notNull(),
    /**
     * The scheduled departure instant this record belongs to. Rebound only
     * by an unsailed reschedule; kept sailed evidence never follows a later
     * schedule edit. Null means the safety provenance is unknown, so the
     * existing record cannot safely be rewritten.
     */
    departureStartsAt: timestamp("departure_starts_at", { withTimezone: true }),
    papers: jsonb("papers").$type<BoatPaperRecord>().notNull(),
    /**
     * The radio identity the emergency card printed for this departure (call
     * sign, MMSI, working channel; records review S1 of #2672), written at the
     * same checkpoint as `papers`. A snapshot kept before it existed reads
     * every fact as not recorded.
     */
    radio: jsonb("radio")
      .$type<BoatRadioRecord>()
      .notNull()
      .default({ callSign: null, mmsi: null, workingChannel: null }),
    notices: jsonb("notices").$type<BoatSafetyNotice[]>().notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("departure_boat_safety_snapshots_trip_idx").on(table.tripId),
    index("departure_boat_safety_snapshots_shop_idx").on(table.shopId),
  ],
);
