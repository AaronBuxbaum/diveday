import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DraftFields } from "@/lib/form-drafts";
import type { HeldSendPayload } from "@/lib/held-sends";
import { bookings } from "./bookings";
import { people, shops } from "./core";
import { diveSites } from "./dive-sites";
import { trips } from "./trips";

/**
 * What happened on a trip and to a diver: notes, the activity feed, trip change
 * and stage events, form drafts, held sends, the trip desk and read marks.
 */

/** The public fact that changed in a departure's plan ledger. */
export const tripChangeEventKind = pgEnum("trip_change_event_kind", [
  "meeting_point",
  "conditions",
]);

/** The broad source of a published change, not a staff member's private name. */
export const tripChangeEventSource = pgEnum("trip_change_event_source", ["shop", "crew"]);

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

/** Append-only, staff-facing account of operational work, as codes and names. */
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
    /**
     * The person this line is **about**, where that is neither the actor nor
     * reachable through `booking_id` — today, a note written on a diver's
     * record rather than on one of their seats (`addDiverNote`).
     *
     * Every other line in this table is about a departure or a seat, and stays
     * that way: this column is null for all of them. It exists because the
     * diver record's Activity panel claims a line when the booking is one of
     * theirs or they are the actor, and a record-scoped note is neither — the
     * subject lived only inside the free-text `message`, so the line landed on
     * the trail of the staffer who wrote it and never on the record it was
     * written on (issue #615).
     *
     * It is read by `pagedDiverActivity` and redacted under by
     * `anonymizeDiver`'s activity sweep — **both, or neither**. That pairing is
     * what keeps "the set a shop can read about a person" and "the set an
     * erasure destroys" the same set by construction rather than by two
     * functions happening to agree.
     */
    subjectPersonId: uuid("subject_person_id").references(() => people.id),
    /**
     * **What happened**, as a code from `src/lib/activity.ts` — never a
     * sentence.
     *
     * This column used to be `message`, holding English built in `src/db` and
     * printed verbatim, so a shop's whole trail read English whatever language
     * its staff had chosen; the guard that forbids prose in the data layer
     * could not see it, because every one of those sentences interpolated a
     * name (issue #1655). The words now live in the `activity` staff namespace
     * and are picked in `src/i18n/activity-labels.ts`.
     *
     * `text` rather than an enum deliberately: the set is closed by a
     * TypeScript union and a test that holds it against both bundles, and a new
     * line of history should not cost a migration. `isActivityCode` is what a
     * reader checks it with.
     */
    code: text("code").notNull(),
    /**
     * The **names** the code's sentence needs, as recorded at the time.
     *
     * Names rather than ids, because the trail is history: a line saying who
     * did what in March keeps saying it after somebody is renamed. That is also
     * why erasure reaches in here — `anonymizeDiver` rewrites the whole row to
     * `ACTIVITY_REDACTED` rather than editing the payload, and its fuzzy name
     * sweep matches against this column's text.
     */
    params: jsonb("params").$type<Record<string, string>>().notNull().default({}),
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
    index("activity_events_shop_subject_idx").on(
      table.shopId,
      table.subjectPersonId,
      table.occurredAt,
    ),
    check("activity_events_code_not_blank", sql`length(trim(${table.code})) > 0`),
  ],
);

/**
 * Publicly safe, append-only facts about material changes to one departure.
 * Snapshots contain only meeting-point or conditions values; no contact data,
 * readiness state, waiver, or capability token belongs in this table.
 */
export const tripChangeEvents = pgTable(
  "trip_change_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: tripChangeEventKind("kind").notNull(),
    source: tripChangeEventSource("source").notNull(),
    beforeValue: jsonb("before_value")
      .$type<Record<string, string | number | boolean | null> | null>()
      .default(null),
    afterValue: jsonb("after_value")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull(),
    actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("trip_change_events_shop_trip_idx").on(
      table.shopId,
      table.tripId,
      table.occurredAt,
      table.seq,
    ),
  ],
);

/**
 * **Where a departure is, in the crew's own word** — ADR
 * 20260904-reef-all-the-way-down, decision 2, Budget rule 4.
 *
 * Five words the crew taps on the manifest, repeated on every surface that
 * draws the boat. Never inferred from a clock and **never a position**: a
 * position is a promise DiveDay cannot keep and a liability a shop does not
 * want, and the ADR rejects tracking in as many words. A stage nobody set is
 * absent, never "Unknown".
 */
export const tripStage = pgEnum("trip_stage", [
  "boarding",
  "underway",
  "surface",
  "heading_in",
  "home",
]);

/**
 * The stage ledger — append-only, like `trip_change_events` beside it.
 *
 * A stage is added, never edited and never deleted: a crew that taps the wrong
 * word taps the right one, and the newest row wins. So there is no
 * `deleted_at` here (nothing a user points at and asks to remove) and no
 * update path at all. `dive_site_id` is snapshotted at write time from the
 * departure's own plan rather than resolved at render, so a later edit to the
 * plan cannot rewrite a sentence a diver has already read; null is a real
 * answer — a shore day, or a site nobody named — and the reader falls back to
 * the siteless word.
 */
export const tripStageEvents = pgTable(
  "trip_stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    stage: tripStage("stage").notNull(),
    diveSiteId: uuid("dive_site_id").references(() => diveSites.id, { onDelete: "set null" }),
    recordedByPersonId: uuid("recorded_by_person_id")
      .notNull()
      .references(() => people.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** The final tiebreak when two taps share an instant, as on the roll call. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("trip_stage_events_shop_trip_idx").on(
      table.shopId,
      table.tripId,
      table.recordedAt,
      table.seq,
    ),
  ],
);

/**
 * A staff form's draft (ADR 20260906-before-you-ask, decision 3): what one
 * person typed into one form, kept a day and applied when they next open it,
 * on any device. One row per person and form; `saved_at` is bumped on every
 * write and read by the retention prune. `fields` holds the draftable subset
 * only (`src/lib/form-drafts.ts`): never a payment detail or a medical answer.
 */
export const formDrafts = pgTable(
  "form_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    form: text("form").notNull(),
    fields: jsonb("fields").$type<DraftFields>().notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("form_drafts_person_form_unique").on(table.shopId, table.personId, table.form),
    index("form_drafts_saved_at_idx").on(table.savedAt),
  ],
);

export const heldSendKind = pgEnum("held_send_kind", [
  "waiver_send",
  "last_minute_deal",
  "waitlist_invite",
]);

/**
 * A send that has been tapped and not yet left (ADR 20260906-before-you-ask,
 * decision 2). The four sends that used to ask "are you sure?" take an
 * eight-second hold instead: the row is written on the tap with `run_at` eight
 * seconds out, Undo deletes it, and whichever claimant reaches it first once
 * it is due — the client that counted down, or the hourly sweep for a closed
 * tab — deletes it as the send begins. Nothing lingers, so nothing prunes it.
 *
 * `payload` carries **ids only** (`src/lib/held-sends.ts`): never a name or
 * an address, so an erasure needs no sweep here and a backup holds no mail.
 */
export const heldSends = pgTable(
  "held_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    kind: heldSendKind("kind").notNull(),
    payload: jsonb("payload").$type<HeldSendPayload>().notNull(),
    /** Who tapped Send; the deal's creator, the trail's actor. Null once they are gone. */
    actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("held_sends_run_at_idx").on(table.runAt)],
);

/**
 * **A desk act a crew member coming back to this departure needs to know
 * about** (issues #1202 and #1187, delight report D42 with D27 folded in).
 *
 * Deliberately **not** `trip_change_events`, which is the publicly safe plan
 * ledger a diver's own link reads. That table's docblock states what may live
 * in it — meeting point and conditions, no contact data, no readiness state —
 * and the whole value of this one is the internal half: who arrived, whose
 * seat moved, who asked the crew for a hand. Two tables so that one query can
 * never accidentally serve a diver a staff fact (#1202's triage names exactly
 * that disclosure risk and recommends the split).
 *
 * **Codes only. This table holds no prose**, and it holds no name: the diver a
 * line is about is `subject_person_id`, joined live at read, so an erasure
 * through `anonymizeDiver` redacts the strip without a second sweep.
 *
 * Append-only and **not soft-deletable** — nobody points at a desk event and
 * asks for it gone, so it is the soft-delete rule's "machinery nobody pointed
 * at" rather than an omission. It is bounded instead by a 30-day retention
 * window: a same-day handoff nobody can replay a season later is the
 * difference between a catch-up and the surveillance feed #1202's boundary
 * refuses.
 */
export const tripDeskEventKind = pgEnum("trip_desk_event_kind", [
  "arrival",
  "seat_taken",
  "seat_released",
  "gear_changed",
  "pickup_set",
  "help_request",
  "meeting_point",
  "plan_changed",
  // A seat changed what it is doing aboard, one kind per new type so the
  // strip can say it: "Ana Ruiz is snorkeling now" (ADR
  // 20261007-participant-types).
  "now_diving",
  "now_snorkeling",
  "now_riding",
  // A type change raised a paid seat's price: the difference is owed, and
  // nothing collects it on its own.
  "balance_owed",
]);

export const tripDeskEvents = pgTable(
  "trip_desk_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    kind: tripDeskEventKind("kind").notNull(),
    /** Null for the trip-wide kinds (`meeting_point`, `plan_changed`). */
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    /**
     * The diver the line is about. **Never a stored name** — see the table's
     * note: the name is joined at read so erasure needs no second sweep here.
     */
    subjectPersonId: uuid("subject_person_id").references(() => people.id, {
      onDelete: "cascade",
    }),
    /**
     * Who did it, when a person did. Null for an act a diver performed on their
     * own link (a help request), and for a scheduled or system-driven write.
     * The reader never sees their own acts, so this is also what advances the
     * actor's own read mark.
     */
    actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The tiebreak, for the same reason `activity_events.seq` carries one:
     * `occurred_at` alone cannot order this table. Two desk acts in one request
     * share an instant, and the e2e clock is frozen outright so *every* row in
     * a test carries the identical timestamp. The read mark stores this
     * sequence rather than a timestamp for exactly that reason — "since I last
     * looked" has to be a position, not a moment two rows can share.
     */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    index("trip_desk_events_shop_trip_idx").on(table.shopId, table.tripId, table.seq),
    index("trip_desk_events_occurred_idx").on(table.occurredAt),
  ],
);

/**
 * **Where one person had read up to on one departure.** The other half of the
 * catch-up strip: the strip is the events after this mark, and nothing else.
 *
 * A person with no row here is not behind — they are new to this boat, and a
 * first visit is reading rather than catching up. That is why the strip renders
 * nothing at all to them instead of replaying the morning.
 *
 * Mutable latest state, not a trail, so it has no `seq` and no history. It is
 * pruned on `last_seen_at` for the same 30 days its events are: a mark that
 * outlives every event it points past says nothing.
 */
export const tripReadMarks = pgTable(
  "trip_read_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    lastSeenSeq: bigint("last_seen_seq", { mode: "number" }).notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_read_marks_trip_person_unique").on(table.tripId, table.personId),
    index("trip_read_marks_shop_seen_idx").on(table.shopId, table.lastSeenAt),
  ],
);
