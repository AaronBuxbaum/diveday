import { and, asc, desc, eq, gt, gte, inArray, lte, ne, or } from "drizzle-orm";
import { ARRIVAL_RETRACTION_SUPERSEDED } from "@/lib/arrival";
import { nowDate } from "@/lib/clock";
import { arrivalsWindow } from "@/lib/departure-clock";
import type { IdentityMatchKind } from "@/lib/identity-match";
import { OFFLINE_EVENT_SKEW_MS, offlineEventOutOfBounds } from "@/lib/offline-events";
import { hasArrived, type StandingArrival } from "@/lib/presence";
import { priorVisitStanding } from "@/lib/prior-visits";
import type { ReadinessResult } from "@/lib/readiness";
import { runningLateShown } from "@/lib/running-late";
import type { TurnAwayReason } from "@/lib/turn-away";
import { isUuid } from "@/lib/uuid";
import { seatCheckedIn } from "./arrival-provenance";
import { requireActiveStaffId } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import {
  departureRollCallForBooking,
  listAfterDiveRollCallByTrip,
  listDepartureBoardedBookingIds,
  type OnTheWater,
} from "./manifests";
import { recordActivityRow } from "./operations";
import { personSearchMatch } from "./person-search";
import { getBookingReadiness, listTripsReadiness } from "./readiness";
import {
  activityEvents,
  bookingArrivalEvents,
  bookings,
  people,
  priorVisits,
  trips,
} from "./schema";
import { lockSeatDeparture } from "./seat-locks";
import { liveTrip } from "./trips-live";
import { seatNotCancelled } from "./trips-queries";

export type CheckInQueueRow = {
  bookingId: string;
  personId: string;
  personName: string;
  email: string | null;
  /**
   * For the guardian rule (`src/lib/guardian.ts`): a minor's paper release
   * names its co-signer, so the counter's own paper-signature form has to know
   * whether to ask (ADR 20260907-guardian-co-signature). Null when the shop
   * never asked — the rule fails open, as H-20260724-certification-levels-agency-rules's minimum-age gate does.
   */
  dateOfBirth: string | null;
  /**
   * The name a held seat was booked under and why it was matched (H-20260724-one-person-per-email), so
   * the counter can name both people. Null on every seat not held.
   */
  identityBookedAs: string | null;
  identityMatchedBy: IdentityMatchKind | null;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  /**
   * `no_show` is here because the row must not vanish the instant a staffer
   * releases the seat (issue #1209): the diver who walks in as the lines come
   * off needs an Undo to walk back to, and the shop needs somewhere to be told
   * who is waiting for the seat. It leaves the queue when the arrivals window
   * does, like every other row.
   */
  bookingStatus: "booked" | "no_show";
  /**
   * The desk has this diver seen: the seat is held and the arrival trail's
   * newest word is `arrived` (`seatCheckedIn`, src/db/arrival-provenance.ts).
   * Not a seat status (issue #2702): a released seat keeps its sighting
   * standing, and this reads false on it.
   */
  checkedIn: boolean;
  /**
   * On a released seat, why the desk turned the diver away (H-20261015-who-may-turn-someone); null on a
   * plain "Not here" and on every seat still held. The two are different
   * statements — seen and refused, or never came — and every surface that
   * reads the release says which.
   */
  turnedAwayReason: TurnAwayReason | null;
  /**
   * When the desk turned the diver away: the fact itself, which erasure keeps
   * when it clears the category. Null on a plain "Not here".
   */
  turnedAwayAt: Date | null;
  /**
   * When the diver said they are running late (J3), on a seat still to
   * arrive; null otherwise. Already filtered through `runningLateShown`, so a
   * reader never shows it on an arrived or released seat.
   */
  runningLateAt: Date | null;
  readiness: ReadinessResult;
  /**
   * The diver's latest departure roll-call record on the manifest is
   * "boarded". Check-in and boarding are two different questions — arrived
   * vs. aboard — and arrival used to have exactly one reader in the app
   * (this queue itself never showed boarding). See `checkedIn` on
   * `ManifestDiverInput` for the manifest's half of the same fix (task 149,
   * UX persona lens 17).
   */
  boarded: boolean;
  /**
   * **The crew's own roll call puts this diver on the water**, which is a wider
   * question than the badge above and is asked for a different reason: it is
   * what `noShowGate` refuses on (src/lib/no-show.ts). True on a `boarded`
   * standing at **any** checkpoint, and on a `not_boarded` standing at an
   * **after-dive** one — "did not come back from the dive" rather than "never
   * came", which is the manifest holding them as missing.
   *
   * Separate from `boarded` rather than replacing it, because the two are
   * genuinely different facts: the badge says the crew counted this diver onto
   * the boat at the dock, and this says the shop's records place them at sea.
   * Feeding the gate the badge's narrower answer is what drew "Did not dive?"
   * over a diver the crew were still looking for — the writer refused the tap,
   * so no seat was lost, but the counter spent two taps inviting the desk to
   * write off a missing person (dive-domain-expert review, issue #1704).
   */
  onTheWater: OnTheWater;
  /**
   * No **usable** emergency contact on this diver's record — the same test
   * Today's Contact rows apply (`missingEmergencyContactByTrip` in
   * `src/features/today/today-reader.ts`): a name *and* a phone, because a name with no number
   * reads as "on file" and is unreachable in an incident.
   *
   * Never a boarding blocker. It is a nudge the counter can settle in the ten
   * seconds the diver is standing there, which is the one moment in the day
   * when asking costs nothing (ADR 20260827-clearwater-surface-language,
   * decision 9).
   */
  missingEmergencyContact: boolean;
  /**
   * This seat is the diver's **first** with the shop, counting DiveDay's own
   * bookings *and* the visits a migration carried across
   * (ADR 20260725-import-prior-visits) — the merged-history semantics
   * `src/db/recap.ts` reads for its visit count. Counting native bookings
   * alone would greet a ten-year regular whose history arrived in a CSV as a
   * newcomer, which is worse than saying nothing.
   *
   * Batched over the whole queue, never one query per row.
   */
  firstVisit: boolean;
};

/**
 * Whether any departure has someone to check in right now — the arrivals
 * window `listCheckInQueue` reads, with no query. Today shows its arrival
 * lookup on this, not on its own spine, so the search is there the evening
 * before a dawn boat and the afternoon after the last one sailed.
 */
export async function hasArrivals(db: AppDb, shopId: string, now: Date = nowDate()) {
  const arrivals = arrivalsWindow(now);
  const [row] = await db
    .select({ id: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        seatNotCancelled,
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The counter queue is intentionally a bounded, day-of read: the arrivals lens
 * on the shared operational horizon (`src/lib/operational-window.ts`), never a
 * freestanding window of its own. A scanner that types a booking id into the
 * search box gets the same result as a name/email/phone search, while the
 * default view stays small enough to use one-handed on a phone. Readiness
 * always comes from the shared service, never a second gate.
 *
 * The person half of the search is `personSearchMatch`
 * (`src/db/person-search.ts`), so Today's arrival lookup finds a diver by
 * name, email or phone exactly as the diver search does (issue #1765).
 *
 * `tripId` narrows the read to one departure: the trip page's Divers tab, once arrivals open.
 */
export async function listCheckInQueue(
  db: AppDb,
  shopId: string,
  options: { query?: string; now?: Date; tripId?: string } = {},
): Promise<CheckInQueueRow[]> {
  const now = options.now ?? nowDate();
  const arrivals = arrivalsWindow(now);
  const query = options.query?.trim() ?? "";
  const queryFilter = query
    ? or(personSearchMatch(query), isUuid(query) ? eq(bookings.id, query) : undefined)
    : undefined;
  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      personName: people.fullName,
      email: people.email,
      dateOfBirth: people.dateOfBirth,
      identityBookedAs: bookings.identityBookedAs,
      identityMatchedBy: bookings.identityMatchedBy,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      bookingStatus: bookings.status,
      checkedIn: seatCheckedIn,
      turnedAwayReason: bookings.turnedAwayReason,
      turnedAwayAt: bookings.turnedAwayAt,
      runningLateAt: bookings.runningLateAt,
      emergencyContactName: people.emergencyContactName,
      emergencyContactPhone: people.emergencyContactPhone,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        seatNotCancelled,
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
        options.tripId ? eq(trips.id, options.tripId) : undefined,
        queryFilter,
      ),
    )
    .orderBy(asc(trips.startsAt), asc(people.fullName));

  const tripIds = [...new Set(rows.map((row) => row.tripId))];
  const readinessByBooking = new Map<string, ReadinessResult>();
  const readinessRows = await listTripsReadiness(db, shopId, tripIds, now);
  for (const row of readinessRows) {
    readinessByBooking.set(row.booking.id, row.readiness);
  }
  const boardedBookingIds = await listDepartureBoardedBookingIds(db, shopId, tripIds);
  // The other half of what "on the water" means, for the no-show door. One
  // grouped query for the queue's trips, beside the departure read rather than
  // instead of it — the badge needs the dock and the gate needs both.
  const afterDiveByTrip = await listAfterDiveRollCallByTrip(db, shopId, tripIds);
  const history = await queueVisitHistory(db, shopId, rows, arrivals.to);

  return rows.map(({ emergencyContactName, emergencyContactPhone, ...row }) => ({
    ...row,
    bookingStatus: row.bookingStatus as "booked" | "no_show",
    runningLateAt: runningLateShown(row),
    boarded: boardedBookingIds.has(row.bookingId),
    onTheWater: boardedBookingIds.has(row.bookingId)
      ? "boarded"
      : (afterDiveByTrip.get(row.tripId)?.get(row.bookingId) ?? null),
    missingEmergencyContact: !emergencyContactName || !emergencyContactPhone,
    firstVisit: history.firstVisitBookingIds.has(row.bookingId),
    readiness: readinessByBooking.get(row.bookingId) ?? {
      status: "blocked",
      blockers: [{ code: "readiness_unavailable" }],
    },
  }));
}

/**
 * Which of the queue's seats are their diver's **first** with this shop.
 *
 * Two batched reads over the queue's person ids, never one per row: every
 * booking they hold up to the end of the arrivals window, and every visit a
 * migration carried across. A seat is a first visit when the diver has exactly
 * one booking at or before this departure and no imported history at all.
 *
 * **Counting booking rows here is counting departures.** `bookings` carries a
 * unique index on `(trip_id, person_id)`, so a diver holds at most one seat on
 * any one boat: a party is one row per *person* — every seat a name the
 * organizer typed, resolved to its own `people` row (ADR
 * 20260804-seat-claim-links) — and never several rows riding under the
 * organizer's id. So a family of four on their first day is four divers with one
 * booking each, and every one of them is greeted. A 2026-08-28 review read the
 * count the other way and proposed a distinct-departure count to fix it; that is
 * the same number, and `check-in.test.ts` pins the constraint it rests on.
 *
 * **Deliberately looser than `src/db/recap.ts` in one direction only.** Recap
 * places an imported visit against the trip's *shop-local* day
 * (`visitedOn <= tripLocalDay`) before counting it; this counts any imported
 * visit the prior system did not mark as never-happened, whatever its date. The
 * difference can only ever *withhold* the greeting — from a diver whose old
 * system holds a future-dated line — and withholding it from a regular is the
 * failure that matters. Claiming a first visit for someone on their thirtieth
 * is the one outcome this must never produce, so the reader that would need the
 * shop's timezone to be marginally more generous does not ask for it.
 */
async function queueVisitHistory(
  db: AppDb,
  shopId: string,
  rows: readonly { bookingId: string; personId: string; startsAt: Date }[],
  through: Date,
): Promise<{ firstVisitBookingIds: Set<string> }> {
  const firstVisitBookingIds = new Set<string>();
  const personIds = [...new Set(rows.map((row) => row.personId))];
  if (personIds.length === 0) return { firstVisitBookingIds };

  const [bookingRows, priorVisitRows] = await Promise.all([
    db
      .select({ personId: bookings.personId, startsAt: trips.startsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.personId, personIds),
          seatNotCancelled,
          ne(bookings.status, "no_show"),
          liveTrip(),
          lte(trips.startsAt, through),
        ),
      ),
    db
      .select({ personId: priorVisits.personId, statusLabel: priorVisits.statusLabel })
      .from(priorVisits)
      .where(and(eq(priorVisits.shopId, shopId), inArray(priorVisits.personId, personIds))),
  ]);

  const migrated = new Set(
    priorVisitRows
      .filter((visit) => priorVisitStanding(visit.statusLabel) !== "did_not_happen")
      .map((visit) => visit.personId),
  );
  const startsByPerson = new Map<string, number[]>();
  for (const booking of bookingRows) {
    const list = startsByPerson.get(booking.personId);
    if (list) list.push(booking.startsAt.getTime());
    else startsByPerson.set(booking.personId, [booking.startsAt.getTime()]);
  }
  for (const row of rows) {
    if (migrated.has(row.personId)) continue;
    const starts = startsByPerson.get(row.personId) ?? [];
    const upToHere = starts.filter((start) => start <= row.startsAt.getTime()).length;
    if (upToHere === 1) firstVisitBookingIds.add(row.bookingId);
  }
  return { firstVisitBookingIds };
}

/**
 * What a device queued at the counter with no signal, carried alongside the
 * ordinary inputs rather than as a second function (ADR
 * 20260907-the-counter-survives-offline).
 *
 * One writer for both doors is the whole point: an offline arrival takes the
 * *same* staff gate, the same trip and booking checks and the same live
 * readiness re-read a staffer standing at the desk takes, and reaches them by
 * the same path rather than by a parallel one somebody has to remember to keep
 * in step. What the offline branch adds is only what a queue needs and a
 * present human does not — idempotency, a staleness bound, and the two
 * orderings below.
 */
export type ArrivalOfflineInput = {
  source?: "live" | "offline";
  /** Device-generated idempotency key. Required for an offline tap. */
  clientEventId?: string;
  /** The tap's own instant on the device, which is not the instant it arrives here. */
  occurredAt?: Date;
  /** When the copy the device was reading was saved — the staleness bound's other half. */
  offlineSnapshotSavedAt?: Date;
  /** The departure the desk or device saw the seat on; a seat moved since refuses the tap. */
  expectedTripId?: string;
};

/**
 * The refusals **only a queue can earn**, and the reason they are named as a
 * set: they answer a device reconciling minutes or hours after the tap, never
 * a staffer standing at the desk, so the counter's `?notice=` map deliberately
 * excludes them rather than carrying words nobody can reach. Naming them here
 * rather than spelling the exclusion at that call site is what keeps the
 * exhaustiveness the map does enforce — a *live* refusal added to either union
 * later is still a compile error there.
 *
 * `boarded` is the newest member and the one worth reading twice: it exists
 * because a queued retraction may arrive after the rail has put the diver on
 * the boat, and the live counter has no way to produce it — a staffer undoing
 * a check-in is looking at the person.
 */
export type ArrivalOfflineRefusal =
  | "newer_event_exists"
  | typeof ARRIVAL_RETRACTION_SUPERSEDED
  | "snapshot_invalid"
  | "boarded";

export type CheckInOutcome =
  | { ok: true; bookingId: string; personName: string; duplicate?: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "already_checked_in"
        | "not_bookable"
        | "not_ready"
        | "staff_not_found"
        | "newer_event_exists"
        | "snapshot_invalid";
      blockers?: ReadinessResult["blockers"];
      // Only set on `not_ready` — the caller needs it to link straight back to
      // the diver's Trip row (`trips/[id]#booking-<id>`), the same
      // rich-link pattern the manifest's `not_ready` refusal already uses.
      tripId?: string;
    };

/**
 * The newest arrival statement standing for one seat's current life, or
 * nothing.
 *
 * `desc(occurredAt), desc(createdAt), desc(seq)` — the same three keys
 * `recordRollCall` and `recordPreDepartureCheck` read their own trails back
 * by, and for the same reason: `occurred_at` ties constantly under a frozen
 * clock or a batched offline sync, so the last-appended row has to be the one
 * that wins or the device and the server order two taps differently.
 */
type NewestArrival = {
  status: StandingArrival;
  occurredAt: Date;
  clientEventId: string | null;
};

async function newestArrivalEvent(
  tx: DbExecutor,
  booking: { id: string; tripId: string; arrivalTrailAfterSeq: number | null },
  shopId: string,
): Promise<NewestArrival | undefined> {
  const [newest] = await tx
    .select({
      status: bookingArrivalEvents.status,
      occurredAt: bookingArrivalEvents.occurredAt,
      clientEventId: bookingArrivalEvents.clientEventId,
    })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.tripId, booking.tripId),
        eq(bookingArrivalEvents.bookingId, booking.id),
        // The seat's current life only (`sinceSeatReopened`, arrival-provenance.ts).
        booking.arrivalTrailAfterSeq === null
          ? undefined
          : gt(bookingArrivalEvents.seq, booking.arrivalTrailAfterSeq),
      ),
    )
    .orderBy(
      desc(bookingArrivalEvents.occurredAt),
      desc(bookingArrivalEvents.createdAt),
      desc(bookingArrivalEvents.seq),
    )
    .limit(1);
  return newest;
}

/**
 * The newest row on the seat's whole trail, earlier lives included: what a
 * queued tap's ordering is judged against. A later correction made before the
 * seat reopened still outranks a tap older than it.
 */
async function newestOnWholeTrail(
  tx: DbExecutor,
  booking: { id: string; tripId: string; arrivalTrailAfterSeq: number | null },
  shopId: string,
  newestThisLife: NewestArrival | undefined,
): Promise<NewestArrival | undefined> {
  if (booking.arrivalTrailAfterSeq === null) return newestThisLife;
  return newestArrivalEvent(tx, { ...booking, arrivalTrailAfterSeq: null }, shopId);
}

/**
 * Has this exact queued tap already been applied? A sync that succeeded and
 * whose response never reached the boat is retried, and without this the diver
 * would be checked in twice and the trail would say two people arrived.
 *
 * Shop-scoped, matching the unique index the device's `crypto.randomUUID()`
 * keys are stored under.
 */
async function appliedArrivalEventId(
  tx: DbExecutor,
  shopId: string,
  clientEventId: string,
): Promise<string | undefined> {
  const [existing] = await tx
    .select({ id: bookingArrivalEvents.id })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.clientEventId, clientEventId),
      ),
    )
    .limit(1);
  return existing?.id;
}

/**
 * The two orderings an offline arrival is subject to, shared by both writers
 * so the check-in half and the undo half cannot answer them differently.
 *
 * - **Newest wins.** A tap recorded before the statement already standing is
 *   refused. It is a plain timestamp comparison and it is deliberately strict
 *   (`>`, not `>=`), so a device's own batch of taps sharing one millisecond
 *   still applies in queue order.
 * - **A retraction is a compare-and-set.** An undo names the arrival it takes
 *   back, and applies only while that arrival is still the newest statement
 *   here (ADR 20260815-an-offline-retraction-names-its-target, reproduced at
 *   the counter). The timestamp comparison alone cannot do this job: a
 *   retraction is stamped at tap time, so one tapped now beats everything
 *   recorded before now — including a desk that checked the diver back in five
 *   minutes ago because they were standing there. Refusing is the safe
 *   direction: the diver stays checked in, which is a statement a human made
 *   about somebody they could see.
 *
 * An undo that names nothing keeps the old newest-wins-only behaviour, as roll
 * call's does at departure: an event with no `retractsClientEventId` was
 * queued by a build that predates the field, on a phone in a dry bag, and
 * refusing it would discard a correction a staffer really made. (Roll call
 * refuses one after a dive, where a `cleared` reaches back to another meeting
 * day, issue #3951; an arrival carries no missing-diver alarm.)
 */
function offlineArrivalRefusal(input: {
  newest: NewestArrival | undefined;
  occurredAt: Date;
  retractsClientEventId?: string;
}): "newer_event_exists" | typeof ARRIVAL_RETRACTION_SUPERSEDED | null {
  const { newest } = input;
  if (newest && newest.occurredAt > input.occurredAt) return "newer_event_exists";
  if (
    input.retractsClientEventId &&
    newest?.clientEventId?.toLowerCase() !== input.retractsClientEventId.toLowerCase()
  ) {
    return ARRIVAL_RETRACTION_SUPERSEDED;
  }
  return null;
}

/**
 * **A queued tap is about the seat and the morning the tablet saw** (issue
 * #3830). Two facts the device could not know when it tapped, both read from
 * the seat now:
 *
 * - The seat was claimed after the tablet saved its copy. A claim re-points a
 *   held seat at the claimant (`claimSeatRecord`), so the tap would put
 *   "checked in" on a person the desk never saw. The live path asks the same
 *   question of the trail (`seatSeenAtDesk`); a queue has no such trail yet.
 * - The departure no longer sails in the window the tap was made in
 *   (`arrivalsWindow` at the tap's own instant): it was moved to another day,
 *   and the tap says nothing about that morning.
 *
 * - The seat began a new life after the tablet saved its copy
 *   (`bookings.seat_reopened_at`): it was removed and restored, rebooked,
 *   moved away and back, its departure moved to another day, or a held seat
 *   was re-pointed at another person by an identity repoint or split. The tap
 *   was about the seat's earlier life, or about somebody else.
 *
 * A snapshot carries no person id by design (the 14-day dock allow-list), so
 * the seat's own stamps stand in for "the person the tablet saw".
 *
 * Both refuse as `snapshot_invalid`, the word the departure check beside it
 * already uses for "this copy was about something that has changed". Offline
 * only; the live path re-reads the roster.
 */
function offlineTapAboutAnotherSeatOrDay(
  booking: { claimedAt: Date | null; seatReopenedAt: Date | null; tripStartsAt: Date },
  input: { occurredAt?: Date; offlineSnapshotSavedAt?: Date },
): boolean {
  // `savedAt` is the tablet's clock, which the sync lets run up to the skew
  // ahead of ours: a copy counts as saved after a change only when it was
  // saved more than that after it, so a fast tablet cannot slip a tap from a
  // copy older than the change past this check. A slow one may see a fresh
  // tap refused, and the desk taps again live.
  for (const changedAt of [booking.claimedAt, booking.seatReopenedAt]) {
    if (
      changedAt &&
      (!input.offlineSnapshotSavedAt ||
        changedAt.getTime() > input.offlineSnapshotSavedAt.getTime() - OFFLINE_EVENT_SKEW_MS)
    ) {
      return true;
    }
  }
  // The sync schema requires the instant; a direct caller that omits it skips the window.
  if (!input.occurredAt) return false;
  const window = arrivalsWindow(input.occurredAt);
  return booking.tripStartsAt < window.from || booking.tripStartsAt > window.to;
}

/**
 * Record a counter check-in atomically. A successful check-in is not boarding:
 * the manifest still performs its own departure-time readiness gate. This
 * mutation only closes the arrival queue and leaves an activity trail.
 */
export async function checkInBooking(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    recordedByPersonId: string;
    now?: Date;
  } & ArrivalOfflineInput,
): Promise<CheckInOutcome> {
  const now = input.now ?? nowDate();
  const source = input.source ?? "live";
  // A device clock ahead of the server's (the bounds allow five minutes) must
  // not outrank a live tap made after it: the trail is read newest first, so
  // a stored instant is never later than the moment it reached us (#2702).
  const occurredAt = input.occurredAt && input.occurredAt < now ? input.occurredAt : now;
  return db.transaction(async (tx) => {
    // The counter actor is durably recorded in the check-in activity trail.
    const recordedBy = await requireActiveStaffId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    // The departure, then the seat (`lockSeatDeparture`, #2324): one joined
    // `for update` took both in the planner's order, booking first.
    const tripId = await lockSeatDeparture(tx, input.shopId, input.bookingId);
    if (!tripId) return { ok: false, reason: "not_found" };
    // A queued tap was about the departure the device was reading; on a seat
    // since moved it says nothing about the new one.
    if (input.expectedTripId && input.expectedTripId !== tripId) {
      return { ok: false, reason: input.source === "offline" ? "snapshot_invalid" : "not_found" };
    }
    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        arrivalTrailAfterSeq: bookings.arrivalTrailAfterSeq,
        claimedAt: bookings.claimedAt,
        seatReopenedAt: bookings.seatReopenedAt,
        tripStartsAt: trips.startsAt,
        tripId: trips.id,
        tripStatus: trips.status,
        personId: people.id,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripId),
        ),
      )
      .limit(1)
      .for("update", { of: [bookings, people] });
    if (!booking) return { ok: false, reason: "not_found" };
    // Asked before anything else this transaction could repeat: a retried sync
    // must not re-run readiness, re-stamp the trail, or tell the crew a second
    // person arrived.
    if (source === "offline" && input.clientEventId) {
      const applied = await appliedArrivalEventId(tx, input.shopId, input.clientEventId);
      if (applied) {
        return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
      }
    }
    // The trail is the only record of an arrival (issue #2702), so it is the
    // one asked whether this tap changes anything. Read under the seat's lock:
    // a second device greeting the same diver waits here and then finds them
    // already seen.
    const newest = await newestArrivalEvent(tx, booking, input.shopId);
    if (booking.status === "booked" && hasArrived(newest?.status)) {
      return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
    }
    if (booking.status !== "booked" || booking.tripStatus !== "scheduled") {
      return { ok: false, reason: "not_bookable" };
    }
    if (source === "offline") {
      if (
        offlineEventOutOfBounds({
          clientEventId: input.clientEventId,
          offlineSnapshotSavedAt: input.offlineSnapshotSavedAt,
          occurredAt: input.occurredAt ?? now,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      if (offlineTapAboutAnotherSeatOrDay(booking, input)) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const refusal = offlineArrivalRefusal({
        newest: await newestOnWholeTrail(tx, booking, input.shopId, newest),
        occurredAt,
      });
      // An arrival states something rather than taking something back, so the
      // only ordering it can fail is newest-wins; the compare-and-set belongs
      // to the undo.
      if (refusal) return { ok: false, reason: "newer_event_exists" };
    }

    // **Live readiness, re-read now, on both doors.** This is what an offline
    // queue buys nobody a way around: a diver whose card expired or whose
    // refund landed while the tablet was out of signal is refused here, hours
    // after the tap, exactly as they would have been at the desk.
    const readiness = await getBookingReadiness(tx as DbExecutor, input.shopId, booking.id);
    if (readiness?.status !== "ready") {
      return {
        ok: false,
        reason: "not_ready",
        blockers: readiness?.blockers,
        tripId: booking.tripId,
      };
    }

    // The seat word is not touched: arrival is not a seat status (issue
    // #2702). An arrived diver is no longer late (J3), so that statement
    // clears with the tap and an undo does not bring back a "running late"
    // from this morning.
    const [updated] = await tx
      .update(bookings)
      .set({ runningLateAt: null })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "booked")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_bookable" };

    // **The arrival itself**, and the only record of it: every reader of
    // "checked in" reads this trail (`seatCheckedIn`). It is also what makes an
    // offline queue possible at all: the two orderings above have nothing to
    // compare against unless every tap — live ones included — leaves a row here.
    await tx.insert(bookingArrivalEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: recordedBy,
      status: "arrived",
      source,
      clientEventId: source === "offline" ? (input.clientEventId ?? null) : null,
      offlineSnapshotSavedAt: source === "offline" ? (input.offlineSnapshotSavedAt ?? null) : null,
      occurredAt,
    });
    // One line, read twice (issues #1202, #1187, #2701): the trail's "checked
    // in", and the crew walking to the boat reading "Ada Lindqvist has checked
    // in." on the manifest's catch-up strip ("did anyone tell them?"). Inside
    // this transaction, so a check-in whose handoff line silently failed to
    // write — the failure D27 exists about — cannot commit. The subject is
    // what the strip names, live. `undoCheckInBooking` writes nothing — an undo
    // is not news, and the strip drops the line once the seat is not checked in.
    await recordActivityRow(tx, {
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      subjectPersonId: booking.personId,
      actorPersonId: recordedBy,
      code: "counter_check_in",
      params: { diver: booking.personName },
      occurredAt,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}

export type UndoCheckInOutcome =
  | { ok: true; bookingId: string; personName: string; duplicate?: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_checked_in"
        | "staff_not_found"
        | "newer_event_exists"
        | typeof ARRIVAL_RETRACTION_SUPERSEDED
        | "snapshot_invalid"
        /** Offline only: the rail has since recorded this diver aboard. */
        | "boarded";
    };

/**
 * Clear a counter check-in — the re-tap half of the queue's one-tap row
 * (design principle 7: a high-frequency toggle gets re-tap undo, never a
 * blocking confirm). The correction is its own activity-trail event, the same
 * rule roll call follows: the trail keeps both taps, never deletes one.
 *
 * This only reopens the arrival queue. It never touches the manifest — a
 * boarding recorded at roll call stands on its own record, exactly as a
 * check-in never implied boarding in the first place.
 */
export async function undoCheckInBooking(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    recordedByPersonId: string;
    now?: Date;
    /**
     * The arrival this undo takes back, by the `clientEventId` the device
     * minted for it — what makes an offline retraction a compare-and-set
     * rather than a blind newest-wins write. Absent on a live tap, where the
     * staffer is looking at the row.
     */
    retractsClientEventId?: string;
  } & ArrivalOfflineInput,
): Promise<UndoCheckInOutcome> {
  const now = input.now ?? nowDate();
  const source = input.source ?? "live";
  // A device clock ahead of the server's (the bounds allow five minutes) must
  // not outrank a live tap made after it: the trail is read newest first, so
  // a stored instant is never later than the moment it reached us (#2702).
  const occurredAt = input.occurredAt && input.occurredAt < now ? input.occurredAt : now;
  return db.transaction(async (tx) => {
    // The undo actor is durably recorded alongside the check-in reversal.
    const recordedBy = await requireActiveStaffId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    // The departure, then the seat (`lockSeatDeparture`, #2324): one joined
    // `for update` took both in the planner's order, booking first.
    const tripId = await lockSeatDeparture(tx, input.shopId, input.bookingId);
    if (!tripId) return { ok: false, reason: "not_found" };
    // A queued tap was about the departure the device was reading; on a seat
    // since moved it says nothing about the new one.
    if (input.expectedTripId && input.expectedTripId !== tripId) {
      return { ok: false, reason: input.source === "offline" ? "snapshot_invalid" : "not_found" };
    }
    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        arrivalTrailAfterSeq: bookings.arrivalTrailAfterSeq,
        claimedAt: bookings.claimedAt,
        seatReopenedAt: bookings.seatReopenedAt,
        tripStartsAt: trips.startsAt,
        tripId: trips.id,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          eq(bookings.tripId, tripId),
        ),
      )
      .limit(1)
      .for("update", { of: [bookings, people] });
    if (!booking) return { ok: false, reason: "not_found" };
    if (source === "offline" && input.clientEventId) {
      const applied = await appliedArrivalEventId(tx, input.shopId, input.clientEventId);
      if (applied) {
        return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
      }
    }
    // A released or cancelled seat is not checked in, whatever its trail
    // still says: the desk's later word about the seat outranks the sighting
    // it released, and an undo here would write a `cleared` row the restore
    // of that seat would then read.
    if (booking.status !== "booked") return { ok: false, reason: "not_checked_in" };
    const newest = await newestArrivalEvent(tx, booking, input.shopId);
    // A double-tap of the undo (two devices, a stale tab) finds the work
    // already done — same idempotence contract as checkInBooking. It sits
    // ahead of the compare-and-set deliberately: the device asked for this
    // seat to be off the arrival queue and it already is, so there is nothing
    // for a refusal to protect. The case the compare-and-set exists for lands
    // below it, on a seat that is checked in again.
    if (!hasArrived(newest?.status)) {
      return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
    }
    if (source === "offline") {
      if (
        offlineEventOutOfBounds({
          clientEventId: input.clientEventId,
          offlineSnapshotSavedAt: input.offlineSnapshotSavedAt,
          occurredAt: input.occurredAt ?? now,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      if (offlineTapAboutAnotherSeatOrDay(booking, input)) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const refusal = offlineArrivalRefusal({
        newest: await newestOnWholeTrail(tx, booking, input.shopId, newest),
        occurredAt,
        retractsClientEventId: input.retractsClientEventId,
      });
      if (refusal) return { ok: false, reason: refusal };
      // **Aboard outranks the desk.** A tablet that lost signal at 07:40 can
      // queue "this diver never turned up" and sync it at 11:00, by which time
      // the rail has recorded them onto the boat. Applied blindly that puts a
      // diver who is on a reef back on the counter's "still to come" list, and
      // somebody rings a phone in a dry bag.
      //
      // Same shape as the compare-and-set above it, and the same justification:
      // a statement a device made hours ago in ignorance may not overturn a
      // stronger, later one. Deliberately **offline only** — a staffer undoing
      // a live check-in is looking at the person, and the live counter keeps
      // that power exactly as it has it today.
      //
      // A read, never a write: this asks roll call a question and cannot record
      // anything there, so the invariant that no arrival path reaches
      // `roll_call_events` is untouched (ADR
      // 20260907-the-counter-survives-offline).
      if (
        (await departureRollCallForBooking(tx, input.shopId, booking.tripId, booking.id)) ===
        "boarded"
      ) {
        return { ok: false, reason: "boarded" };
      }
    }

    // The retraction is the `cleared` row alone; the seat word never said
    // "arrived", so there is nothing on `bookings` to put back (issue #2702).
    await tx.insert(bookingArrivalEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: recordedBy,
      status: "cleared",
      source,
      clientEventId: source === "offline" ? (input.clientEventId ?? null) : null,
      offlineSnapshotSavedAt: source === "offline" ? (input.offlineSnapshotSavedAt ?? null) : null,
      occurredAt,
    });
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      actorPersonId: recordedBy,
      code: "counter_check_in_undone",
      params: { diver: booking.personName },
      occurredAt,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}
