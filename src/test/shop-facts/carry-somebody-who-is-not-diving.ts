import { and, eq, gte, isNull } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { bookings, people, trips } from "../../db/schema/index";
import { heldSeatCounts, seatNotCancelled, setTripParticipantTerms } from "../../db/trips";
import { seatDiver } from "../../features/seat-diver/store";
import { REEF_TRIP_TITLE } from "./reef-trip-title";

/**
 * **A snorkeler and a rider on today's reef boat** (ADR
 * 20261007-participant-types): the roster and roll-call badge, the head
 * count's split, and the public form's "Joining as" choice with a price per
 * type.
 *
 * The same boat, people and prices as the demo seed's mixed boat
 * (`seed-mixed-boat.ts`, which arrives with the UX stack above this layer), so
 * a capture reads the same on every layer. **Idempotent**: when the boat
 * already carries a snorkeler and a rider, whoever seeded them, nobody new is
 * seated, so a layer with the demo seed never shows a second Owen Quint.
 *
 * Through the real doors: `setTripParticipantTerms` names the two prices, and
 * `seatDiver` seats each person with their type. The boat grows by the places
 * they take, as the demo seed's does, so "3 spots left" still reads the same.
 */
const NOT_DIVING = [
  { fullName: "Mara Quint", participantType: "snorkeler" as const },
  { fullName: "Owen Quint", participantType: "rider" as const },
];

export async function carrySomebodyWhoIsNotDiving(
  db: AppDb,
  shopId: string,
  actorPersonId: string,
  now: Date,
): Promise<{ tripId: string; title: string; snorkeler: string; rider: string } | null> {
  const [reef] = await db
    .select({ id: trips.id, title: trips.title, capacity: trips.capacity })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.title, REEF_TRIP_TITLE),
        eq(trips.status, "scheduled"),
        isNull(trips.deletedAt),
        gte(trips.startsAt, now),
      ),
    )
    .orderBy(trips.startsAt)
    .limit(1);
  if (!reef) return null;

  const aboard = await db
    .select({ fullName: people.fullName, participantType: bookings.participantType })
    .from(bookings)
    .innerJoin(people, eq(people.id, bookings.personId))
    .where(and(eq(bookings.shopId, shopId), eq(bookings.tripId, reef.id), seatNotCancelled));
  const named = (type: "snorkeler" | "rider") =>
    aboard.find((row) => row.participantType === type)?.fullName;
  const missing = NOT_DIVING.filter((guest) => !named(guest.participantType));

  if (missing.length > 0) {
    const held = await heldSeatCounts(db, shopId, reef.id);
    const room = reef.capacity - held.aboard;
    if (room < missing.length) {
      await db
        .update(trips)
        .set({ capacity: reef.capacity + missing.length - Math.max(room, 0) })
        .where(eq(trips.id, reef.id));
    }
    const terms = await setTripParticipantTerms(db, shopId, reef.id, {
      snorkelerPriceCents: 4500,
      riderPriceCents: 2500,
      diverCapacity: null,
    });
    if (!terms.ok) return null;
    for (const guest of missing) {
      const seated = await seatDiver(db, {
        shopId,
        tripId: reef.id,
        actorPersonId,
        diver: { fullName: guest.fullName },
        entry: "roster",
        refusals: "coarse",
        participantType: guest.participantType,
      });
      if (!seated.ok) return null;
    }
  }
  const snorkeler = named("snorkeler") ?? NOT_DIVING[0].fullName;
  const rider = named("rider") ?? NOT_DIVING[1].fullName;
  return { tripId: reef.id, title: reef.title, snorkeler, rider };
}
