import type { DbExecutor } from "./client";
import {
  bookings,
  type DiveSpecialty,
  type diveSites,
  people,
  personRoles,
  type TripAssignmentRole,
  tripAssignments,
  tripDives,
  tripRequirements,
  tripScheduleDays,
  trips,
} from "./schema";
import { at, nextCreatedAt } from "./seed-clock";

/**
 * **The diver who owes the counter five things.**
 *
 * The check-in counter lists why a diver cannot board. It used to stop at three
 * reasons and summarise the rest as "+N more"; it now lists all of them
 * (`src/components/today/BlockedDiverRow.tsx`). That change could not be *seen*
 * in any capture, because every blocked diver the demo seeds owes exactly one
 * thing: the seeded charters state the shop's default Open Water gate and
 * nothing else, so the deepest stack of reasons reachable at the counter was a
 * waiver plus a card.
 *
 * So this scenario seeds the case the counter meets on a bad morning: a booking
 * taken over the phone with nothing filed. One departure tomorrow — inside the
 * counter's arrivals window (`arrivalsWindow`, 6 h back to 36 h ahead, so it is
 * on screen the day before it sails, which is when the desk chases paperwork) —
 * demanding a waiver, Advanced Open Water, the Deep card, enriched air, and
 * payment up front. One diver holding none of them. Five reasons on one card,
 * every one of them true, and the surface has to say all five.
 *
 * Deliberately its own departure rather than a diver wedged onto a seeded boat
 * (ADR 20260803-seed-scenario-modules): the existing charters' requirements are
 * other scenarios' fixtures — `seed-cert-gates.ts` in particular exists to make
 * each of its four boats refuse for *exactly one* reason — and raising a gate on
 * one of them to stack blockers here would break that scenario's whole point.
 *
 * **Adds only, and called late**, like `seedCertGates` and `seedBuddyPairs`:
 * nothing seeded before it moves, its trip has not sailed (so it opens no
 * head-count gap on Today or the close-out), and no other scenario reads it
 * back. Capacity 8 with one seat sold leaves 7 — clear of the remaining-seat
 * counts the e2e fleet matches trips by (3, 6, and Full).
 */
export const DEMO_COUNTER_BLOCKED_DIVER = "Tomás Ferreira";
export const DEMO_COUNTER_BLOCKED_TRIP = "Deep Wreck Charter — the Duane on EANx";
const DEMO_COUNTER_BLOCKED_EMAIL = "tomas.ferreira@example.com";

export async function seedCounterBlockers(
  db: DbExecutor,
  shopId: string,
  ctx: {
    siteByName: Map<string, typeof diveSites.$inferSelect>;
    captainId: string | undefined;
    divemasterId: string | undefined;
  },
): Promise<void> {
  const [diver] = await db
    .insert(people)
    .values({
      shopId,
      fullName: DEMO_COUNTER_BLOCKED_DIVER,
      email: DEMO_COUNTER_BLOCKED_EMAIL,
      phone: "+351-21-555-0148",
      emergencyContactName: "Inês Ferreira (sister)",
      emergencyContactPhone: "+351-21-555-0149",
      createdAt: nextCreatedAt(),
    })
    .returning();
  if (!diver) throw new Error("seed: counter-blocked diver insert returned no row");
  await db.insert(personRoles).values({ personId: diver.id, role: "diver" as const });

  // Tomorrow, 08:00 shop-local: inside the arrivals window from the moment the
  // demo is seeded, and off today's departure board — this scenario is about
  // what the counter is chasing, not about how today's boats sailed.
  const startsAt = at(1, 8, 0);
  const endsAt = at(1, 13, 0);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      diveSiteId: ctx.siteByName.get("USCGC Duane")?.id,
      title: DEMO_COUNTER_BLOCKED_TRIP,
      description:
        "Deep wreck penetration on enriched air. AOW, Deep, and an EANx card required; paid at booking.",
      startsAt,
      endsAt,
      capacity: 8,
      plannedDives: 2,
    })
    .returning();
  if (!trip) throw new Error("seed: counter-blocked trip insert returned no row");

  await db.insert(tripScheduleDays).values({ tripId: trip.id, dayNumber: 1, startsAt, endsAt });
  await db.insert(tripDives).values([
    { tripId: trip.id, diveNumber: 1, diveSiteId: trip.diveSiteId ?? null },
    { tripId: trip.id, diveNumber: 2, diveSiteId: null },
  ]);

  // Every gate the readiness engine can raise for a non-course charter, all at
  // once. This is the one boat in the fixture that does so on purpose — its
  // whole job is to stack reasons, which is the opposite of what the four
  // cert-gate boats are for.
  await db.insert(tripRequirements).values({
    tripId: trip.id,
    shopId,
    requiresWaiver: true,
    minimumCertificationLevel: "advanced_open_water" as const,
    requiredSpecialties: ["deep"] as DiveSpecialty[],
    requiresNitrox: true,
    requiresPayment: true,
  });

  await db.insert(tripAssignments).values([
    ...(ctx.captainId
      ? [{ tripId: trip.id, personId: ctx.captainId, tripRole: "captain" as TripAssignmentRole }]
      : []),
    ...(ctx.divemasterId
      ? [
          {
            tripId: trip.id,
            personId: ctx.divemasterId,
            tripRole: "divemaster" as TripAssignmentRole,
          },
        ]
      : []),
  ]);

  // No waiver row, no certification, no specialty, no nitrox card, no paid
  // order: the seat exists and nothing else does. Five blockers — waiver,
  // level, Deep specialty, enriched air, payment — on one counter card.
  await db.insert(bookings).values({
    shopId,
    tripId: trip.id,
    personId: diver.id,
    status: "booked" as const,
    createdAt: nextCreatedAt(),
  });
}
