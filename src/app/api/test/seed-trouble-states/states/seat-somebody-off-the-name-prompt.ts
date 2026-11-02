import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "@/db/client";
import { people, trips } from "@/db/schema";
import { seatDiver } from "@/db/seat-diver";

/**
 * **A seat the counter's own name prompt produced** (H-20260724-one-person-per-email, issues #1556 and
 * #1696) — a walk-in tapped off "Is this the same Zoe Bennett?", so the booking
 * carries an existing diver's record on a guess and `identity_unconfirmed`
 * refuses it at the rail until a staffer vouches for the person.
 *
 * Through `seatDiver` with `fromNameMatch`, which is the only door that makes
 * this state: stamping `identity_unconfirmed_at` by hand would photograph a row
 * the product could not have written, and would skip the waiver-on-join the
 * held row is normally carrying beside it.
 *
 * Not seeded into blue-mantis, for the reason the whole route exists: the demo
 * shop's own morning boat permanently holding a seat over somebody's identity
 * is a worse demo, and the flag moves readiness, which nine unrelated captures
 * read.
 *
 * **Zoe Bennett by name, and a typed name one letter off it.** The diver has to
 * be somebody today's boat does not already carry (`already_booked` otherwise)
 * and somebody no other seed or spec names, so the row lands in one place;
 * `personNamesMatch` compares token sets exactly, so "Zoe Bennet" is the
 * disagreement that raises the flag.
 *
 * Returns the diver and the boat, because the capture addresses both.
 */
export async function seatSomebodyOffTheNamePrompt(
  db: AppDb,
  shopId: string,
  actorPersonId: string,
  now: Date,
): Promise<{ diver: string; tripId: string; bookingId: string } | null> {
  const [diver] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people) // diveday:allow-deleted-people: an e2e seed finds the people it just seeded
    .where(and(eq(people.shopId, shopId), eq(people.fullName, "Zoe Bennett")))
    .limit(1);
  if (!diver) return null;
  // The boat the counter is pointed at: the next scheduled departure that has
  // not sailed, ordered by its own start so the answer does not depend on a
  // `defaultRandom()` id (see `boardADiverThenBlockThem`).
  const [departure] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!departure) return null;

  const seated = await seatDiver(db, {
    shopId,
    tripId: departure.id,
    actorPersonId,
    diver: { personId: diver.id, fromNameMatch: { typedName: "Zoe Bennet" } },
    entry: "walk_in",
    refusals: "coarse",
  });
  if (!seated.ok || !seated.identityUnconfirmed) return null;
  return { diver: diver.fullName, tripId: departure.id, bookingId: seated.bookingId };
}
