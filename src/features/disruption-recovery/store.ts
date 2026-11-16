import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import { loadActiveStaffRoles } from "../../db/authz";
import type { AppDb } from "../../db/client";
import { boundLockWaits, isLockWaitRefusal } from "../../db/lock-bounds";
import {
  bookings,
  disruptionRecoveryEvents,
  people,
  tripBlowoutDivers,
  tripBlowouts,
  trips,
} from "../../db/schema";
import { seatHeld } from "../../db/trips";
import { isStaff } from "../../lib/authz";
import { nowDate } from "../../lib/clock";
import { isRecoveryOutcome, type RecoveryOutcome } from "../../lib/disruption-recovery";
import { isUuid } from "../../lib/uuid";

type Input = {
  shopId: string;
  tripId: string;
  blowoutDiverId: string;
  actorPersonId: string;
  attemptId: string;
  expectedRevision: number;
  outcome: RecoveryOutcome;
  replacementBookingId: string | null;
};

/** Records an explicit association only. Never seats/moves a diver or changes money. */
export async function recordRecoveryFollowUp(db: AppDb, input: Input) {
  const invalid = { ok: false, reason: "invalid" } as const;
  if (
    ![input.shopId, input.tripId, input.blowoutDiverId, input.actorPersonId, input.attemptId].every(
      isUuid,
    ) ||
    !isRecoveryOutcome(input.outcome) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    (input.outcome === "rebooked") !== Boolean(input.replacementBookingId) ||
    (input.replacementBookingId !== null && !isUuid(input.replacementBookingId))
  )
    return invalid;
  return db
    .transaction(async (tx) => {
      await boundLockWaits(tx);
      const roles = await loadActiveStaffRoles(tx, input.shopId, input.actorPersonId);
      if (!roles || !isStaff(roles)) return { ok: false, reason: "not_authorized" } as const;
      const [row] = await tx
        .select({ diver: tripBlowoutDivers })
        .from(tripBlowoutDivers)
        .innerJoin(
          tripBlowouts,
          and(
            eq(tripBlowouts.id, tripBlowoutDivers.blowoutId),
            eq(tripBlowouts.shopId, input.shopId),
          ),
        )
        .innerJoin(trips, and(eq(trips.id, tripBlowouts.tripId), eq(trips.shopId, input.shopId)))
        .innerJoin(
          people,
          and(eq(people.id, tripBlowoutDivers.personId), eq(people.shopId, input.shopId)),
        )
        .where(
          and(
            eq(tripBlowoutDivers.id, input.blowoutDiverId),
            eq(tripBlowoutDivers.shopId, input.shopId),
            eq(trips.id, input.tripId),
            eq(trips.status, "cancelled"),
            isNull(people.deletedAt),
            isNull(trips.deletedAt),
          ),
        )
        .for("update", { of: tripBlowoutDivers });
      if (!row) return { ok: false, reason: "not_found" } as const;
      const events = await tx
        .select()
        .from(disruptionRecoveryEvents)
        .where(
          and(
            eq(disruptionRecoveryEvents.shopId, input.shopId),
            eq(disruptionRecoveryEvents.blowoutDiverId, row.diver.id),
          ),
        )
        .orderBy(asc(disruptionRecoveryEvents.seq));
      const prior = events.find((event) => event.id === input.attemptId);
      if (prior)
        return prior.outcome === input.outcome &&
          prior.replacementBookingId === input.replacementBookingId &&
          prior.actorPersonId === input.actorPersonId
          ? ({ ok: true, revision: events.length } as const)
          : invalid;
      if (events.length !== input.expectedRevision) return { ok: false, reason: "stale" } as const;
      if (input.replacementBookingId) {
        const [source] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .where(
            and(
              eq(bookings.id, row.diver.bookingId),
              eq(bookings.shopId, input.shopId),
              eq(bookings.personId, row.diver.personId),
              isNull(bookings.identityUnconfirmedAt),
            ),
          );
        const [replacement] = await tx
          .select({ id: bookings.id })
          .from(bookings)
          .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, input.shopId)))
          .where(
            and(
              eq(bookings.id, input.replacementBookingId),
              eq(bookings.shopId, input.shopId),
              eq(bookings.personId, row.diver.personId),
              ne(bookings.id, row.diver.bookingId),
              seatHeld,
              isNull(bookings.identityUnconfirmedAt),
              eq(trips.status, "scheduled"),
              isNull(trips.deletedAt),
              gt(trips.startsAt, nowDate()),
            ),
          );
        if (!source || !replacement)
          return { ok: false, reason: "replacement_unavailable" } as const;
      }
      const inserted = await tx
        .insert(disruptionRecoveryEvents)
        .values({
          id: input.attemptId,
          shopId: input.shopId,
          blowoutDiverId: row.diver.id,
          actorPersonId: input.actorPersonId,
          outcome: input.outcome,
          replacementBookingId: input.replacementBookingId,
        })
        .onConflictDoNothing()
        .returning({ id: disruptionRecoveryEvents.id });
      if (!inserted.length) return invalid;
      return { ok: true, revision: events.length + 1 } as const;
    })
    .catch((error: unknown) => {
      if (isLockWaitRefusal(error)) return { ok: false, reason: "busy" } as const;
      throw error;
    });
}
