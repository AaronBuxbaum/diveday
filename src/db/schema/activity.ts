import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
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
import { DESK_ONLY_CODES } from "@/lib/activity";
import type { DraftFields } from "@/lib/form-drafts";
import { bookings } from "./bookings";
import { appNowTimestamp } from "./columns";
import { people, shops } from "./core";
import { diveSites } from "./dive-sites";
import { orders } from "./payments";
import { trips } from "./trips";

/**
 * What happened on a trip and to a diver: notes, the activity feed (desk
 * lines included), trip change and stage events, form drafts, held sends and
 * read marks.
 */

/** The public fact that changed in a departure's plan ledger. */
export const tripChangeEventKind = pgEnum("trip_change_event_kind", [
  "meeting_point",
  "conditions",
  // The day's dive sites, in order (issue #3060): a morning move to another
  // reef is said on the diver's page with who and when.
  "site_change",
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
    createdAt: appNowTimestamp("created_at").notNull(),
    /**
     * Soft delete (ADR 20260820-every-delete-is-soft; issue #3701): a deleted
     * note keeps its row, so its Undo names the note by id and never carries
     * its words in a URL.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** The staffer who deleted it. */
    deletedByPersonId: uuid("deleted_by_person_id").references(() => people.id),
  },
  (table) => [
    index("internal_notes_shop_person_idx").on(table.shopId, table.personId, table.createdAt),
    index("internal_notes_booking_idx").on(table.bookingId, table.createdAt),
    check("internal_notes_body_not_blank", sql`length(trim(${table.body})) > 0`),
  ],
);

/**
 * **Who may read a line** (issue #2701, the #1202 disclosure boundary): `staff`
 * is every staff-facing trail line and every desk line the crew's catch-up
 * strip reads; `diver` is a line a diver-facing surface may print. Set by the
 * recorder from the code (`activityAudience` in `src/lib/activity.ts`), and
 * `staff` by default, so a writer that forgets it fails closed.
 */
export const activityAudience = pgEnum("activity_audience", ["staff", "diver"]);

/**
 * The desk-only codes as a SQL list, for the two checks below. Built from the
 * TypeScript list so the database and the recorder hold one set; a code added
 * there regenerates the checks with it.
 */
const deskOnlyCodeList = sql.raw(DESK_ONLY_CODES.map((code) => `'${code}'`).join(", "));

/**
 * Append-only account of operational work, as codes and names: the staff
 * trail, and the desk lines the crew's catch-up strip reads (issue #2701).
 */
export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id),
    tripId: uuid("trip_id").references(() => trips.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    /**
     * Who did it. Null only for a line no account wrote: the system's own (an
     * automatic call-off) or the shore contact stopping roll-call alerts from
     * the link in one (`shore_alert_contact_stopped`, H-20261014-stale-roll-call-recipients re-review), or the
     * bookkeeper stopping month-end files (`bookkeeper_email_stopped`). Then {@link activityEvents.systemReason} says
     * why; the check below holds the two together (issue #2539).
     */
    actorPersonId: uuid("actor_person_id").references(() => people.id),
    /**
     * **Why the system acted**, as a code from `SYSTEM_REASONS` in
     * `src/lib/activity.ts` (`minimum_not_met`), set exactly when there is no
     * actor. Never a sentence: the words come from the activity labels bundle.
     */
    systemReason: text("system_reason"),
    /**
     * The person this line is **about**, where that is neither the actor nor
     * reachable through `booking_id` — today, a note written on a diver's
     * record rather than on one of their seats (`addDiverNote`).
     *
     * It is also set on the one departure line about a diver with no seat on
     * it: a staffer emailing them that date (`departure_offered`, #2480); on a
     * roster line, whose seat it was (`recordSeatChange`); and on a desk line,
     * the diver the catch-up strip names, joined live (issue #2701). It exists because the
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
     * The order a line is about, for the one kind of act that touches neither
     * a departure nor a seat: a refund of a staff order (`order_refunded`).
     * It is what lets the shop's activity log link the line to the order it
     * names (`src/db/shop-activity.ts`). An id, never an amount or a name: the
     * order row holds those, and an erasure scrubs them there.
     */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
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
    occurredAt: appNowTimestamp("occurred_at").notNull(),
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
    /**
     * **Who may read this line** (issue #2701). Every line written today is
     * `staff`; a diver-facing reader filters on `diver` and on nothing else.
     * A desk line is always `staff` (the check below), because what the desk
     * did about one diver is exactly what #1202 keeps from every other.
     */
    audience: activityAudience("audience").notNull().default("staff"),
  },
  (table) => [
    // Leads on the person column so deleting a person (a demo shop's cascade,
    // `discardUnusedBuyer`) probes this foreign key by index, not by scanning
    // every shop's rows; a (shop_id, …) composite cannot serve that probe.
    // `people-fk-indexes.test.ts` holds the list (fourth review, row 31).
    index("activity_events_subject_person_id_idx").on(table.subjectPersonId),
    index("activity_events_actor_person_id_idx").on(table.actorPersonId),
    // Every trail line has a person who did it or a reason the system did,
    // never neither and never both. A desk-only line may have neither: a
    // diver asking for a hand on their own link, or a seat given back by a
    // path that hands down no actor, is news to every staffer all the same.
    check(
      "activity_events_actor_or_system_reason",
      sql`(${table.actorPersonId} is null) = (${table.systemReason} is not null) or (${table.systemReason} is null and ${table.code} in (${deskOnlyCodeList}))`,
    ),
    // A desk line never reaches a diver (#1202).
    check(
      "activity_events_desk_is_staff",
      sql`${table.code} not in (${deskOnlyCodeList}) or ${table.audience} = 'staff'`,
    ),
    // The catch-up strip's read: one departure's lines after a mark.
    index("activity_events_shop_trip_seq_idx").on(table.shopId, table.tripId, table.seq),
    // Today's catch-up marks name lines by (shop, id).
    uniqueIndex("activity_events_shop_id_id_unique").on(table.shopId, table.id),
    index("activity_events_shop_trip_idx").on(table.shopId, table.tripId, table.occurredAt),
    index("activity_events_shop_subject_idx").on(
      table.shopId,
      table.subjectPersonId,
      table.occurredAt,
    ),
    // The shop-wide activity log (`pagedShopActivity`): one shop's lines,
    // newest first, with `seq` breaking the frozen-clock ties.
    index("activity_events_shop_occurred_idx").on(table.shopId, table.occurredAt, table.seq),
    check("activity_events_code_not_blank", sql`length(trim(${table.code})) > 0`),
  ],
);

/**
 * Publicly safe, append-only facts about material changes to one departure.
 * Snapshots contain only meeting-point, conditions or site-run values (the
 * sites' public names); no contact data,
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
    occurredAt: appNowTimestamp("occurred_at").notNull(),
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    // Leads on the person column so deleting a person (a demo shop's cascade,
    // `discardUnusedBuyer`) probes this foreign key by index, not by scanning
    // every shop's rows; a (shop_id, …) composite cannot serve that probe.
    // `people-fk-indexes.test.ts` holds the list (fourth review, row 31).
    index("trip_change_events_actor_person_id_idx").on(table.actorPersonId),
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
    recordedAt: appNowTimestamp("recorded_at").notNull(),
    /**
     * On a `home` tap only: how many seats and crew the record named as not
     * counted after a dive when the crew said Home (issue #3896), the largest
     * any Home on the departure stored, so the record says "Home was said with
     * 2 people not counted". Null on every other word, and on a Home with
     * nobody left out of a started count.
     */
    notCounted: integer("not_counted"),
    /** The final tiebreak when two taps share an instant, as on the roll call. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
  },
  (table) => [
    check(
      "trip_stage_events_not_counted_home_only",
      sql`${table.notCounted} is null or (${table.stage} = 'home' and ${table.notCounted} > 0)`,
    ),
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
    savedAt: appNowTimestamp("saved_at").notNull(),
  },
  (table) => [
    uniqueIndex("form_drafts_person_form_unique").on(table.shopId, table.personId, table.form),
    index("form_drafts_saved_at_idx").on(table.savedAt),
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
 * `last_seen_seq` is a position in `activity_events.seq` (issue #2701): the
 * strip is the desk-flagged lines after it (`src/db/trip-read-marks.ts`).
 *
 * Mutable latest state, not a trail, so it has no `seq` and no history. It is
 * pruned on `last_seen_at` after the same 30 days the desk lines are: a mark
 * that outlives every line it points past says nothing.
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
    lastSeenAt: appNowTimestamp("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("trip_read_marks_trip_person_unique").on(table.tripId, table.personId),
    index("trip_read_marks_shop_seen_idx").on(table.shopId, table.lastSeenAt),
  ],
);

/** A staff member's first view and acknowledgements for a shop-local day. */
export const todayReadMarks = pgTable(
  "today_read_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    dayStart: timestamp("day_start", { withTimezone: true }).notNull(),
    lastSeenAt: appNowTimestamp("last_seen_at").notNull(),
  },
  (table) => [
    uniqueIndex("today_read_marks_shop_person_day_unique").on(
      table.shopId,
      table.personId,
      table.dayStart,
    ),
    index("today_read_marks_person_idx").on(table.personId),
    index("today_read_marks_seen_idx").on(table.lastSeenAt),
    uniqueIndex("today_read_marks_shop_id_id_unique").on(table.shopId, table.id),
  ],
);

/** Exact desk lines seen; cascades when either the mark or the line is pruned. */
export const todayReadMarkEvents = pgTable(
  "today_read_mark_events",
  {
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    markId: uuid("mark_id")
      .notNull()
      .references(() => todayReadMarks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => activityEvents.id, { onDelete: "cascade" }),
  },
  (table) => [
    foreignKey({
      name: "today_read_mark_events_shop_mark_fk",
      columns: [table.shopId, table.markId],
      foreignColumns: [todayReadMarks.shopId, todayReadMarks.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "today_read_mark_events_shop_event_fk",
      columns: [table.shopId, table.eventId],
      foreignColumns: [activityEvents.shopId, activityEvents.id],
    }).onDelete("cascade"),
    uniqueIndex("today_read_mark_events_unique").on(table.markId, table.eventId),
    index("today_read_mark_events_shop_idx").on(table.shopId),
    index("today_read_mark_events_event_idx").on(table.eventId),
  ],
);
