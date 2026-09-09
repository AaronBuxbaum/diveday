import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
} from "drizzle-orm";
import { ARRIVAL_RETRACTION_SUPERSEDED } from "@/lib/arrival";
import { isStaff } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { offlineEventOutOfBounds } from "@/lib/offline-events";
import { arrivalsWindow } from "@/lib/operational-window";
import { priorVisitStanding } from "@/lib/prior-visits";
import type { ReadinessResult } from "@/lib/readiness";
import { isUuid } from "@/lib/uuid";
import { loadActiveStaffRoles } from "./authz";
import type { AppDb, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { giftGiversByBooking } from "./gifts";
import { departureRollCallForBooking, listDepartureBoardedBookingIds } from "./manifests";
import { getBookingReadiness, listTripsReadiness } from "./readiness";
import {
  activityEvents,
  bookingArrivalEvents,
  bookings,
  people,
  priorVisits,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";

export type CheckInQueueRow = {
  bookingId: string;
  personId: string;
  personName: string;
  email: string | null;
  /**
   * For the guardian rule (`src/lib/guardian.ts`): a minor's paper release
   * names its co-signer, so the counter's own paper-signature form has to know
   * whether to ask (ADR 20260907-guardian-co-signature). Null when the shop
   * never asked — the rule fails open, as H-08's minimum-age gate does.
   */
  dateOfBirth: string | null;
  tripId: string;
  tripTitle: string;
  startsAt: Date;
  endsAt: Date;
  bookingStatus: "booked" | "checked_in";
  readiness: ReadinessResult;
  /**
   * The diver's latest departure roll-call record on the manifest is
   * "boarded". Check-in and boarding are two different questions — arrived
   * vs. aboard — and `checked_in` used to have exactly one reader in the app
   * (this queue itself never showed boarding). See `checkedIn` on
   * `ManifestDiverInput` for the manifest's half of the same fix (task 149,
   * UX persona lens 17).
   */
  boarded: boolean;
  /**
   * No **usable** emergency contact on this diver's record — the same test
   * Today's Contact rows apply (`missingEmergencyContactByTrip` in
   * `src/db/today.ts`): a name *and* a phone, because a name with no number
   * reads as "on file" and is unreachable in an incident.
   *
   * Never a boarding blocker. It is a nudge the counter can settle in the ten
   * seconds the diver is standing there, which is the one moment in the day
   * when asking costs nothing (ADR 20260827-clearwater-surface-language,
   * decision 9).
   */
  missingEmergencyContact: boolean;
  /**
   * **An unclaimed gift on the day** (ADR 20260908-one-hand, decision 6,
   * lever W): who gave this seat, when the person it was given to has not
   * claimed it yet.
   *
   * The counter is where that matters, because the diver may well be standing
   * there without ever having opened the link — the row is the shop's cue to
   * seat the giver's friend by name rather than hunt for a booking under an
   * address nobody has. Null for every ordinary seat, and null the moment the
   * gift is claimed: after that it is simply that diver's booking.
   *
   * Batched over the whole queue, never one query per row.
   */
  giftGiverName: string | null;
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
 * The counter queue is intentionally a bounded, day-of read: the arrivals lens
 * on the shared operational horizon (`src/lib/operational-window.ts`), never a
 * freestanding window of its own. A scanner that types a booking id into the
 * search box gets the same result as a name/email search, while the default
 * view stays small enough to use one-handed on a phone. Readiness always comes
 * from the shared service, never a second gate.
 */
export async function listCheckInQueue(
  db: AppDb,
  shopId: string,
  options: { query?: string; now?: Date } = {},
): Promise<CheckInQueueRow[]> {
  const now = options.now ?? nowDate();
  const arrivals = arrivalsWindow(now);
  const query = options.query?.trim() ?? "";
  const queryFilter = query
    ? or(
        ilike(people.fullName, `%${query}%`),
        ilike(people.email, `%${query}%`),
        isUuid(query) ? eq(bookings.id, query) : undefined,
      )
    : undefined;
  const rows = await db
    .select({
      bookingId: bookings.id,
      personId: people.id,
      personName: people.fullName,
      email: people.email,
      dateOfBirth: people.dateOfBirth,
      tripId: trips.id,
      tripTitle: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      bookingStatus: bookings.status,
      claimedAt: bookings.claimedAt,
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
        inArray(bookings.status, ["booked", "checked_in"]),
        gte(trips.startsAt, arrivals.from),
        lte(trips.startsAt, arrivals.to),
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
  const history = await queueVisitHistory(db, shopId, rows, arrivals.to);
  // Only the seats that are still unclaimed: a claimed gift is that diver's
  // own booking and the counter has nothing extra to do with it.
  const giftGivers = await giftGiversByBooking(
    db,
    shopId,
    rows.filter((row) => row.claimedAt === null).map((row) => row.bookingId),
  );

  return rows.map(({ emergencyContactName, emergencyContactPhone, claimedAt, ...row }) => ({
    ...row,
    giftGiverName: claimedAt === null ? (giftGivers.get(row.bookingId) ?? null) : null,
    bookingStatus: row.bookingStatus as "booked" | "checked_in",
    boarded: boardedBookingIds.has(row.bookingId),
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
          ne(bookings.status, "cancelled"),
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

export type WalkInTripOption = {
  tripId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  booked: number;
};

/**
 * Trips a counter walk-in can be added to — the same arrivals window
 * `listCheckInQueue` reads (`arrivalsWindow`), so "today's departures" means
 * the same thing on both halves of this surface.
 */
export async function listWalkInTrips(
  db: AppDb,
  shopId: string,
  now: Date = nowDate(),
): Promise<WalkInTripOption[]> {
  const arrivals = arrivalsWindow(now);
  return db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      capacity: trips.capacity,
      booked: count(bookings.id),
    })
    .from(trips)
    .leftJoin(bookings, and(eq(bookings.tripId, trips.id), ne(bookings.status, "cancelled")))
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        // A walk-in can only be seated on a departure that has not started.
        // The check-in queue deliberately includes its short look-back window;
        // reusing that lower bound here offered a boat already underway and
        // made the picker hand a valid-looking choice to a refusal.
        gt(trips.startsAt, new Date(now.getTime() - 60 * 60 * 1000)),
        lte(trips.startsAt, arrivals.to),
      ),
    )
    .groupBy(trips.id)
    .having(gt(trips.capacity, count(bookings.id)))
    .orderBy(asc(trips.startsAt));
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
 * The `people.id` of the staff member **behind the counter**, or `null` when
 * whoever is claiming to check this diver in is not this shop's live staff
 * right now.
 *
 * This used to be a hand-rolled `person_roles` join here, against a local copy
 * of `STAFF_ROLES` — `people.id` / `people.shopId` / `person_roles.role` and
 * nothing else. It catches what it was written for (a diver, or somebody
 * demoted out of every staff role) and misses the two cases
 * `loadActiveStaffRoles` exists for: a **deleted** person, because
 * `deleteDiver` sets `people.deleted_at` and leaves every role row where it is,
 * and a **disabled** account, because `setStaffAccountStatus` revokes sign-in
 * and leaves `person_roles` entirely intact — a suspended employee keeps every
 * role row they had. Both moved a booking to `checked_in` and signed the
 * activity trail with their name.
 *
 * `src/db/authz.ts` is the one place the rule lives; `loadActiveStaffRoles`
 * takes a `DbExecutor`, so it composes inside this transaction unchanged. Same
 * shape as `activeStaffRecorderId` in `src/db/manifests.ts`.
 */
async function activeStaffRecorderId(
  tx: DbExecutor,
  shopId: string,
  personId: string,
): Promise<string | null> {
  const roles = await loadActiveStaffRoles(tx, shopId, personId);
  // `loadActiveStaffRoles` has already proven the person is this shop's, alive,
  // and holds an active account; `isStaff` is the same `STAFF_ROLES` membership
  // the old join expressed as an `inArray`.
  return roles && isStaff(roles) ? personId : null;
}

/**
 * The newest arrival statement standing for one seat, or nothing.
 *
 * `desc(occurredAt), desc(createdAt), desc(seq)` — the same three keys
 * `recordRollCall` and `recordPreDepartureCheck` read their own trails back
 * by, and for the same reason: `occurred_at` ties constantly under a frozen
 * clock or a batched offline sync, so the last-appended row has to be the one
 * that wins or the device and the server order two taps differently.
 */
async function newestArrivalEvent(
  tx: DbExecutor,
  shopId: string,
  tripId: string,
  bookingId: string,
): Promise<{ occurredAt: Date; clientEventId: string | null } | undefined> {
  const [newest] = await tx
    .select({
      occurredAt: bookingArrivalEvents.occurredAt,
      clientEventId: bookingArrivalEvents.clientEventId,
    })
    .from(bookingArrivalEvents)
    .where(
      and(
        eq(bookingArrivalEvents.shopId, shopId),
        eq(bookingArrivalEvents.tripId, tripId),
        eq(bookingArrivalEvents.bookingId, bookingId),
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
 * An undo that names nothing keeps the old newest-wins-only behaviour, exactly
 * as roll call's does: an event with no `retractsClientEventId` was queued by a
 * build that predates the field, on a phone in a dry bag, and refusing it would
 * discard a correction a staffer really made.
 */
function offlineArrivalRefusal(input: {
  newest: { occurredAt: Date; clientEventId: string | null } | undefined;
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
  const occurredAt = input.occurredAt ?? now;
  return db.transaction(async (tx) => {
    const recordedBy = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: trips.id,
        tripStatus: trips.status,
        personId: people.id,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
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
    if (booking.status === "checked_in") {
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
          occurredAt,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const refusal = offlineArrivalRefusal({
        newest: await newestArrivalEvent(tx, input.shopId, booking.tripId, booking.id),
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

    const [updated] = await tx
      .update(bookings)
      .set({ status: "checked_in" })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "booked")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_bookable" };

    // The trail underneath the `bookings.status` projection just written, and
    // the thing that makes an offline queue possible at all: the two orderings
    // above have nothing to compare against unless every tap — live ones
    // included — leaves a row here.
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
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      actorPersonId: recordedBy,
      message: `${booking.personName} checked in at the counter`,
      occurredAt,
    });
    // The crew walking to the boat read this as "Ada Lindqvist has checked in."
    // on the manifest's catch-up strip (issues #1202, #1187 — "did anyone tell
    // them?"). Inside this transaction, beside the activity line it mirrors:
    // the two say the same fact to two different readers, and a check-in whose
    // handoff line silently failed to write is the failure D27 exists about.
    // `undoCheckInBooking` writes nothing — an undo is not news.
    await recordDeskEvent(tx, {
      shopId: input.shopId,
      tripId: booking.tripId,
      kind: "arrival",
      bookingId: booking.id,
      subjectPersonId: booking.personId,
      actorPersonId: recordedBy,
      occurredAt,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}

/**
 * What the counter tablet gets back. Two outcomes reach the screen and no
 * more — `ok`, or "see the desk" — because the tablet is operated by whoever
 * walks up to it, and a refusal that varied with *why* would answer questions
 * about a stranger's booking to anyone willing to type. The `reason` here is
 * for the server's own logs and the test suite; the surface collapses every
 * one of them into one sentence.
 */
export type KioskCheckInOutcome =
  | { ok: true; bookingId: string; personName: string; alreadyArrived: boolean }
  | { ok: false; reason: "not_found" | "not_bookable" | "not_ready" };

/**
 * **A diver checks themselves in at the counter tablet** (N-24).
 *
 * The second door onto the arrival queue, and deliberately a *separate
 * function* rather than a flag on `checkInBooking`: that one opens with
 * `activeStaffRecorderId`, whose whole job is to refuse anybody who is not this
 * shop's live staff right now, and weakening it for a kiosk would weaken it for
 * the desk. What the two share is everything that matters — the row lock, the
 * bookable check, the **live readiness re-read**, the `bookings.status`
 * projection, the append-only `booking_arrival_events` trail, the activity line
 * and the crew's desk event.
 *
 * **This records an arrival and can never record a boarding.** Arrival is the
 * desk's question — "are you here?" — and boarding is the rail's, performed by
 * a crew member with the diver in front of them at roll call. The two
 * vocabularies are kept apart at the table (`arrival_status` has no `boarded`
 * value at all) and in the code: nothing here touches `roll_call_events` or
 * anything the manifest reads, and `kiosk-check-in.test.ts` asserts that a
 * kiosk arrival leaves the departure's roll call exactly as it found it.
 *
 * Readiness is what turns "You're set" into "See the desk". A diver whose
 * waiver is unsigned, whose card has expired or whose payment has not landed is
 * refused here exactly as they would be at the desk — and refused *ashore*,
 * while there is still somebody to talk to, which is the whole reason the
 * counter exists.
 *
 * The arrival is recorded as the diver's own act: `recorded_by_person_id` is
 * the diver, and `display_token_id` names the tablet. No read mark is written,
 * because nobody at the desk has seen this yet — which is precisely the state
 * the crew's catch-up strip exists to show.
 */
export async function checkInAtKiosk(
  db: AppDb,
  input: { shopId: string; displayTokenId: string; bookingId: string; now?: Date },
): Promise<KioskCheckInOutcome> {
  const now = input.now ?? nowDate();
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
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
          isNull(people.deletedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!booking) return { ok: false, reason: "not_found" };

    // Already through: say so warmly rather than refusing. A diver who taps
    // twice, or who was checked in at the desk a minute ago, is asking the
    // same question they asked the first time and deserves the same answer.
    if (booking.status === "checked_in") {
      return {
        ok: true,
        bookingId: booking.id,
        personName: booking.personName,
        alreadyArrived: true,
      };
    }
    if (booking.status !== "booked" || booking.tripStatus !== "scheduled") {
      return { ok: false, reason: "not_bookable" };
    }

    const readiness = await getBookingReadiness(tx as DbExecutor, input.shopId, booking.id);
    if (readiness?.status !== "ready") return { ok: false, reason: "not_ready" };

    const [updated] = await tx
      .update(bookings)
      .set({ status: "checked_in" })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "booked")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_bookable" };

    await tx.insert(bookingArrivalEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      // The diver's own act, recorded as theirs. `display_token_id` is what
      // stops this reading as a staffer's tap on a shop where staff also dive.
      recordedByPersonId: booking.personId,
      displayTokenId: input.displayTokenId,
      status: "arrived",
      source: "live",
      occurredAt: now,
    });
    await tx.insert(activityEvents).values({
      shopId: input.shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      actorPersonId: booking.personId,
      message: `${booking.personName} checked in at the counter tablet`,
      occurredAt: now,
    });
    // The crew's catch-up strip, with **no actor** — so no read mark is moved
    // forward and the line stays unread. Nobody behind the desk has seen this;
    // that is the fact the strip is for.
    await recordDeskEvent(tx, {
      shopId: input.shopId,
      tripId: booking.tripId,
      kind: "arrival",
      bookingId: booking.id,
      subjectPersonId: booking.personId,
      occurredAt: now,
    });
    return {
      ok: true,
      bookingId: booking.id,
      personName: booking.personName,
      alreadyArrived: false,
    };
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
  const occurredAt = input.occurredAt ?? now;
  return db.transaction(async (tx) => {
    const recordedBy = await activeStaffRecorderId(tx, input.shopId, input.recordedByPersonId);
    if (!recordedBy) return { ok: false, reason: "staff_not_found" };

    const [booking] = await tx
      .select({
        id: bookings.id,
        status: bookings.status,
        tripId: trips.id,
        personName: people.fullName,
      })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
      .limit(1)
      .for("update");
    if (!booking) return { ok: false, reason: "not_found" };
    if (source === "offline" && input.clientEventId) {
      const applied = await appliedArrivalEventId(tx, input.shopId, input.clientEventId);
      if (applied) {
        return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
      }
    }
    // A double-tap of the undo (two devices, a stale tab) finds the work
    // already done — same idempotence contract as checkInBooking. It sits
    // ahead of the compare-and-set deliberately: the device asked for this
    // seat to be off the arrival queue and it already is, so there is nothing
    // for a refusal to protect. The case the compare-and-set exists for lands
    // below it, on a seat that is checked in again.
    if (booking.status === "booked") {
      return { ok: true, bookingId: booking.id, personName: booking.personName, duplicate: true };
    }
    if (booking.status !== "checked_in") return { ok: false, reason: "not_checked_in" };
    if (source === "offline") {
      if (
        offlineEventOutOfBounds({
          clientEventId: input.clientEventId,
          offlineSnapshotSavedAt: input.offlineSnapshotSavedAt,
          occurredAt,
          now: nowDate(),
        })
      ) {
        return { ok: false, reason: "snapshot_invalid" };
      }
      const refusal = offlineArrivalRefusal({
        newest: await newestArrivalEvent(tx, input.shopId, booking.tripId, booking.id),
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

    const [updated] = await tx
      .update(bookings)
      .set({ status: "booked" })
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, "checked_in")))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, reason: "not_checked_in" };

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
      message: `${booking.personName}'s counter check-in was undone`,
      occurredAt,
    });
    return { ok: true, bookingId: booking.id, personName: booking.personName };
  });
}
