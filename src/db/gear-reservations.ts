/**
 * Gear: holding a unit for a seat or a counter rental — reserve, check out,
 * return, release and re-window. Imported through the `./gear` barrel.
 */
import { and, asc, count, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { type CalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  type GearItemKind,
  type GearReturnOutcome,
  gearKindIsLifeSupport,
  gearKindIsOnePerDiver,
  gearServiceState,
  type ReservationWindow,
} from "@/lib/gear";
import type { AppDb, DbExecutor } from "./client";
import { recordDeskEvent } from "./desk-events";
import { openServiceConcerns } from "./gear-availability";
import { setGearItemStatus } from "./gear-items";
import { latestServiceClocks } from "./gear-service";
import { liveGearItem, openGearReservation, optional } from "./gear-shared";
import { violatesExclusionConstraint } from "./query-helpers";
import { bookings, type GearReservation, gearItems, gearReservations } from "./schema";

export type ReserveGearUnitOutcome =
  | { ok: true; reservation: GearReservation }
  | {
      ok: false;
      reason:
        | "not_found"
        | "booking_not_found"
        | "invalid_window"
        | "unit_out_of_service"
        | "unit_unavailable"
        /** The booking already holds an open unit of a one-per-diver kind. */
        | "already_holds_kind"
        /** The seat is held: nobody's gear until the desk confirms who it is. */
        | "identity_held"
        /** Proposed: the unit has a lapsed service clock or an open concern. */
        | "needs_care"
        /** Hand-picked life support that needs care, not yet "Assign anyway". */
        | "needs_care_confirm";
    };

/**
 * How the pick was made, for the screen asked **inside** the reservation's
 * transaction (issue #2215). `proposed`: the row's proposal rather than a unit
 * a person chose. `assignAnyway`: the person was told a hand-picked
 * life-support unit needs care and assigned it all the same.
 */
export type GearPickScreen = { proposed: boolean; assignAnyway?: boolean };

/**
 * Assign one unit to one booking for an inclusive date window. The
 * double-booking refusal is the database's own: the `gear_reservations_no_overlap`
 * exclusion constraint decides, so two staff racing each other get one
 * reservation and one worded refusal — never two winners
 * (ADR 20260815-minimal-gear-register).
 *
 * `tripId`, when given, pins the booking to that departure: the prep action
 * derives the window from the trip, so a stale tab pairing one trip's dates
 * with another trip's booking must read as no booking at all rather than a
 * reservation on the wrong days (security review, 2026-08-20).
 *
 * `screen` is the Gear tab's pick screen, held under a lock until the write
 * (issue #2215). The booking row is locked `for update`, so two picks for one
 * diver serialize on it, and under that lock the write is refused when:
 * - the seat is held (`identity_held`): its gear is the matched person's
 *   until the desk confirms who it is;
 * - the booking already holds an open unit of a kind a diver takes one of
 *   (`already_holds_kind`; `gearKindIsOnePerDiver`, so a second tank is fine);
 * - the unit has a lapsed service clock or an open concern, read on the
 *   window's last day: a proposed pick is refused (`needs_care`), a hand pick
 *   of life support asks first (`needs_care_confirm`) unless `assignAnyway`.
 * Two tablets assigning BCD #3 and BCD #4 to one diver at the same instant get
 * one reservation and one refusal. The screen never asks whether the unit is
 * free: the exclusion constraint stays the register's only answer to that
 * (ADR 20260815-minimal-gear-register).
 */
export async function reserveGearUnit(
  db: AppDb,
  input: {
    shopId: string;
    gearItemId: string;
    bookingId: string;
    reservedFrom: string;
    reservedUntil: string;
    tripId?: string;
    screen: GearPickScreen;
  },
): Promise<ReserveGearUnitOutcome> {
  const reservedFrom = input.reservedFrom.trim();
  const reservedUntil = input.reservedUntil.trim();
  if (
    !isValidCalendarDate(reservedFrom) ||
    !isValidCalendarDate(reservedUntil) ||
    reservedUntil < reservedFrom
  ) {
    return { ok: false, reason: "invalid_window" };
  }

  try {
    return await db.transaction(async (tx) => {
      // The unit is read shop-scoped first, so the lock below is only ever
      // taken on a unit this shop owns (security review of issue #2215).
      const [item] = await tx
        .select({ id: gearItems.id, kind: gearItems.kind, status: gearItems.status })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.id, input.gearItemId),
            eq(gearItems.shopId, input.shopId),
            liveGearItem(),
          ),
        )
        .limit(1);
      if (!item) return { ok: false, reason: "not_found" } as const;
      if (item.status !== "in_service")
        return { ok: false, reason: "unit_out_of_service" } as const;

      // Serialize same-unit writers before the write. Two concurrent
      // inserts both add their tuple and then each waits on the *other's*
      // uncommitted tuple to decide the EXCLUDE check — Postgres breaks that
      // cycle by killing one with a deadlock (40P01) instead of the worded
      // refusal (seen on CI's real-Postgres job, 2026-08-20). Behind this
      // transaction-scoped advisory lock the second writer waits until the
      // first commits, so the constraint only ever judges committed rows and
      // the loser reads back 23P01 → unit_unavailable, as designed. A
      // hashtext collision between two units merely serializes unrelated
      // reservations for a moment — never a wrong outcome.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('gear_reservations'), hashtext(${item.id}))`,
      );

      // A cancelled booking holds nothing: its seat is gone, and a unit
      // reserved against it hangs on the wall as "spoken for" for a diver who
      // is not coming (dive-domain review of the Gear tab's proposals).
      const [booking] = await tx
        .select({
          id: bookings.id,
          tripId: bookings.tripId,
          personId: bookings.personId,
          identityUnconfirmedAt: bookings.identityUnconfirmedAt,
        })
        .from(bookings)
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.shopId, input.shopId),
            ne(bookings.status, "cancelled"),
            input.tripId ? eq(bookings.tripId, input.tripId) : undefined,
          ),
        )
        .limit(1)
        // The lock two picks for one diver meet at: the second waits here
        // until the first commits, then reads its reservation below.
        .for("update");
      if (!booking) return { ok: false, reason: "booking_not_found" } as const;
      if (booking.identityUnconfirmedAt) return { ok: false, reason: "identity_held" } as const;

      const refusal = await screenPickUnderLock(tx, {
        shopId: input.shopId,
        bookingId: booking.id,
        unit: { id: item.id, kind: item.kind },
        careDay: reservedUntil,
        screen: input.screen,
      });
      if (refusal) return { ok: false, reason: refusal } as const;

      const [reservation] = await tx
        .insert(gearReservations)
        .values({
          shopId: input.shopId,
          gearItemId: input.gearItemId,
          bookingId: input.bookingId,
          reservedFrom,
          reservedUntil,
        })
        .returning();
      if (!reservation) return { ok: false, reason: "unit_unavailable" } as const;
      // "Ben Okafor has different gear now." on the manifest's catch-up strip
      // — one of the four arrival facts #1187 names. **Which unit is
      // deliberately not in the event**: the strip says the fact, the prep page
      // says the detail, and a size on a boarding list is a detail nobody at
      // the rail is acting on.
      await recordDeskEvent(tx, {
        shopId: input.shopId,
        tripId: booking.tripId,
        kind: "gear_changed",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
      });
      return { ok: true, reservation } as const;
    });
  } catch (error) {
    if (violatesExclusionConstraint(error, "gear_reservations_no_overlap")) {
      return { ok: false, reason: "unit_unavailable" };
    }
    throw error;
  }
}

/**
 * The pick screen's questions, asked under the booking's row lock
 * (`reserveGearUnit`): does this booking already hold an open unit of a
 * one-per-diver kind, and does the unit need care on `careDay`, the window's
 * last day. Null keeps the pick.
 */
async function screenPickUnderLock(
  tx: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    unit: { id: string; kind: GearItemKind };
    careDay: CalendarDate;
    screen: GearPickScreen;
  },
): Promise<"already_holds_kind" | "needs_care" | "needs_care_confirm" | null> {
  if (gearKindIsOnePerDiver(input.unit.kind)) {
    const [held] = await tx
      .select({ id: gearReservations.id })
      .from(gearReservations)
      .innerJoin(
        gearItems,
        and(eq(gearItems.id, gearReservations.gearItemId), eq(gearItems.shopId, input.shopId)),
      )
      .where(
        and(
          eq(gearReservations.shopId, input.shopId),
          eq(gearReservations.bookingId, input.bookingId),
          openGearReservation(),
          eq(gearItems.kind, input.unit.kind),
          liveGearItem(),
        ),
      )
      .limit(1);
    if (held) return "already_holds_kind";
  }
  const asks = input.screen.proposed
    ? "needs_care"
    : gearKindIsLifeSupport(input.unit.kind) && !input.screen.assignAnyway
      ? "needs_care_confirm"
      : null;
  if (!asks) return null;

  // One after the other: a transaction is one connection.
  const clocks = await latestServiceClocks(tx, input.shopId, [input.unit.id]);
  const concerns = await openServiceConcerns(tx, input.shopId, [input.unit]);
  const lapsed =
    gearServiceState(clocks.get(input.unit.id) ?? [], input.careDay).state === "overdue";
  return lapsed || concerns.has(input.unit.id) ? asks : null;
}

export type GearReservationActionOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "already_returned" | "already_checked_out" | "concern_needs_words";
    };

/**
 * Record the handover — the unit physically left the counter. Conditional on
 * the stamp being empty: `checked_out_at` is the record of *when* it left,
 * and a double-tapped button must not quietly rewrite it (security review,
 * 2026-08-20).
 */
export async function checkOutGearReservation(
  db: AppDb,
  input: { shopId: string; reservationId: string },
): Promise<GearReservationActionOutcome> {
  const [updated] = await db
    .update(gearReservations)
    .set({ checkedOutAt: nowDate() })
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        openGearReservation(),
        isNull(gearReservations.checkedOutAt),
      ),
    )
    .returning({ id: gearReservations.id });
  if (updated) return { ok: true };
  const existing = await reservationStamps(db, input);
  if (!existing) return { ok: false, reason: "not_found" };
  return { ok: false, reason: existing.returnedAt ? "already_returned" : "already_checked_out" };
}

/**
 * Close the reservation: the unit is home, the window frees immediately.
 *
 * **The outcome is optional and its absence means "nobody said"** (issue
 * #1186). Two callers close a reservation without asking anyone — a cancelled
 * booking letting go of what it never collected, and the unit page's own quick
 * return — and defaulting those to `all_good` would put a reassuring answer on
 * a set nobody looked at, which is exactly what would make the other two
 * outcomes not worth reading.
 *
 * **A service concern must carry words.** A flag with no note is something a
 * technician cannot act on, and it is the whole of what "only exceptions open
 * additional detail" means: the fast path stays one tap, and the slow one earns
 * its extra field.
 */
export async function returnGearReservation(
  db: AppDb,
  input: {
    shopId: string;
    reservationId: string;
    note?: string;
    outcome?: GearReturnOutcome;
  },
): Promise<GearReservationActionOutcome> {
  const note = optional(input.note);
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  const [updated] = await db
    .update(gearReservations)
    .set({ returnedAt: nowDate(), returnNote: note, returnOutcome: input.outcome ?? null })
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        openGearReservation(),
      ),
    )
    .returning({ id: gearReservations.id });
  if (updated) return { ok: true };
  return {
    ok: false,
    reason: (await reservationStamps(db, input)) ? "already_returned" : "not_found",
  };
}

/**
 * **Hand a whole rental set over in one act** (issue #1185, delight report
 * D25) — the mirror of {@link returnTripGearSet}, and written to look like it.
 *
 * A set is one diver's units on one departure, which is what a counter
 * actually hands across: the diver arrives, takes their armful, and the
 * hand-over is one deliberate act rather than one tap per piece.
 *
 * Conditional on the stamp being empty for the reason
 * {@link checkOutGearReservation} states: `checked_out_at` is the record of
 * *when* the unit left, and a second tap must not rewrite it. A unit already
 * out is therefore left exactly as it was, and a set with nothing left to hand
 * over is `not_found` rather than a silent success.
 */
export async function checkOutTripGearSet(
  db: AppDb,
  input: { shopId: string; bookingId: string },
): Promise<GearReservationActionOutcome> {
  const handedOver = await db
    .update(gearReservations)
    .set({ checkedOutAt: nowDate() })
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(gearReservations.bookingId, input.bookingId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
      ),
    )
    .returning({ id: gearReservations.id });
  return handedOver.length > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * **Bring a whole rental set home in one act** (issue #1186, delight report
 * D26).
 *
 * A "set" is one diver's units on one departure, which is what a counter
 * actually hands back: somebody walks up with an armful, and asking for an
 * outcome per piece is the paperwork this feature exists to remove. So the
 * outcome is asked once and written to every unit in the set.
 *
 * Nothing is invented for a unit that is not out. Only checked-out,
 * unreturned reservations for this booking are closed, and a set where none
 * are is `not_found` rather than a silent success — a staffer who taps Return
 * on a set somebody else already brought back should be told, not reassured.
 *
 * The service concern's note is required for the same reason it is required on
 * the single-unit path, and refused before anything is written, so a set is
 * never half-closed on a refusal.
 *
 * **Pulling a unit to the bench is a second, opt-in act in the same
 * transaction** (issue #2205). With a service concern, `pullGearItemIds` names
 * the units the staffer ticked, and each goes to `needs_service` through
 * {@link setGearItemStatus} with the concern's note as its service note — the
 * status the register, the picker and `reserveGearUnit` already respect. It is
 * never automatic (a scratched mask and a free-flowing regulator are both
 * concerns), it still writes no `gear_service_events` row (the
 * `gearReturnOutcome` schema comment), and it only reaches units this return
 * actually closed: an id from anywhere else is ignored, as is a unit already
 * off the wall, whose technician's note is not overwritten. Ignored entirely
 * for any other outcome.
 */
export async function returnTripGearSet(
  db: AppDb,
  input: {
    shopId: string;
    bookingId: string;
    outcome: GearReturnOutcome;
    note?: string;
    pullGearItemIds?: readonly string[];
  },
): Promise<GearReservationActionOutcome> {
  const note = optional(input.note);
  if (input.outcome === "service_concern" && !note) {
    return { ok: false, reason: "concern_needs_words" };
  }
  const pull =
    input.outcome === "service_concern" ? new Set(input.pullGearItemIds ?? []) : new Set<string>();
  return db.transaction(async (tx) => {
    const returned = await tx
      .update(gearReservations)
      .set({ returnedAt: nowDate(), returnNote: note, returnOutcome: input.outcome })
      .where(
        and(
          eq(gearReservations.shopId, input.shopId),
          eq(gearReservations.bookingId, input.bookingId),
          isNotNull(gearReservations.checkedOutAt),
          openGearReservation(),
        ),
      )
      .returning({ id: gearReservations.id, gearItemId: gearReservations.gearItemId });
    if (returned.length === 0) return { ok: false, reason: "not_found" } as const;
    const toPull = returned.map((row) => row.gearItemId).filter((id) => pull.has(id));
    if (toPull.length > 0) {
      const onTheWall = await tx
        .select({ id: gearItems.id })
        .from(gearItems)
        .where(
          and(
            eq(gearItems.shopId, input.shopId),
            inArray(gearItems.id, toPull),
            eq(gearItems.status, "in_service"),
            liveGearItem(),
          ),
        );
      for (const unit of onTheWall) {
        await setGearItemStatus(tx, {
          shopId: input.shopId,
          gearItemId: unit.id,
          status: "needs_service",
          serviceNote: note ?? undefined,
        });
      }
    }
    return { ok: true } as const;
  });
}

/**
 * Un-assign a unit that never left the counter. Once it has been checked out
 * the honest close is a return — releasing an out unit would erase the only
 * record of who has it.
 *
 * **A stamp, never a delete** (issue #2258): `released_at` and who did it, so
 * the record that the unit was held survives (a disputed no-show charge is
 * the case), while {@link openGearReservation} and the exclusion constraint
 * both stop seeing the row and the window frees at once. A released hold is
 * not restorable; the unit is simply held again.
 */
export async function releaseGearReservation(
  db: AppDb,
  input: { shopId: string; reservationId: string; releasedByPersonId: string },
): Promise<GearReservationActionOutcome> {
  const [released] = await db
    .update(gearReservations)
    .set({ releasedAt: nowDate(), releasedByPersonId: input.releasedByPersonId })
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
      ),
    )
    .returning({ id: gearReservations.id, bookingId: gearReservations.bookingId });
  if (released) {
    // The same handoff line the reservation wrote: a unit taken back off a
    // diver is as much a change to what they are carrying as one assigned
    // (#1187). Only when there is a booking: a bookingless counter rental
    // belongs to no departure and so is nobody's handoff.
    const [booking] = released.bookingId
      ? await db
          .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
          .from(bookings)
          .where(and(eq(bookings.id, released.bookingId), eq(bookings.shopId, input.shopId)))
          .limit(1)
      : [];
    if (booking) {
      await recordDeskEvent(db, {
        shopId: input.shopId,
        tripId: booking.tripId,
        kind: "gear_changed",
        bookingId: booking.id,
        subjectPersonId: booking.personId,
      });
    }
    return { ok: true };
  }
  const stamps = await reservationStamps(db, input);
  if (!stamps) return { ok: false, reason: "not_found" };
  // A returned row can carry no check-out stamp (marking a unit returned never
  // required one), so the refusal names the state that actually blocks the
  // release rather than defaulting to "checked out".
  return { ok: false, reason: stamps.returnedAt ? "already_returned" : "already_checked_out" };
}

/**
 * A booking that leaves the roster lets go of the units it never collected.
 * Called inside each cancellation transaction beside the capability revoke,
 * for the same reason: a cancelled diver holding the only size-S BCD against
 * the divers who are actually coming is a stale claim nothing would surface
 * (dive-domain review, 2026-08-20). Checked-out units deliberately stay —
 * they are physically with someone, and the register's overdue chase is the
 * honest path home for those.
 *
 * Like every automatic release (this one's trip-level twin, and a move onto
 * dates the unit is taken for), it stamps `released_at` and leaves
 * `released_by_person_id` null: the system let go, not a person (issue #2258).
 */
export async function releaseUnclaimedGearReservations(
  db: DbExecutor,
  input: {
    shopId: string;
    bookingId: string;
    /**
     * Only units of these kinds. A seat that stops diving lets go of the
     * regulator it will not breathe from and keeps the mask it will still
     * wear (ADR 20261007-participant-types). Omitted, every kind goes.
     */
    kinds?: readonly GearItemKind[];
  },
): Promise<void> {
  if (input.kinds?.length === 0) return;
  await db
    .update(gearReservations)
    .set({ releasedAt: nowDate() })
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(gearReservations.bookingId, input.bookingId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
        input.kinds
          ? inArray(
              gearReservations.gearItemId,
              db
                .select({ id: gearItems.id })
                .from(gearItems)
                .where(
                  and(
                    eq(gearItems.shopId, input.shopId),
                    inArray(gearItems.kind, [...input.kinds]),
                  ),
                ),
            )
          : undefined,
      ),
    );
}

/**
 * The trip-level twin of {@link releaseUnclaimedGearReservations}, for the
 * writers that cancel whole departures while keeping their bookings on the
 * books — the per-date cancel and blow-out (via `setTripStatus`), the
 * minimum-seats sweep, and the two series bulk cancellations. Their bookings
 * survive, so the booking cascade never runs, and without this every unit
 * reserved against the cancelled departure would sit blocked in
 * `listAvailableGearUnits` until someone noticed. Checked-out units
 * deliberately stay: they are physically with a diver, and the return is the
 * honest close.
 */
export async function releaseUnclaimedGearReservationsForTrips(
  db: DbExecutor,
  input: { shopId: string; tripIds: readonly string[] },
): Promise<void> {
  if (input.tripIds.length === 0) return;
  await db
    .update(gearReservations)
    .set({ releasedAt: nowDate() })
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
        inArray(
          gearReservations.bookingId,
          db
            .select({ id: bookings.id })
            .from(bookings)
            .where(
              and(eq(bookings.shopId, input.shopId), inArray(bookings.tripId, [...input.tripIds])),
            ),
        ),
      ),
    );
}

/**
 * Slide a departure's unclaimed gear reservations onto its new dates.
 *
 * A reservation's window is derived from the trip at assign time
 * (`tripReservationWindow`), never re-read, so a departure that moves used to
 * leave every unit spoken for on the old days: the boat left on Thursday with
 * kit the register still believed was out on Tuesday, the units read free for
 * Thursday and could be double-assigned, and Today's due-back and overdue rows
 * — which are window-driven — pointed at the wrong day.
 *
 * **Checked-out units are deliberately left alone.** Their window describes a
 * physical handover that has already happened; the diver has the regulator, and
 * the return is the honest close for it wherever the departure ends up.
 *
 * **A collision releases the loser, and says so.** The new window can overlap
 * another reservation of the same unit — the `gear_reservations_no_overlap`
 * exclusion constraint refuses it, correctly — and the alternatives are worse
 * than releasing: keeping the stale window is the bug this function exists to
 * fix, and refusing the whole move would let one gear assignment veto a schedule
 * edit the crew has already agreed with a customer. So the reservation is
 * released and the count travels back in the move outcome, for the board to say
 * "2 gear assignments released — reassign on prep". Releasing without saying so
 * would be the actual failure: silence there is a unit somebody thinks is packed.
 *
 * Each update runs in its own savepoint. On real Postgres a failed statement
 * aborts the enclosing transaction block, so a plain try/catch would poison the
 * caller's transaction — `moveTrip`'s — for every row after the first collision
 * (the same reasoning as `findOrCreatePerson`).
 */
export async function rewindowTripGearReservations(
  tx: DbExecutor,
  input: { shopId: string; tripId: string; window: ReservationWindow },
): Promise<{ moved: number; released: number }> {
  const open = await tx
    .select({ id: gearReservations.id })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .where(
      and(
        eq(gearReservations.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
      ),
    )
    .orderBy(asc(gearReservations.id));

  let moved = 0;
  let released = 0;
  // Sequential, never a fan-out: this runs inside `moveTrip`'s transaction,
  // which is one checked-out client (`scripts/check-db-concurrency.mjs`).
  for (const reservation of open) {
    try {
      await tx.transaction(async (sp) => {
        await sp
          .update(gearReservations)
          .set({ reservedFrom: input.window.from, reservedUntil: input.window.until })
          .where(eq(gearReservations.id, reservation.id));
      });
      moved += 1;
    } catch (error) {
      if (!violatesExclusionConstraint(error, "gear_reservations_no_overlap")) throw error;
      await tx
        .update(gearReservations)
        .set({ releasedAt: nowDate() })
        .where(eq(gearReservations.id, reservation.id));
      released += 1;
    }
  }
  return { moved, released };
}

/**
 * How many open reservations ride on one departure — the exact set
 * {@link rewindowTripGearReservations} above will try to carry onto new dates,
 * asked with the identical predicate and deliberately kept beside it so the two
 * cannot drift apart unnoticed.
 *
 * A *count*, never an availability check. The schedule builder's move preview
 * uses it to say how much kit travels and that collisions are released; whether
 * a particular unit is free on the new dates is decided by the
 * `gear_reservations_no_overlap` exclusion constraint at commit time, and a
 * read taken while a panel sits open can be stale by then (issue #1203).
 */
export async function countOpenTripGearReservations(
  db: DbExecutor,
  shopId: string,
  tripId: string,
): Promise<number> {
  const [counted] = await db
    .select({ total: count() })
    .from(gearReservations)
    .innerJoin(bookings, eq(bookings.id, gearReservations.bookingId))
    .where(
      and(
        eq(gearReservations.shopId, shopId),
        eq(bookings.tripId, tripId),
        isNull(gearReservations.checkedOutAt),
        openGearReservation(),
      ),
    );
  return counted?.total ?? 0;
}

async function reservationStamps(
  db: AppDb,
  input: { shopId: string; reservationId: string },
): Promise<{ checkedOutAt: Date | null; returnedAt: Date | null } | null> {
  const [row] = await db
    .select({
      checkedOutAt: gearReservations.checkedOutAt,
      returnedAt: gearReservations.returnedAt,
    })
    .from(gearReservations)
    .where(
      and(
        eq(gearReservations.id, input.reservationId),
        eq(gearReservations.shopId, input.shopId),
        // A released hold is gone to every action, as it was when the release deleted it.
        isNull(gearReservations.releasedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
