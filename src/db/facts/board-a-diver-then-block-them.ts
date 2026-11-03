import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { recordRollCall } from "@/db/manifests";
import { bookings, people, personRoles, trips, waiverRecords } from "@/db/schema";
import { STAFF_ROLES } from "@/lib/authz";
import { HOUR_MS } from "@/lib/clock";

/**
 * **A blocked diver already on the boat**, which is the state the departure
 * card's aboard line exists for and which nothing had ever photographed.
 *
 * It cannot be reached by boarding a blocked diver: `recordRollCall` refuses
 * one at the departure checkpoint (`not_ready`), and the after-dive head count
 * writes a checkpoint this card does not read. That gate is correct and stays.
 *
 * The state arises the other way round, in production, because **readiness is
 * evaluated live**: a diver boards while clear and *then* becomes blocked. A
 * waiver ages out mid-morning, a card is un-verified, a payment is refunded.
 * So that is the sequence here — board a diver the app is happy to board, then
 * supersede their signed release — which also means the real writer runs and
 * its refusal still stands for everyone it should.
 *
 * Not seeded into `blue-mantis` for the same reason nothing else in this file
 * is: a demo whose every capture shows a blocked diver aboard is a worse demo,
 * and the card's ordinary state is what the other captures are for.
 */
export async function boardADiverThenBlockThem(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<{ tripId: string } | null> {
  // The next departure's roster, ordered **by the diver's name** — whoever the
  // app will let aboard, chosen the same way every run.
  //
  // Not `bookings.id`, which is what this said first: that column is
  // `defaultRandom()`, and `/api/test/reset` re-seeds the bookings before every
  // test, so the "first" booking was a fresh random uuid each time. The capture
  // boarded Diego Alvarez on one run and Ines Costa on the next, and reported
  // as changed on the very next pull request — a baseline that moves on its own
  // is one a reviewer learns to wave through (AGENTS.md). Seeded names do not
  // move.
  const candidates = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "booked"),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt, people.fullName);

  // **A staff person, not just any person.** `recordRollCall` refuses with
  // `staff_not_found` otherwise, and the route's shared `actor` is whichever
  // row came first — fine for the panels that only name who acted, and not for
  // this, which is a real safety write going through the real writer.
  const [crew] = await db
    .select({ id: people.id })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), inArray(personRoles.role, [...STAFF_ROLES])))
    .limit(1);
  if (!crew) return null;

  for (const booking of candidates) {
    const boarded = await recordRollCall(db, {
      shopId,
      tripId: booking.tripId,
      bookingId: booking.id,
      recordedByPersonId: crew.id,
      status: "boarded",
    });
    // `not_ready` is the gate doing its job — that diver is blocked and the
    // app refuses to board them. Try the next seat.
    if (!boarded.ok) continue;
    // Now take the release out from under them, the way an expiry would.
    await db
      .update(waiverRecords)
      .set({ supersededAt: now })
      .where(
        and(
          eq(waiverRecords.shopId, shopId),
          eq(waiverRecords.personId, booking.personId),
          isNull(waiverRecords.supersededAt),
        ),
      );
    return { tripId: booking.tripId };
  }
  return null;
}
