import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import { hasReturned } from "@/lib/trips";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { revokeBookingCapabilities } from "./booking-capabilities";
import { movableSameNameSeats } from "./bookings";
import type { AppDb, DbExecutor } from "./client";
import { recordDiverActivity, recordTripActivity } from "./operations";
import { violatesUniqueIndex } from "./query-helpers";
import {
  bookings,
  gearReservations,
  notificationSendQueue,
  people,
  trips,
  waiverRecords,
} from "./schema";
import { livePerson, liveTrip } from "./trips-live";
import { CLEARED_DRAFT_COLUMNS } from "./waiver-record-columns";

/**
 * **The third answer to a held seat: it is another diver already on file**
 * (issue #2129, Aaron 2026-10-13, option a).
 *
 * A seat held because the shop holds more than one diver with the booked-as
 * name has a true answer besides "Same person" and "Different person": the
 * seat belongs to the *other* record with that name. Before this, the desk
 * split into a new record and merged it into the right diver by hand.
 */

/** The comparable form of a name: what "exactly that name" means here. */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Another live person with the held seat's name, offered by name only. */
export type SameNamePerson = { personId: string; fullName: string };

/**
 * For each held seat whose booked-as name **is** the matched diver's name
 * (the "more than one diver is named …" reason), the shop's *other* live
 * people with exactly that name, lower-cased and trimmed, oldest record first.
 *
 * **Name only** (Aaron 2026-10-13, option a): nothing else from any of these
 * records is read here, so the held row discloses nothing the staff diver
 * search does not already show; the staffer opens a record to check it. Seats
 * with any other reason, or nobody else to offer, are absent from the map.
 */
export async function otherSameNamePeople(
  db: DbExecutor,
  shopId: string,
  seats: ReadonlyArray<{ bookingId: string; personId: string; bookedAs: string | null }>,
): Promise<Map<string, SameNamePerson[]>> {
  const result = new Map<string, SameNamePerson[]>();
  const named = seats.filter((seat): seat is typeof seat & { bookedAs: string } =>
    Boolean(seat.bookedAs?.trim()),
  );
  if (named.length === 0) return result;
  const keys = [...new Set(named.map((seat) => nameKey(seat.bookedAs)))];
  const rows = await db
    .select({ personId: people.id, fullName: people.fullName })
    .from(people)
    .where(
      and(
        eq(people.shopId, shopId),
        isNull(people.deletedAt),
        isNull(people.anonymizedAt),
        isNull(people.mergedIntoPersonId),
        inArray(sql<string>`lower(trim(${people.fullName}))`, keys),
      ),
    )
    .orderBy(asc(people.createdAt), asc(people.fullName), asc(people.id));
  for (const seat of named) {
    const key = nameKey(seat.bookedAs);
    const sameName = rows.filter((row) => nameKey(row.fullName) === key);
    // Only the same-name reason: the matched diver carries the booked-as name.
    if (!sameName.some((row) => row.personId === seat.personId)) continue;
    const others = sameName.filter((row) => row.personId !== seat.personId);
    if (others.length > 0) result.set(seat.bookingId, others);
  }
  return result;
}

export type RepointHeldBookingResult =
  | {
      ok: true;
      tripId: string;
      /** The bookings that moved, this one first. */
      seatIds: string[];
      flySafeFollowUp?: true;
    }
  | {
      ok: false;
      reason: /** No live held seat by that id at this shop. */
        | "not_held"
        /**
         * The chosen person is not another live person of this shop with the
         * seat's booked-as name, or the seat is not held for the same-name
         * reason at all.
         */
        | "person_unavailable"
        /** A seat moving carries a medical hold nobody has cleared. */
        | "medical_hold"
        /** The chosen person already has a seat on a departure that would move. */
        | "already_on_departure"
        /** The seat's departure is deleted, cancelled or back (security review Y4). */
        | "departure_closed";
    };

export type RepointHeldBookingInput = {
  shopId: string;
  bookingId: string;
  actorPersonId: string;
  /** The other same-name person the staffer picked. */
  toPersonId: string;
  /** As {@link SplitBookingIdentityInput.sameNameSeatIds}: only those still movable move. */
  sameNameSeatIds?: ReadonlyArray<string>;
};

/**
 * **Re-point a held seat to the other same-name diver, and keep it held.**
 *
 * The constraint is the whole design: **re-pointing never confirms the
 * identity**. The seat stays `identity_unconfirmed` and readiness asks for
 * "Same person" against the new match exactly as it asked against the old; the
 * new record's cards, release and prepaid dives are handed to nobody by this
 * tap. Everything else is the split's (`splitBookingIdentity`), in one
 * transaction:
 *
 * - The chosen person must be a live person of this shop whose name is
 *   exactly the seat's booked-as name, and not the record the seat is on now;
 *   a person from another shop, a removed, erased or merged one, or one with
 *   another name is refused (`person_unavailable`).
 * - The booker's other same-name held seats move too when the form named them
 *   and they are still movable (`movableSameNameSeats`), all or none.
 * - A seat moving with a referral nobody has cleared is refused
 *   (`medical_hold`): superseding its release would lift the hold.
 * - One person is never on one departure twice: a chosen person already
 *   holding a seat on a departure that would move is refused
 *   (`already_on_departure`), and so is one whose seat lands there mid-tap
 *   (`bookings_trip_person_unique`, agency review G8).
 * - Only a seat on a departure still to come moves: one deleted, cancelled
 *   or back is refused (`departure_closed`, security review Y4), as the
 *   split refuses it.
 * - Every live release on a moving seat is superseded and its token dropped,
 *   since each names the old match; unsigned links follow the seat to the new
 *   record with their drafts cleared. Every bearer link over the seats is
 *   revoked, queued sends are dropped, and held gear follows the seat. Staff
 *   notes stay with the record they were written under.
 *
 * Three trail lines: the departure's, and one on each record, the one the seat
 * left and the one it now waits on.
 */
export async function repointHeldBooking(
  db: AppDb,
  input: RepointHeldBookingInput,
): Promise<RepointHeldBookingResult> {
  let outcome: RepointOutcome;
  try {
    outcome = await db.transaction((tx) => repointInTransaction(tx, input));
  } catch (error) {
    // A seat of theirs that landed on a moving departure after the check
    // below read it (agency review G8): the same refusal, not a thrown 500.
    if (violatesUniqueIndex(error, "bookings_trip_person_unique")) {
      return { ok: false, reason: "already_on_departure" };
    }
    throw error;
  }
  if (outcome.refused) return { ok: false, reason: outcome.refused };
  for (const tripId of new Set(outcome.seats.map((seat) => seat.tripId))) {
    await recordTripActivity(db, {
      shopId: input.shopId,
      tripId,
      actorPersonId: input.actorPersonId,
      entry: { code: "identity_repointed", diver: outcome.bookedAs },
    });
  }
  await recordDiverActivity(db, {
    shopId: input.shopId,
    personId: outcome.fromPersonId,
    actorPersonId: input.actorPersonId,
    code: "identity_repointed_off",
  });
  await recordDiverActivity(db, {
    shopId: input.shopId,
    personId: input.toPersonId,
    actorPersonId: input.actorPersonId,
    code: "identity_repointed_onto",
  });
  const [first] = outcome.seats;
  return {
    ok: true,
    tripId: first?.tripId ?? "",
    seatIds: outcome.seats.map((seat) => seat.bookingId),
    ...(outcome.flySafeFollowUp ? { flySafeFollowUp: true as const } : {}),
  };
}

type RepointOutcome =
  | { refused: Extract<RepointHeldBookingResult, { ok: false }>["reason"] }
  | {
      refused: null;
      fromPersonId: string;
      bookedAs: string;
      flySafeFollowUp: boolean;
      seats: Array<{ bookingId: string; tripId: string }>;
    };

/** The re-point's reads, refusals and writes, in the caller's transaction. */
async function repointInTransaction(
  tx: DbExecutor,
  input: RepointHeldBookingInput,
): Promise<RepointOutcome> {
  const now = nowDate();
  await lockBoardingCertificationEvidence(tx, input.shopId, "boarding");
  // Only a seat on a departure still to come (security review Y4): one that
  // is deleted, cancelled or back has nobody left to re-point.
  const [booking] = await tx
    .select({
      tripId: bookings.tripId,
      personId: bookings.personId,
      bookedAs: bookings.identityBookedAs,
      tripStatus: trips.status,
      tripDeletedAt: trips.deletedAt,
      endsAt: trips.endsAt,
    })
    .from(bookings)
    .innerJoin(trips, and(eq(trips.id, bookings.tripId), eq(trips.shopId, bookings.shopId)))
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.shopId, input.shopId),
        isNotNull(bookings.identityUnconfirmedAt),
        ne(bookings.status, "cancelled"),
      ),
    )
    .limit(1);
  if (!booking) return { refused: "not_held" };
  const personIds = [booking.personId, input.toPersonId].sort();
  await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, input.shopId), inArray(people.id, personIds), livePerson()))
    .orderBy(asc(people.id))
    .for("no key update");
  const [lockedBooking] = await tx
    .select({ personId: bookings.personId, tripId: bookings.tripId })
    .from(bookings)
    .where(and(eq(bookings.id, input.bookingId), eq(bookings.shopId, input.shopId)))
    .for("update");
  if (
    !lockedBooking ||
    lockedBooking.personId !== booking.personId ||
    lockedBooking.tripId !== booking.tripId
  )
    return { refused: "not_held" };
  if (
    booking.tripDeletedAt ||
    booking.tripStatus !== "scheduled" ||
    hasReturned(booking.endsAt, now)
  ) {
    return { refused: "departure_closed" };
  }

  const bookedAs = booking.bookedAs?.trim();
  if (!bookedAs || input.toPersonId === booking.personId) {
    return { refused: "person_unavailable" };
  }

  // Both names read under a share lock, so a rename or a removal racing
  // this tap either lands first and refuses it, or waits for it.
  const named = await tx
    .select({
      id: people.id,
      fullName: people.fullName,
      deletedAt: people.deletedAt,
      anonymizedAt: people.anonymizedAt,
      mergedIntoPersonId: people.mergedIntoPersonId,
    })
    .from(people)
    .where(
      // diveday:allow-deleted-people: both rows by id, read with their removal
      // columns so the refusal below can name a removed, erased or merged record.
      and(
        eq(people.shopId, input.shopId),
        inArray(people.id, [booking.personId, input.toPersonId]),
      ),
    );
  const from = named.find((row) => row.id === booking.personId);
  const to = named.find((row) => row.id === input.toPersonId);
  if (
    !from ||
    !to ||
    to.deletedAt ||
    to.anonymizedAt ||
    to.mergedIntoPersonId ||
    // The same-name reason only: the seat's booked-as name is the record's
    // it is on now, and the record it moves to carries it too.
    nameKey(from.fullName) !== nameKey(bookedAs) ||
    nameKey(to.fullName) !== nameKey(bookedAs)
  ) {
    return { refused: "person_unavailable" };
  }

  const requested = new Set(input.sameNameSeatIds ?? []);
  requested.delete(input.bookingId);
  const candidates =
    requested.size > 0
      ? await tx
          .select({ bookingId: bookings.id, tripId: bookings.tripId, endsAt: trips.endsAt })
          .from(bookings)
          .innerJoin(trips, eq(trips.id, bookings.tripId))
          .where(
            and(
              eq(bookings.shopId, input.shopId),
              eq(bookings.personId, booking.personId),
              ne(bookings.id, input.bookingId),
              isNotNull(bookings.identityUnconfirmedAt),
              ne(bookings.status, "cancelled"),
              sql`lower(trim(${bookings.identityBookedAs})) = lower(trim(${bookedAs}))`,
              eq(trips.shopId, input.shopId),
              eq(trips.status, "scheduled"),
              liveTrip(),
            ),
          )
          .for("update", { of: bookings })
      : [];
  const siblings = movableSameNameSeats(
    booking.tripId,
    candidates
      .filter((seat) => !hasReturned(seat.endsAt, now))
      .map(({ bookingId, tripId }) => ({ bookingId, tripId })),
  ).filter((seat) => requested.has(seat.bookingId));
  const seats = [{ bookingId: input.bookingId, tripId: booking.tripId }, ...siblings];
  const seatIds = seats.map((seat) => seat.bookingId);
  const [priorFlyingAdvice] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        inArray(bookings.id, seatIds),
        isNotNull(bookings.flySafeHoursTold),
      ),
    )
    .limit(1);

  // `bookings_trip_person_unique` holds a cancelled row too, so any row of
  // theirs on a moving departure refuses the move.
  const [already] = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, input.shopId),
        eq(bookings.personId, input.toPersonId),
        inArray(
          bookings.tripId,
          seats.map((seat) => seat.tripId),
        ),
      ),
    )
    .limit(1);
  if (already) return { refused: "already_on_departure" };

  // The split's own medical refusal, read the same way and under lock.
  const live = await tx
    .select({
      status: waiverRecords.status,
      medicalClearedAt: waiverRecords.medicalClearedAt,
    })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        inArray(waiverRecords.bookingId, seatIds),
        isNull(waiverRecords.supersededAt),
      ),
    )
    .for("update");
  if (live.some((row) => row.status === "medical_review" && !row.medicalClearedAt)) {
    return { refused: "medical_hold" };
  }

  // Moves the seat and nothing about who it is: the hold stays, with the
  // name it was booked under and how it was matched.
  await tx
    .update(bookings)
    .set({
      personId: input.toPersonId,
      flySafeRecipientSealed: null,
      flySafeAcknowledgementFingerprint: null,
      flySafeAcknowledgedAt: null,
      flySafeAcknowledgedByPersonId: null,
      flySafeRecipientUnknown: sql`${bookings.flySafeHoursTold} is not null or ${bookings.flySafeRecipientUnknown}`,
      flySafeCorrectedAt: null,
      flySafeCorrectionId: null,
      flySafeCorrectionLeaseId: null,
      flySafeCorrectionLeaseUntil: null,
    })
    .where(and(inArray(bookings.id, seatIds), eq(bookings.shopId, input.shopId)));
  await tx
    .update(waiverRecords)
    .set({ supersededAt: now, tokenSealed: null })
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        inArray(waiverRecords.bookingId, seatIds),
        isNull(waiverRecords.supersededAt),
      ),
    );
  await tx
    .update(waiverRecords)
    .set({
      personId: input.toPersonId,
      ...CLEARED_DRAFT_COLUMNS,
      deliveryError: null,
      deliveryProviderMessageId: null,
      deliveryProviderStatus: null,
      deliveryProviderStatusAt: null,
      movedFromPersonId: booking.personId,
      movedAt: now,
      movedByPersonId: input.actorPersonId,
    })
    .where(
      and(
        eq(waiverRecords.shopId, input.shopId),
        inArray(waiverRecords.bookingId, seatIds),
        eq(waiverRecords.personId, booking.personId),
        isNull(waiverRecords.signedAt),
        isNull(waiverRecords.integrityHash),
        isNull(waiverRecords.anonymizedAt),
      ),
    );
  for (const bookingId of seatIds) {
    await revokeBookingCapabilities(tx, { shopId: input.shopId, bookingId, now });
  }
  await tx.delete(notificationSendQueue).where(
    and(
      eq(notificationSendQueue.shopId, input.shopId),
      or(
        inArray(notificationSendQueue.bookingId, seatIds),
        inArray(
          notificationSendQueue.idempotencyKey,
          seatIds.map((id) => `fly-safe-correction/${id}`),
        ),
      ),
      eq(notificationSendQueue.status, "queued"),
    ),
  );
  await tx
    .update(gearReservations)
    .set({ personId: input.toPersonId })
    .where(
      and(eq(gearReservations.shopId, input.shopId), inArray(gearReservations.bookingId, seatIds)),
    );
  return {
    refused: null,
    fromPersonId: booking.personId,
    bookedAs,
    seats,
    flySafeFollowUp: !!priorFlyingAdvice,
  };
}
