import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "@/lib/authz";
import { type AppDb, isUniqueConstraintViolation } from "./client";
import { publishManifestEvent } from "./manifest-events";
import { bookings, buddyPairMembers, people, personRoles, trips } from "./schema";

/**
 * Buddy pairs on a departure (ADR 20260804-buddy-pairs): staff pair two
 * roster entries — bookings, never people, because "buddies" is a decision
 * about *this* boat — so roll call can surface "one buddy is back aboard and
 * the other is not".
 *
 * Pairs are exactly two. A trio is two pairs' worth of a decision the shop
 * makes (glossary **Buddy pair**); nothing here models a team of three.
 *
 * The writes are deliberately boring: one writer inserts both member rows in
 * one transaction, the unique index on `booking_id` is the authority that a
 * diver is in at most one pair (it holds under concurrency, where a
 * pre-check alone would not), and unpairing is an explicit separate act —
 * pairing an already-paired diver is refused, never silently re-paired.
 */

export type PairBuddiesOutcome =
  | { ok: true; pairId: string }
  | {
      ok: false;
      reason:
        | "staff_not_found"
        | "trip_unavailable"
        | "booking_unavailable"
        | "same_booking"
        | "already_paired";
    };

export async function pairBuddies(
  db: AppDb,
  input: {
    shopId: string;
    tripId: string;
    bookingIdA: string;
    bookingIdB: string;
    pairedByPersonId: string;
  },
): Promise<PairBuddiesOutcome> {
  let outcome: PairBuddiesOutcome;
  try {
    outcome = await db.transaction(async (tx): Promise<PairBuddiesOutcome> => {
      return await pairBuddiesInTx(tx, input);
    });
  } catch (error) {
    // The pre-check above races a concurrent pairing; the unique index on
    // `booking_id` is the authority, and losing to it is the same refusal.
    if (isUniqueConstraintViolation(error)) return { ok: false, reason: "already_paired" };
    throw error;
  }
  // Pairs render on the manifest, so a change here is exactly what the push
  // signal exists for (ADR 20260726-manifest-push-refresh).
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

async function pairBuddiesInTx(
  tx: Parameters<Parameters<AppDb["transaction"]>[0]>[0],
  input: {
    shopId: string;
    tripId: string;
    bookingIdA: string;
    bookingIdB: string;
    pairedByPersonId: string;
  },
): Promise<PairBuddiesOutcome> {
  // A diver is nobody's own buddy. Checked before anything touches the
  // database so the refusal cannot depend on what else is true of the row.
  if (input.bookingIdA === input.bookingIdB) return { ok: false, reason: "same_booking" };

  // Same staff gate every roll-call write applies: a pairing is a named
  // staff member's call, and the recorder must be staff in *this* shop.
  const [staff] = await tx
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(
      and(
        eq(people.id, input.pairedByPersonId),
        eq(people.shopId, input.shopId),
        inArray(personRoles.role, [...STAFF_ROLES]),
      ),
    )
    .limit(1);
  if (!staff) return { ok: false, reason: "staff_not_found" };

  // Same tenancy and trip-status gate `recordRollCall` applies.
  const [trip] = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.id, input.tripId),
        eq(trips.shopId, input.shopId),
        eq(trips.status, "scheduled"),
      ),
    )
    .limit(1);
  if (!trip) return { ok: false, reason: "trip_unavailable" };

  // Both bookings must be roster entries on *this* trip in *this* shop —
  // the identical `ne(status, "cancelled")` rule `getTripRoster` reads the
  // manifest through, so exactly the divers a manifest shows are the divers
  // a pair can name. A booking from another trip (or another shop's trip,
  // or a cancelled seat) is not on this boat, so it cannot be half of this
  // boat's buddy team.
  const seats = await tx
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        inArray(bookings.id, [input.bookingIdA, input.bookingIdB]),
        eq(bookings.shopId, input.shopId),
        eq(bookings.tripId, input.tripId),
        ne(bookings.status, "cancelled"),
      ),
    );
  const activeIds = new Set(seats.map((row) => row.id));
  if (!activeIds.has(input.bookingIdA) || !activeIds.has(input.bookingIdB)) {
    return { ok: false, reason: "booking_unavailable" };
  }

  // Already in a pair — either of them — is a refusal, never a silent
  // re-pair: staff unpair first, so a pairing can only ever be an explicit
  // act about two currently-unpaired divers. The unique index below backs
  // this against a concurrent write.
  const existing = await tx
    .select({ bookingId: buddyPairMembers.bookingId })
    .from(buddyPairMembers)
    .where(inArray(buddyPairMembers.bookingId, [input.bookingIdA, input.bookingIdB]))
    .limit(1);
  if (existing.length > 0) return { ok: false, reason: "already_paired" };

  const pairId = crypto.randomUUID();
  await tx.insert(buddyPairMembers).values(
    [input.bookingIdA, input.bookingIdB].map((bookingId) => ({
      shopId: input.shopId,
      tripId: input.tripId,
      pairId,
      bookingId,
      pairedByPersonId: staff.id,
    })),
  );
  return { ok: true, pairId };
}

export type UnpairBuddiesOutcome = { ok: true } | { ok: false; reason: "not_paired" };

/**
 * Dissolve the pair one booking belongs to — both member rows go together, so
 * a half-pair can never linger. Scoped by shop and trip, so a bare booking
 * UUID from another tenant unpairs nothing. Works whatever the bookings'
 * statuses are: a pair whose other seat has since been cancelled must still
 * be dissolvable, or the surviving diver could never be re-paired.
 */
export async function unpairBuddies(
  db: AppDb,
  input: { shopId: string; tripId: string; bookingId: string },
): Promise<UnpairBuddiesOutcome> {
  const outcome = await db.transaction(async (tx): Promise<UnpairBuddiesOutcome> => {
    const [member] = await tx
      .select({ pairId: buddyPairMembers.pairId })
      .from(buddyPairMembers)
      .where(
        and(
          eq(buddyPairMembers.bookingId, input.bookingId),
          eq(buddyPairMembers.shopId, input.shopId),
          eq(buddyPairMembers.tripId, input.tripId),
        ),
      )
      .limit(1);
    if (!member) return { ok: false, reason: "not_paired" };
    await tx
      .delete(buddyPairMembers)
      .where(
        and(eq(buddyPairMembers.pairId, member.pairId), eq(buddyPairMembers.shopId, input.shopId)),
      );
    return { ok: true };
  });
  if (outcome.ok) await publishManifestEvent(db, input.shopId, input.tripId);
  return outcome;
}

export type TripBuddyPair = {
  pairId: string;
  createdAt: Date;
  pairedByName: string;
  members: Array<{
    bookingId: string;
    fullName: string;
    /** The seat has since been cancelled; the pair shows it and can be dissolved. */
    cancelled: boolean;
  }>;
};

/**
 * Every pair on one trip, cancelled members included and marked. The pairs
 * panel lists these so a pair whose seat was cancelled stays visible and
 * unpairable rather than becoming an invisible row that still refuses a
 * re-pair; the manifest derivation keeps only pairs whose members are both
 * active (see `getTripManifests`).
 */
export async function listTripBuddyPairs(
  db: AppDb,
  shopId: string,
  tripId: string,
): Promise<TripBuddyPair[]> {
  // `people` appears twice — once as the seated diver, once as the staff
  // member who made the call — so the second read needs its own alias.
  const pairedBy = alias(people, "paired_by_people");
  const rows = await db
    .select({
      pairId: buddyPairMembers.pairId,
      createdAt: buddyPairMembers.createdAt,
      bookingId: buddyPairMembers.bookingId,
      bookingStatus: bookings.status,
      fullName: people.fullName,
      pairedByName: pairedBy.fullName,
    })
    .from(buddyPairMembers)
    .innerJoin(bookings, eq(bookings.id, buddyPairMembers.bookingId))
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(pairedBy, eq(pairedBy.id, buddyPairMembers.pairedByPersonId))
    .where(and(eq(buddyPairMembers.shopId, shopId), eq(buddyPairMembers.tripId, tripId)))
    .orderBy(asc(buddyPairMembers.createdAt), asc(buddyPairMembers.pairId));
  const byPair = new Map<string, TripBuddyPair>();
  for (const row of rows) {
    // Crew membership is storable (ADR 20260804-buddy-teams) but not yet
    // surfaced: the manifest, offline snapshot, and export all still model a
    // member as a seated diver. Skipping crew rows here keeps every downstream
    // reader honest until that slice lands — and nothing writes one yet, so
    // this cannot drop a row that exists today.
    if (!row.bookingId) continue;
    const pair = byPair.get(row.pairId) ?? {
      pairId: row.pairId,
      createdAt: row.createdAt,
      pairedByName: row.pairedByName,
      members: [],
    };
    pair.members.push({
      bookingId: row.bookingId,
      fullName: row.fullName,
      cancelled: row.bookingStatus === "cancelled",
    });
    byPair.set(row.pairId, pair);
  }
  // Stable member order inside a pair, whatever order the rows came back in.
  for (const pair of byPair.values()) {
    pair.members.sort((a, b) =>
      a.fullName === b.fullName
        ? a.bookingId.localeCompare(b.bookingId)
        : a.fullName.localeCompare(b.fullName),
    );
  }
  return [...byPair.values()];
}
