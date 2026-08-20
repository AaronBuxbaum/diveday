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
 * One diver blocked for **five** reasons at once — the case the check-in
 * counter's reason list (`src/components/today/BlockedDiverRow.tsx`) exists to
 * render in full, and which no other fixture produces: every seeded charter
 * states the shop's default Open Water gate, so the deepest stack reachable at
 * the counter was a waiver plus a card.
 *
 * Constraints this scenario has to keep:
 *
 * - **Its own departure, never a diver added to a seeded boat** (ADR
 *   20260803-seed-scenario-modules). `seed-cert-gates.ts` needs each of its four
 *   boats to refuse for *exactly one* reason; raising a gate there to stack
 *   blockers would break it.
 * - **Tomorrow**, so it falls inside the counter's arrivals window
 *   (`arrivalsWindow`: 6 h back to 36 h ahead) and off today's departure board.
 * - **Not sailed**, so it opens no head-count gap on Today or the close-out.
 * - **Adds only, called late** like `seedCertGates`/`seedBuddyPairs`, so no row
 *   seeded before it moves (`nextCreatedAt` is shared across scenarios).
 * - **7 seats left** (capacity 8, one sold): the e2e fleet matches trips by
 *   remaining seats, and 3, 6, and Full are spoken for.
 */
const DEMO_COUNTER_BLOCKED_DIVER = "Tomás Ferreira";
const DEMO_COUNTER_BLOCKED_TRIP = "Deep Wreck Charter — the Duane on EANx";
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

  // Fail loudly rather than seed a siteless boat: the site carries its own gate
  // into the readiness read, so a rename upstream would leave this fixture
  // quietly weaker and still green.
  const duane = ctx.siteByName.get("USCGC Duane");
  if (!duane) throw new Error("seed: counter-blocked trip needs the USCGC Duane dive site");

  const startsAt = at(1, 8, 0);
  const endsAt = at(1, 13, 0);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      diveSiteId: duane.id,
      title: DEMO_COUNTER_BLOCKED_TRIP,
      description:
        "Deep wreck penetration on enriched air. AOW, Deep, and an EANx certification required; paid at booking.",
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

  // Every gate the readiness engine can raise for a non-course charter at once —
  // the one boat in the fixture that may do so (see the docblock).
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

  // The seat and nothing else: no waiver row, certification, specialty, nitrox
  // card, or paid order. That absence is the fixture — five blockers on one card.
  await db.insert(bookings).values({
    shopId,
    tripId: trip.id,
    personId: diver.id,
    status: "booked" as const,
    createdAt: nextCreatedAt(),
  });
}
