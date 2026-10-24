import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { SystemReason } from "@/lib/activity";
import { nowDate } from "@/lib/clock";
import { seatName } from "@/lib/held-seat";
import type { RosterChangeCode } from "@/lib/incident-export";
import type { TurnAwayReason } from "@/lib/turn-away";
import { isUuid } from "@/lib/uuid";
import type { AppDb, DbExecutor } from "./client";
import { offsetPage, PAGE_SIZE } from "./paging";
import { activityEvents, bookings, internalNotes, people, trips } from "./schema";
import { livePerson, liveTrip } from "./trips-live";

export async function addInternalNote(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingId: string;
    actorPersonId: string;
    body: string;
  },
) {
  if (![input.shopId, input.tripId, input.bookingId, input.actorPersonId].every(isUuid))
    return null;
  const body = input.body.trim();
  if (!body || body.length > 1_000) return null;
  return db.transaction(async (tx) => {
    const [scope] = await tx
      .select({ personId: bookings.personId, tripId: bookings.tripId, diverName: people.fullName })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.tripId, input.tripId),
          eq(bookings.shopId, input.shopId),
          eq(trips.shopId, input.shopId),
        ),
      )
      .limit(1);
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId), livePerson()))
      .limit(1);
    if (!scope || !actor) return null;
    const [note] = await tx
      .insert(internalNotes)
      .values({
        shopId: input.shopId,
        bookingId: input.bookingId,
        personId: scope.personId,
        createdByPersonId: input.actorPersonId,
        body,
      })
      .returning();
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: scope.tripId,
      bookingId: input.bookingId,
      actorPersonId: input.actorPersonId,
      code: "note_added",
      params: { actor: actor.name, diver: scope.diverName },
      occurredAt: nowDate(),
    });
    return note ?? null;
  });
}

/**
 * Add a note to the diver record rather than to one booking. The same
 * staff-only record can then be read from the diver page and from any boat
 * manifest that carries that diver, without copying text between surfaces.
 * Notes are context only: no readiness, boarding, capacity, or checkpoint
 * decision reads them.
 */
export async function addDiverNote(
  db: AppDb,
  input: { shopId: string; personId: string; actorPersonId: string; body: string },
) {
  if (![input.shopId, input.personId, input.actorPersonId].every(isUuid)) return null;
  const body = input.body.trim();
  if (!body || body.length > 1_000) return null;
  return db.transaction(async (tx) => {
    const [diver] = await tx
      .select({ name: people.fullName })
      .from(people)
      // diveday:allow-deleted-people: the diver's name for a note on their record, which stays readable after removal.
      .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
      .limit(1);
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId), livePerson()))
      .limit(1);
    if (!diver || !actor) return null;
    const [note] = await tx
      .insert(internalNotes)
      .values({
        shopId: input.shopId,
        personId: input.personId,
        bookingId: null,
        createdByPersonId: input.actorPersonId,
        body,
      })
      .returning();
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.actorPersonId,
      // The seat-shaped handles are both null here, so the subject is the only
      // thing tying this line to the record it was written on.
      subjectPersonId: input.personId,
      code: "note_added",
      params: { actor: actor.name, diver: diver.name },
      occurredAt: nowDate(),
    });
    return note ?? null;
  });
}

/**
 * The record-scoped lines this writer can file.
 *
 * Named one by one rather than accepting any {@link ActivityCode}, because the
 * two names this function looks up — the actor and the diver — are exactly the
 * parameters these two sentences take. A code needing a third name would
 * compile here and render with a gap, so it does not compile here.
 */
export type DiverActivityCode =
  | "identity_confirmed"
  | "identity_split_off"
  | "identity_repointed_off"
  | "identity_repointed_onto"
  | "medical_clearance_opened"
  | "diver_medical_form_opened"
  | "medical_answers_read"
  | "medical_alert_read"
  | "medical_alert_saved_offline"
  | "medical_alert_printed"
  | "medical_alert_emergency_read"
  | "date_of_birth_cleared_as_adult"
  | "record_exported"
  | "dispute_sheet_printed"
  | "running_late_from_message";

/**
 * One line on the diver-record trail, subject-only — the same shape
 * `addDiverNote` above writes for itself, pulled out because a second caller
 * needed it (issue #726: recording that a diver's own record was exported).
 * Both handles are null, same reason as `addDiverNote`'s own comment: the
 * subject is what ties this line to the record it was written on, not a trip
 * or a booking.
 */
export async function recordDiverActivity(
  db: DbExecutor,
  input: {
    shopId: string;
    personId: string;
    actorPersonId: string;
    code: DiverActivityCode;
    /**
     * The departure a medical alert was read or saved on (issue #2960), kept
     * in the params rather than `trip_id` so the line stays on the diver's
     * trail and off the trip's feed, its incident export and dispute sheet.
     */
    departureId?: string;
  },
): Promise<boolean> {
  const [diver] = await db
    .select({ name: people.fullName })
    .from(people)
    // diveday:allow-deleted-people: the diver's name for a line on their record, which stays readable after removal.
    .where(and(eq(people.id, input.personId), eq(people.shopId, input.shopId)))
    .limit(1);
  const [actor] = await db
    .select({ name: people.fullName })
    .from(people)
    .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId), livePerson()))
    .limit(1);
  if (!diver || !actor) return false;
  await db.insert(activityEvents).values({
    shopId: input.shopId,
    tripId: null,
    bookingId: null,
    actorPersonId: input.actorPersonId,
    subjectPersonId: input.personId,
    code: input.code,
    params: {
      actor: actor.name,
      diver: diver.name,
      ...(input.departureId ? { departure: input.departureId } : {}),
    },
    occurredAt: nowDate(),
  });
  return true;
}

/**
 * Return-what-you-deleted, same convention as `deleteRecapPhoto`
 * (`DeleteRecapPhotoResult`): the caller needs the booking + text back to
 * offer a one-tap undo that recreates the note (docs/design/principles.md
 * §7) — a purely reversible edit, unlike the money-moving actions on this
 * page that keep a blocking confirm.
 */
export type DeleteInternalNoteResult =
  | { deleted: true; bookingId: string; body: string }
  | { deleted: false };

export async function deleteInternalNote(
  db: AppDb,
  input: { shopId: string; tripId: string; noteId: string; actorPersonId: string },
): Promise<DeleteInternalNoteResult> {
  if (![input.shopId, input.tripId, input.noteId, input.actorPersonId].every(isUuid)) {
    return { deleted: false };
  }
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({
        // `bookings.id`, not the nullable `internalNotes.bookingId` column —
        // the inner join below already guarantees a match, so this is the
        // non-null value `DeleteInternalNoteResult` promises callers.
        bookingId: bookings.id,
        body: internalNotes.body,
        tripId: bookings.tripId,
        diverName: people.fullName,
      })
      .from(internalNotes)
      .innerJoin(bookings, eq(bookings.id, internalNotes.bookingId))
      .innerJoin(people, eq(people.id, internalNotes.personId))
      .where(
        and(
          eq(internalNotes.id, input.noteId),
          eq(internalNotes.shopId, input.shopId),
          eq(bookings.tripId, input.tripId),
        ),
      )
      .limit(1);
    if (!note) return { deleted: false };
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId), livePerson()))
      .limit(1);
    if (!actor) return { deleted: false };
    await tx
      .delete(internalNotes)
      .where(and(eq(internalNotes.id, input.noteId), eq(internalNotes.shopId, input.shopId)));
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: note.tripId,
      bookingId: note.bookingId,
      actorPersonId: input.actorPersonId,
      code: "note_deleted",
      params: { actor: actor.name, diver: note.diverName },
      occurredAt: nowDate(),
    });
    return { deleted: true, bookingId: note.bookingId, body: note.body };
  });
}

export type DeleteDiverNoteResult = { deleted: true; body: string } | { deleted: false };

/** Delete a person-scoped note; the caller can offer a one-tap undo. */
export async function deleteDiverNote(
  db: AppDb,
  input: { shopId: string; personId: string; noteId: string; actorPersonId: string },
): Promise<DeleteDiverNoteResult> {
  if (![input.shopId, input.personId, input.noteId, input.actorPersonId].every(isUuid)) {
    return { deleted: false };
  }
  return db.transaction(async (tx) => {
    const [note] = await tx
      .select({ body: internalNotes.body, diverName: people.fullName })
      .from(internalNotes)
      .innerJoin(people, eq(people.id, internalNotes.personId))
      .where(
        and(
          eq(internalNotes.id, input.noteId),
          eq(internalNotes.shopId, input.shopId),
          eq(internalNotes.personId, input.personId),
          isNull(internalNotes.bookingId),
        ),
      )
      .limit(1);
    if (!note) return { deleted: false };
    const [actor] = await tx
      .select({ name: people.fullName })
      .from(people)
      .where(and(eq(people.id, input.actorPersonId), eq(people.shopId, input.shopId), livePerson()))
      .limit(1);
    if (!actor) return { deleted: false };
    await tx
      .delete(internalNotes)
      .where(
        and(
          eq(internalNotes.id, input.noteId),
          eq(internalNotes.shopId, input.shopId),
          eq(internalNotes.personId, input.personId),
          isNull(internalNotes.bookingId),
        ),
      );
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: null,
      bookingId: null,
      actorPersonId: input.actorPersonId,
      subjectPersonId: input.personId,
      code: "note_deleted",
      params: { actor: actor.name, diver: note.diverName },
      occurredAt: nowDate(),
    });
    return { deleted: true, body: note.body };
  });
}

export async function listBookingNotes(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ note: internalNotes, authorName: people.fullName })
    .from(internalNotes)
    .innerJoin(bookings, eq(bookings.id, internalNotes.bookingId))
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .where(and(eq(internalNotes.shopId, shopId), eq(bookings.tripId, tripId)))
    .orderBy(asc(internalNotes.createdAt));
}

/**
 * Every staff note about one diver, in one chronological record.
 *
 * `internal_notes` already holds both scopes: a person-scoped note has no
 * booking, while a trip note has the booking and therefore its departure.
 * The diver record is the one place staff need the complete story, so it
 * reads both shapes and carries the booking context as metadata instead of
 * copying a trip note into a second note system.
 */
export async function listDiverRecordNotes(db: AppDb, shopId: string, personId: string) {
  return db
    .select({
      note: internalNotes,
      authorName: people.fullName,
      tripId: trips.id,
      tripTitle: trips.title,
      tripStartsAt: trips.startsAt,
    })
    .from(internalNotes)
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .leftJoin(bookings, eq(bookings.id, internalNotes.bookingId))
    .leftJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, shopId)))
    .where(and(eq(internalNotes.shopId, shopId), eq(internalNotes.personId, personId)))
    .orderBy(asc(internalNotes.createdAt));
}

/**
 * Resolve diver-scoped notes onto the booking that represents that diver on a
 * trip. This is the bridge that lets the Diver page and boat manifest share
 * one source of truth without making a diver note belong to a single booking.
 *
 * **Never onto a held seat** (issue #1690, security re-review B3): a note about
 * the person is a note about the matched diver, who may not be the one aboard.
 * The seat's own booking-scoped notes are a different read and still show.
 */
export async function listDiverNotesForTrip(db: AppDb, shopId: string, tripId: string) {
  return db
    .select({ note: internalNotes, authorName: people.fullName, bookingId: bookings.id })
    .from(internalNotes)
    .innerJoin(bookings, eq(bookings.personId, internalNotes.personId))
    .innerJoin(people, eq(people.id, internalNotes.createdByPersonId))
    .where(
      and(
        eq(internalNotes.shopId, shopId),
        isNull(internalNotes.bookingId),
        eq(bookings.shopId, shopId),
        eq(bookings.tripId, tripId),
        isNull(bookings.identityUnconfirmedAt),
      ),
    )
    .orderBy(asc(internalNotes.createdAt));
}

/**
 * A trip's activity trail, newest first.
 *
 * Ordered by `seq` as well as time, because `occurred_at` ties constantly: two
 * events written in one request share an instant (deleting a note records its
 * own event beside the add's), and the e2e clock is frozen so every event in a
 * test carries the identical timestamp. Ordering on time alone left the tie to
 * whatever the heap returned, which changes whenever rows move — the trail
 * then reads backwards, "deleted a private note" sitting above the "added" it
 * followed. `seq` is the only column here that records what actually came
 * first (`id` is `defaultRandom()`).
 */
export async function listTripActivity(db: AppDb, shopId: string, tripId: string) {
  return db
    .select()
    .from(activityEvents)
    .where(and(eq(activityEvents.shopId, shopId), eq(activityEvents.tripId, tripId)))
    .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.seq))
    .limit(50);
}

/** How many lines of a diver's trail the record shows at a time. */
export const DIVER_ACTIVITY_PAGE_SIZE = PAGE_SIZE.section;

/**
 * Everything in the shop's activity trail that is **about one person**, newest
 * first, one page at a time.
 *
 * Three things make an event theirs, and the set is not arbitrary — it is
 * exactly the predicate `anonymizeDiver` redacts under (`src/db/anonymize.ts`),
 * so the set a shop can read here and the set an erasure destroys are the same
 * set by construction:
 *
 * - it happened **to a seat of theirs** (`booking_id` is one of their bookings),
 * - or they **did** it (`actor_person_id`) — a divemaster's own trail across
 *   every boat they ran,
 * - or it is **about them** (`subject_person_id`) — a note written on their
 *   record, which hangs off no seat at all.
 *
 * A clause added here is added to that sweep in the same change or not at all.
 * Widening the reader alone would leave lines readable on a record *after* an
 * erasure had run, which is the exact failure the pairing exists to prevent.
 *
 * Nothing is redacted at read time and nothing needs to be: an erased person's
 * lines already read `[redacted]` in the table, written once inside the erasure
 * transaction. A reader that filtered instead would be a second, weaker copy of
 * that rule, and the weaker copy is the one that gets forgotten.
 *
 * Scoped by the caller's `shopId` on the events *and* on the booking subquery,
 * so a person id belonging to another tenant selects nothing rather than
 * leaking one shop's trail through the other's `personId`.
 *
 * Paged rather than capped: a returning diver accumulates lines for as long as
 * they dive with the shop, and a list with no end is the surface that
 * photographs 17,000px tall. `seq` breaks the constant `occurred_at` ties for
 * the same reason `listTripActivity` above does.
 */
export async function pagedDiverActivity(
  db: AppDb,
  shopId: string,
  personId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  // Postgres *raises* on a malformed literal compared against a `uuid` column
  // rather than selecting nothing, so an unguarded id is a 500 where an empty
  // trail belongs — the same hazard `uuidParam` covers on a route segment.
  // Both writers above guard this way; this reader's only caller narrows its
  // segment today, and the next one may not.
  const usable = isUuid(shopId) && isUuid(personId);
  const theirs = and(
    eq(activityEvents.shopId, shopId),
    or(
      inArray(
        activityEvents.bookingId,
        db
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.shopId, shopId), eq(bookings.personId, personId))),
      ),
      eq(activityEvents.actorPersonId, personId),
      eq(activityEvents.subjectPersonId, personId),
    ),
  );
  return offsetPage({
    page: options.page,
    pageSize: options.pageSize ?? DIVER_ACTIVITY_PAGE_SIZE,
    countRows: async () => {
      if (!usable) return 0;
      // diveday:allow-unscoped-event: `theirs` opens with activityEvents.shopId.
      const [row] = await db.select({ count: count() }).from(activityEvents).where(theirs);
      return row?.count ?? 0;
    },
    fetchRows: async (offset, limit) =>
      usable
        ? await db
            .select()
            // diveday:allow-unscoped-event: `theirs` opens with activityEvents.shopId.
            .from(activityEvents)
            .where(theirs)
            .orderBy(desc(activityEvents.occurredAt), desc(activityEvents.seq))
            .limit(limit)
            .offset(offset)
        : [],
  });
}

/**
 * A line on a departure's trail, and the names it needs **beyond the actor**.
 *
 * The actor is not in here because the caller does not know it: this function
 * looks the name up, in the same query that proves the trip is this shop's and
 * still live. Everything else the sentence needs comes from the call site,
 * typed per code so a sentence about a crew member cannot be filed with a
 * diver's name in it.
 */
export type TripActivityEntry = RosterTripActivityEntry | OtherTripActivityEntry;

/**
 * **A line that changes who is aboard** (`ROSTER_CHANGE_CODES`): the departure
 * log prints these, so each one is written with whose seat or crew place it
 * was, by record (`subject_person_id`), and erasure reaches it by that rather
 * than by a name in its params (security review 2026-10-16, F1).
 */
export type RosterTripActivityEntry =
  | {
      code: Exclude<
        RosterChangeCode,
        CrewChangeCode | "seat_self_cancelled" | "seat_self_refunded" | "booking_turned_away"
      >;
      diver: string;
    }
  | { code: "booking_turned_away"; diver: string; reason: TurnAwayReason }
  | { code: CrewChangeCode; crew: string }
  | { code: "seat_self_cancelled" | "seat_self_refunded" };

type CrewChangeCode = "crew_assigned" | "crew_removed";

/** A seat change named by `recordSeatChange`, which reads the name itself. */
export type SeatChangeCode = Exclude<
  Extract<RosterTripActivityEntry, { diver: string }>["code"],
  "booking_turned_away"
>;

type OtherTripActivityEntry =
  | {
      code: "identity_confirmed" | "identity_split" | "identity_repointed" | "departure_offered";
      diver: string;
    }
  | {
      code: "participant_type_changed";
      diver: string;
      from: "diver" | "snorkeler" | "rider";
      type: "diver" | "snorkeler" | "rider";
      /** Whether the change cleared, or was written past, a certification check. */
      certCheck: "none" | "cleared" | "overridden";
      /** The certification blocker codes the seat stopped facing, comma-joined; empty for none. */
      cleared: string;
      /** Whether the change was made after the time on the board (issue #2225). */
      atSea: "yes" | "no";
    }
  | {
      code:
        | "blowout_called"
        | "series_cancelled"
        | "booking_link_requested"
        | "seat_claimed"
        // A held seat's own cancel (issue #2467) names nobody but "the diver on
        // this seat", and its actor is a guess: not a roster line the log prints.
        | "seat_holder_cancelled"
        | "seat_holder_refunded"
        | "incident_report_filed"
        | "incident_report_addendum_added"
        | "incident_draft_discarded"
        | "incident_legal_hold_set"
        | "incident_legal_hold_released"
        | "missing_diver_alert_raised"
        | "missing_diver_found"
        | "departure_note_sent";
    };

type TripActivityInput = {
  shopId: string;
  tripId: string;
  actorPersonId: string;
  /**
   * The seat a line is about, so erasure's sweep by booking reaches it from
   * whoever holds the seat now, a held seat split off to its own record
   * included (security re-review 2026-10-16, item 1).
   */
  bookingId?: string;
} & (
  | {
      entry: RosterTripActivityEntry;
      /** Whose seat or crew place it was: required, so no roster line is a bare name. */
      subjectPersonId: string;
    }
  | {
      entry: OtherTripActivityEntry;
      /** The diver a line is about when no booking carries them (`activity_events.subject_person_id`). */
      subjectPersonId?: string;
    }
);

export async function recordTripActivity(db: DbExecutor, input: TripActivityInput) {
  const entry = input.entry;
  const [scope] = await db
    .select({ actorName: people.fullName })
    .from(trips)
    .innerJoin(people, eq(people.id, input.actorPersonId))
    .where(
      and(
        liveTrip(),
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(people.shopId, input.shopId),
      ),
    )
    .limit(1);
  if (!scope) return null;
  const { code: _code, ...names } = entry;
  const [event] = await db
    .insert(activityEvents)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      actorPersonId: input.actorPersonId,
      bookingId: input.bookingId ?? null,
      subjectPersonId: input.subjectPersonId ?? null,
      code: entry.code,
      params: { actor: scope.actorName, ...names },
      occurredAt: nowDate(),
    })
    .returning();
  return event ?? null;
}

/**
 * **A seat change on a departure's trail, named from the seat itself**: whose
 * seat by record, and by the name it was booked as when it is held (issue
 * #2128), never the person it was matched to. Called inside the transaction
 * that changed the seat where the caller has one, so the change and its line
 * commit together. A booking that is not this shop's writes nothing.
 */
export async function recordSeatChange(
  db: DbExecutor,
  input: {
    shopId: string;
    tripId: string;
    actorPersonId: string;
    bookingId: string;
    code: SeatChangeCode;
  },
) {
  const [seat] = await db
    .select({
      personId: bookings.personId,
      fullName: people.fullName,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
      identityBookedAs: bookings.identityBookedAs,
    })
    .from(bookings)
    // diveday:allow-deleted-people: the seat's own diver, named on its trail line.
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!seat) return null;
  return recordTripActivity(db, {
    shopId: input.shopId,
    tripId: input.tripId,
    actorPersonId: input.actorPersonId,
    bookingId: input.bookingId,
    subjectPersonId: seat.personId,
    entry: { code: input.code, diver: seatName(seat.fullName, seat) },
  });
}

/**
 * **A line the system wrote on its own** (issue #2539): an automatic call-off,
 * where no person acted. The row has no actor and says why in `system_reason`,
 * which the table's check holds in step. Returns null for a departure that is
 * not this shop's.
 */
export async function recordSystemTripActivity(
  db: DbExecutor,
  input: { shopId: string; tripId: string; reason: SystemReason },
) {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    // diveday:allow-deleted-trips: the call-off line is written as the departure is called off.
    .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
    .limit(1);
  if (!trip) return null;
  const [event] = await db
    .insert(activityEvents)
    .values({
      shopId: input.shopId,
      tripId: input.tripId,
      actorPersonId: null,
      systemReason: input.reason,
      code: "departure_called_off_automatically",
      params: { reason: input.reason },
      occurredAt: nowDate(),
    })
    .returning();
  return event ?? null;
}

/**
 * **A diver gave up their own seat** from their trip-prep link (UX review
 * 2026-10-11, item 19), and whether the card refund went through, on the
 * departure's trail. The owner's "who refunded what" question has an answer
 * that is not a staffer: the diver, by the shop's own cancellation window.
 *
 * Read off the booking itself, scoped to the shop the capability named, so
 * the line names the seat's own diver and lands on that seat's departure. A
 * booking that is not this shop's writes nothing.
 */
export async function recordDiverSelfCancel(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    refunded: boolean;
    /**
     * A party seat that went with its lead's cancel (batch 6 item 10): the
     * lead's booking and the seat's name, so the line names who cancelled and
     * whose seat it was.
     */
    party?: { leadBookingId: string; seatName: string };
  },
) {
  const [booking] = await db
    .select({
      tripId: bookings.tripId,
      personId: bookings.personId,
      identityUnconfirmedAt: bookings.identityUnconfirmedAt,
    })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .limit(1);
  if (!booking) return null;
  if (input.party) {
    const [lead] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(and(eq(bookings.id, input.party.leadBookingId), eq(bookings.shopId, input.shopId)))
      .limit(1);
    if (!lead) return null;
    return recordTripActivity(db, {
      shopId: input.shopId,
      tripId: booking.tripId,
      actorPersonId: lead.personId,
      subjectPersonId: booking.personId,
      entry: {
        code: input.refunded ? "party_seat_self_refunded" : "party_seat_self_cancelled",
        diver: input.party.seatName,
      },
    });
  }
  // A seat whose identity is held for review (issue #2467, #2082) is matched to
  // this person on a guess, and whoever held the link is not known to be them:
  // the line says "the diver on this seat", never their name. The event still
  // carries the matched person as its actor, which the column requires.
  if (booking.identityUnconfirmedAt !== null) {
    return recordTripActivity(db, {
      shopId: input.shopId,
      tripId: booking.tripId,
      actorPersonId: booking.personId,
      entry: { code: input.refunded ? "seat_holder_refunded" : "seat_holder_cancelled" },
    });
  }
  return recordTripActivity(db, {
    shopId: input.shopId,
    tripId: booking.tripId,
    actorPersonId: booking.personId,
    subjectPersonId: booking.personId,
    entry: { code: input.refunded ? "seat_self_refunded" : "seat_self_cancelled" },
  });
}
