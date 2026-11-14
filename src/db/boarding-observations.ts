import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { isStaff } from "@/lib/authz";
import {
  type BoardingObservationConflict,
  isBoardingObservationConflict,
  observationPrecheck,
  SEAT_WAITING_CONFLICTS,
} from "@/lib/boarding-observations";
import { nowDate } from "@/lib/clock";
import type { CourseAdmissionRefusal } from "@/lib/course-admission";
import { log } from "@/lib/log";
import { isDiver, seatRefusal } from "@/lib/participant-types";
import { hasReturned } from "@/lib/trips";
import { loadActiveStaffRoles } from "./authz";
import { courseSeatRefusal } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { boundLockWaits, isLockWaitRefusal } from "./lock-bounds";
import { publishManifestEvent } from "./manifest-events";
import {
  activityEvents,
  type BoardingObservation,
  boardingObservations,
  bookings,
  people,
  trips,
} from "./schema";
import { liveTrip } from "./trips-live";
import { heldSeatCounts, sellableCapacity } from "./trips-queries";

/**
 * **A diver seen at the dock after their seat was released** (issue #4474).
 *
 * The desk's "They're here" used to be one transaction that locked the
 * departure, counted the boat and either put the seat back or refused. A
 * refusal lost the observation, and the lock meant the tap could wait behind
 * any schedule write on that departure (a move, a sale, a crew edit) and time
 * out with nothing recorded. The observation is now two steps:
 *
 * 1. **Intake** ({@link recordBoardingObservation}): one short transaction that
 *    takes no departure, seat or schedule lock and writes one row, keyed by the
 *    tap's own `clientKey`. It commits whatever the boat looks like. A retry,
 *    a double tap or an offline replay of the same key writes nothing new.
 * 2. **Allocation** ({@link settleBoardingObservations}): under the departure's
 *    lock, every open observation on it is measured as a seat is measured
 *    (both capacity limits, the course gates) and either takes the seat back
 *    or stays open as a `conflict` with its reason. Run at once after intake
 *    with a short lock wait, again after the response, and by the shop tick
 *    ({@link settleOpenBoardingObservations}) so a crash between the steps
 *    leaves a pending row the next pass applies.
 *
 * While open the observation counts as a held seat (`seatAwaitedAtDock`), so
 * nothing else can take the freed seat in the meantime, and the conflict is
 * read on the departure and on the board ({@link openBoardingObservationsByTrip}).
 */

export type RecordObservationOutcome =
  | {
      ok: true;
      observationId: string;
      tripId: string;
      bookingId: string;
      /** The same tap, or another staffer's for the same seat, was already recorded. */
      replay: boolean;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "staff_not_found"
        /** The seat is not released: nothing to observe back. */
        | "not_marked"
        /** This key was already spent on another seat. */
        | "key_reused";
    };

export async function recordBoardingObservation(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    /** The departure the desk is working; a seat elsewhere is not this desk's. Any, when omitted. */
    tripId?: string;
    recordedByPersonId: string;
    /** The tap's own key; a fresh one (a tap nobody will retry) when omitted. */
    clientKey?: string;
  },
): Promise<RecordObservationOutcome> {
  const clientKey = input.clientKey ?? randomUUID();
  return db.transaction(async (tx): Promise<RecordObservationOutcome> => {
    // Bounded like every other write, though this one takes no row lock of
    // its own and references no row a schedule writer locks.
    await boundLockWaits(tx);
    const replayed = await observationByKey(tx, input.shopId, clientKey);
    if (replayed) return replayOf(replayed, input);

    const roles = await loadActiveStaffRoles(tx, input.shopId, input.recordedByPersonId);
    if (!roles || !isStaff(roles)) return { ok: false, reason: "staff_not_found" };

    // Read, never locked: a move or a sale may hold this seat `FOR UPDATE`
    // right now, and the observation must not wait for it. The allocation
    // reads the seat again under the departure's lock.
    const [seat] = await tx
      .select({ id: bookings.id, tripId: bookings.tripId, status: bookings.status })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(
        and(
          eq(bookings.id, input.bookingId),
          eq(bookings.shopId, input.shopId),
          input.tripId ? eq(bookings.tripId, input.tripId) : undefined,
          eq(people.shopId, input.shopId),
          isNull(people.anonymizedAt),
        ),
      )
      .limit(1);
    if (!seat) return { ok: false, reason: "not_found" };
    if (seat.status !== "no_show") return { ok: false, reason: "not_marked" };
    // Another staffer's tap for this seat is already open: this one joins it
    // without touching the index entry an allocation may be rewriting.
    const joined = await openObservationFor(tx, input.shopId, seat.id);
    if (joined) {
      return {
        ok: true,
        observationId: joined.id,
        tripId: seat.tripId,
        bookingId: seat.id,
        replay: true,
      };
    }

    const [inserted] = await tx
      .insert(boardingObservations)
      .values({
        shopId: input.shopId,
        tripId: seat.tripId,
        bookingId: seat.id,
        clientKey,
        recordedByPersonId: input.recordedByPersonId,
      })
      .onConflictDoNothing()
      .returning({ id: boardingObservations.id });
    if (inserted) {
      return {
        ok: true,
        observationId: inserted.id,
        tripId: seat.tripId,
        bookingId: seat.id,
        replay: false,
      };
    }
    // Either the key landed in a concurrent transaction, or another tap for
    // this seat is already open: both are this observation, recorded.
    const raced = await observationByKey(tx, input.shopId, clientKey);
    if (raced) return replayOf(raced, input);
    const open = await openObservationFor(tx, input.shopId, seat.id);
    if (!open) throw new Error("boarding observation insert skipped with no row to join");
    return {
      ok: true,
      observationId: open.id,
      tripId: seat.tripId,
      bookingId: seat.id,
      replay: true,
    };
  });
}

async function openObservationFor(tx: DbExecutor, shopId: string, bookingId: string) {
  const [row] = await tx
    .select({ id: boardingObservations.id })
    .from(boardingObservations)
    .where(
      and(
        eq(boardingObservations.shopId, shopId),
        eq(boardingObservations.bookingId, bookingId),
        inArray(boardingObservations.state, ["pending", "conflict"]),
      ),
    )
    .limit(1);
  return row;
}

async function observationByKey(tx: DbExecutor, shopId: string, clientKey: string) {
  const [row] = await tx
    .select({
      id: boardingObservations.id,
      tripId: boardingObservations.tripId,
      bookingId: boardingObservations.bookingId,
    })
    .from(boardingObservations)
    .where(
      and(eq(boardingObservations.shopId, shopId), eq(boardingObservations.clientKey, clientKey)),
    )
    .limit(1);
  return row;
}

function replayOf(
  row: { id: string; tripId: string; bookingId: string },
  input: { bookingId: string },
): RecordObservationOutcome {
  // A key names one tap about one seat; the same key about another seat is a
  // client bug or a forged replay, and neither may move a seat.
  if (row.bookingId !== input.bookingId) return { ok: false, reason: "key_reused" };
  return {
    ok: true,
    observationId: row.id,
    tripId: row.tripId,
    bookingId: row.bookingId,
    replay: true,
  };
}

/** Where one observation stands after an allocation pass. */
export type SettledObservation = {
  observationId: string;
  bookingId: string;
  state: "applied" | "conflict";
  conflict: BoardingObservationConflict | null;
};

export type SettleOutcome =
  | { ok: true; settled: SettledObservation[] }
  /** The departure was locked by another writer past the wait; every row stays pending. */
  | { ok: false; reason: "busy" };

/**
 * **Allocate every open observation on one departure**, under its lock.
 *
 * The departure row is locked `FOR NO KEY UPDATE` first (`lockSeatDeparture`'s
 * order: departure, then seat), then each open observation is locked with
 * `SKIP LOCKED` so two passes never settle one row twice. Each is measured
 * against `heldSeatCounts`, which already counts it, so its own place is taken
 * off before the boat is measured.
 *
 * `wait: "brief"` is the inline attempt right after intake: it gives up after
 * a second rather than hold a staffer's tap, and the row stays pending for the
 * retry after the response and the shop tick. Settling is idempotent: a row
 * already applied is never touched, and a seat already held again settles as
 * applied with nothing written.
 */
export async function settleBoardingObservations(
  db: AppDb,
  input: { shopId: string; tripId: string; wait?: "brief" | "bounded"; now?: Date },
): Promise<SettleOutcome> {
  const now = input.now ?? nowDate();
  let outcome: SettleOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<SettleOutcome> => {
      if (input.wait === "brief") {
        await tx.execute(sql.raw("set local lock_timeout = '1s'"));
      } else {
        await boundLockWaits(tx);
      }
      const [trip] = await tx
        .select()
        .from(trips)
        // diveday:allow-deleted-trips: a lock first; a deleted departure is read below as cancelled.
        .where(and(eq(trips.id, input.tripId), eq(trips.shopId, input.shopId)))
        .limit(1)
        .for("no key update");
      const open = await tx
        .select()
        .from(boardingObservations)
        .where(
          and(
            eq(boardingObservations.shopId, input.shopId),
            eq(boardingObservations.tripId, input.tripId),
            inArray(boardingObservations.state, ["pending", "conflict"]),
          ),
        )
        // diveday:allow-time-id-order: the allocation's own turn order, never shown; the earliest sighting gets the seat first.
        .orderBy(asc(boardingObservations.observedAt), asc(boardingObservations.id))
        .for("update", { skipLocked: true });
      const settled: SettledObservation[] = [];
      for (const observation of open) {
        settled.push(await settleOne(tx, observation, trip ?? null, now));
      }
      return { ok: true, settled };
    });
  } catch (error) {
    if (isLockWaitRefusal(error)) {
      log("boarding_observation.settle_deferred", "info", { tripId: input.tripId });
      return { ok: false, reason: "busy" };
    }
    throw error;
  }
  if (outcome.ok && outcome.settled.some((row) => row.state === "applied")) {
    await publishManifestEvent(db, input.shopId, input.tripId);
  }
  return outcome;
}

async function settleOne(
  tx: DbExecutor,
  observation: typeof boardingObservations.$inferSelect,
  trip: typeof trips.$inferSelect | null,
  now: Date,
): Promise<SettledObservation> {
  const [seat] = await tx
    .select({
      id: bookings.id,
      tripId: bookings.tripId,
      status: bookings.status,
      participantType: bookings.participantType,
      turnedAwayAt: bookings.turnedAwayAt,
      personId: bookings.personId,
      anonymizedAt: people.anonymizedAt,
      personName: people.fullName,
    })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.id, observation.bookingId), eq(bookings.shopId, observation.shopId)))
    .limit(1)
    .for("update", { of: bookings });
  const precheck = observationPrecheck({
    observedTripId: observation.tripId,
    seat: seat ?? null,
    trip: trip && trip.deletedAt === null ? { status: trip.status, startsAt: trip.startsAt } : null,
    now,
  });
  const done = (state: "applied" | "conflict", conflict: BoardingObservationConflict | null) => ({
    observationId: observation.id,
    bookingId: observation.bookingId,
    state,
    conflict,
  });
  if (precheck.kind === "applied") {
    await markApplied(tx, observation.id, now);
    return done("applied", null);
  }
  if (precheck.kind === "conflict") {
    await markConflict(tx, observation, precheck.code, now, null);
    return done("conflict", precheck.code);
  }
  if (!seat || !trip) throw new Error("observation precheck counted a missing seat or departure");

  // Counted under the departure lock. This observation already counts as a
  // held seat (`seatAwaitedAtDock`), so its own place comes off first: the
  // question is whether the boat has room for it among everyone else.
  const held = await heldSeatCounts(tx, observation.shopId, trip.id);
  const others = {
    aboard: Math.max(0, held.aboard - 1),
    divers: Math.max(0, held.divers - (isDiver(seat.participantType) ? 1 : 0)),
  };
  const capacity = await sellableCapacity(tx, trip);
  const full = seatRefusal(seat.participantType, { ...trip, capacity }, others);
  const courseRefusal: CourseAdmissionRefusal | null = full
    ? null
    : await courseSeatRefusal(tx, {
        trip,
        actor: "staff",
        personId: seat.personId,
        student: isDiver(seat.participantType),
        studentsHeld: others.divers,
      });
  const refusal = full ?? courseRefusal;
  if (refusal) {
    await markConflict(tx, observation, refusal, now, {
      diver: seat.personName,
      reason: refusal,
    });
    return done("conflict", refusal);
  }

  // The seat is held again, exactly as the desk's undo always put it back:
  // whether the desk saw the diver is the arrival trail's, which the release
  // left standing (issues #1838, #2702), and boarding re-gates readiness at the
  // rail (`recordRollCall`).
  const [updated] = await tx
    .update(bookings)
    .set({ status: "booked", turnedAwayReason: null, turnedAwayAt: null })
    .where(and(eq(bookings.id, seat.id), eq(bookings.status, "no_show")))
    .returning({ id: bookings.id });
  await markApplied(tx, observation.id, now);
  if (updated) {
    const actor = await personName(tx, observation.shopId, observation.recordedByPersonId);
    await tx.insert(activityEvents).values({
      shopId: observation.shopId,
      tripId: trip.id,
      bookingId: seat.id,
      actorPersonId: observation.recordedByPersonId,
      code: "booking_no_show_undone",
      params: { actor, diver: seat.personName },
      occurredAt: now,
    });
  }
  return done("applied", null);
}

async function markApplied(tx: DbExecutor, observationId: string, now: Date) {
  await tx
    .update(boardingObservations)
    .set({ state: "applied", conflictCode: null, settledAt: now })
    .where(
      and(
        eq(boardingObservations.id, observationId),
        inArray(boardingObservations.state, ["pending", "conflict"]),
      ),
    );
}

/**
 * Open with a reason. The trail gets one "could not put back" line the first
 * time a seat-waiting reason is reached, not on every pass that finds the boat
 * still full.
 */
async function markConflict(
  tx: DbExecutor,
  observation: typeof boardingObservations.$inferSelect,
  code: BoardingObservationConflict,
  now: Date,
  trail: { diver: string; reason: (typeof SEAT_WAITING_CONFLICTS)[number] } | null,
) {
  if (observation.state === "conflict" && observation.conflictCode === code) return;
  await tx
    .update(boardingObservations)
    .set({ state: "conflict", conflictCode: code, settledAt: now })
    .where(
      and(
        eq(boardingObservations.id, observation.id),
        inArray(boardingObservations.state, ["pending", "conflict"]),
      ),
    );
  if (!trail) return;
  const actor = await personName(tx, observation.shopId, observation.recordedByPersonId);
  await tx.insert(activityEvents).values({
    shopId: observation.shopId,
    tripId: observation.tripId,
    bookingId: observation.bookingId,
    actorPersonId: observation.recordedByPersonId,
    code: "booking_no_show_undo_refused",
    params: { actor, diver: trail.diver, reason: trail.reason },
    occurredAt: now,
  });
}

async function personName(tx: DbExecutor, shopId: string, personId: string): Promise<string> {
  const [row] = await tx
    .select({ name: people.fullName })
    .from(people)
    // diveday:allow-deleted-people: the recorder named on the trail line.
    .where(and(eq(people.id, personId), eq(people.shopId, shopId)))
    .limit(1);
  return row?.name ?? "";
}

/**
 * **A staffer says the observation no longer stands**: the diver went home,
 * was moved by hand, or the tap was a mistake. Open rows only, scoped to the
 * shop and the departure, and recorded with who said so. The seat stays
 * released and stops counting.
 */
export async function dismissBoardingObservation(
  db: AppDb,
  input: { shopId: string; tripId: string; observationId: string; actorPersonId: string },
): Promise<boolean> {
  const roles = await loadActiveStaffRoles(db, input.shopId, input.actorPersonId);
  if (!roles || !isStaff(roles)) return false;
  const rows = await db
    .update(boardingObservations)
    .set({
      state: "dismissed",
      conflictCode: null,
      settledAt: nowDate(),
      dismissedByPersonId: input.actorPersonId,
    })
    .where(
      and(
        eq(boardingObservations.id, input.observationId),
        eq(boardingObservations.shopId, input.shopId),
        eq(boardingObservations.tripId, input.tripId),
        inArray(boardingObservations.state, ["pending", "conflict"]),
      ),
    )
    .returning({ id: boardingObservations.id });
  return rows.length > 0;
}

/** One open observation, as the departure and the board read it. */
export type OpenBoardingObservation = {
  id: string;
  bookingId: string;
  personName: string;
  state: "pending" | "conflict";
  conflict: BoardingObservationConflict | null;
  observedAt: Date;
};

/**
 * Every open observation on these departures, oldest first: the persistent
 * record of a diver seen at the dock whose seat has not come back. Read, not
 * derived: the row stays until it is applied or dismissed, so no later edit can
 * make it disappear.
 */
export async function openBoardingObservationsByTrip(
  db: DbExecutor,
  shopId: string,
  tripIds: readonly string[],
): Promise<Map<string, OpenBoardingObservation[]>> {
  const byTrip = new Map<string, OpenBoardingObservation[]>();
  if (tripIds.length === 0) return byTrip;
  const rows = await db
    .select({
      id: boardingObservations.id,
      tripId: boardingObservations.tripId,
      bookingId: boardingObservations.bookingId,
      state: boardingObservations.state,
      conflictCode: boardingObservations.conflictCode,
      observedAt: boardingObservations.observedAt,
      personName: people.fullName,
    })
    .from(boardingObservations)
    .innerJoin(
      bookings,
      and(
        eq(bookings.id, boardingObservations.bookingId),
        eq(bookings.shopId, boardingObservations.shopId),
      ),
    )
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(
      and(
        eq(boardingObservations.shopId, shopId),
        inArray(boardingObservations.tripId, [...tripIds]),
        inArray(boardingObservations.state, ["pending", "conflict"]),
      ),
    )
    .orderBy(
      asc(boardingObservations.observedAt),
      asc(people.fullName),
      asc(boardingObservations.id),
    );
  for (const row of rows) {
    const list = byTrip.get(row.tripId) ?? [];
    list.push({
      id: row.id,
      bookingId: row.bookingId,
      personName: row.personName,
      state: row.state === "conflict" ? "conflict" : "pending",
      conflict: isBoardingObservationConflict(row.conflictCode) ? row.conflictCode : null,
      observedAt: row.observedAt,
    });
    byTrip.set(row.tripId, list);
  }
  return byTrip;
}

/**
 * **The crash and busy backstop** (shop tick): every departure with a pending
 * observation, or one waiting for a seat, that is not home yet is settled
 * again. A pending row is one whose inline and after-response allocations
 * never ran or found the departure busy; a seat-waiting conflict takes the
 * next seat that opened since. Bounded per pass; each departure is its own
 * transaction, so one busy boat never holds the rest.
 */
export async function settleOpenBoardingObservations(
  db: AppDb,
  input: { now?: Date; limit?: number } = {},
): Promise<{ departures: number; applied: number; busy: number }> {
  const now = input.now ?? nowDate();
  const rows = await db
    .selectDistinct({
      shopId: boardingObservations.shopId,
      tripId: boardingObservations.tripId,
      endsAt: trips.endsAt,
    })
    .from(boardingObservations)
    .innerJoin(
      trips,
      and(eq(trips.id, boardingObservations.tripId), eq(trips.shopId, boardingObservations.shopId)),
    )
    .where(
      and(
        liveTrip(),
        or(
          eq(boardingObservations.state, "pending"),
          and(
            eq(boardingObservations.state, "conflict"),
            inArray(boardingObservations.conflictCode, [...SEAT_WAITING_CONFLICTS]),
          ),
        ),
      ),
    )
    // Newest departures first, so boats already home (skipped below) never
    // crowd a running one out of the pass.
    .orderBy(desc(trips.endsAt))
    .limit(input.limit ?? 200);
  let applied = 0;
  let busy = 0;
  let departures = 0;
  for (const row of rows) {
    // A boat already home has nobody left to put back on it; its open rows
    // stay as the record until somebody dismisses them.
    if (hasReturned(row.endsAt, now)) continue;
    departures += 1;
    const outcome = await settleBoardingObservations(db, {
      shopId: row.shopId,
      tripId: row.tripId,
      now,
    });
    if (!outcome.ok) busy += 1;
    else applied += outcome.settled.filter((item) => item.state === "applied").length;
  }
  return { departures, applied, busy };
}

/** Where one observation stands now, for a tap whose own pass did not reach it. */
export async function observationStanding(
  db: DbExecutor,
  shopId: string,
  observationId: string,
): Promise<{
  state: BoardingObservation["state"];
  conflict: BoardingObservationConflict | null;
} | null> {
  const [row] = await db
    .select({ state: boardingObservations.state, conflictCode: boardingObservations.conflictCode })
    .from(boardingObservations)
    .where(and(eq(boardingObservations.id, observationId), eq(boardingObservations.shopId, shopId)))
    .limit(1);
  if (!row) return null;
  return {
    state: row.state,
    conflict: isBoardingObservationConflict(row.conflictCode) ? row.conflictCode : null,
  };
}
