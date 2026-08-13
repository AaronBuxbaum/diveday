import type { DbExecutor } from "./client";
import {
  bookings,
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
 * A departure that only runs with enough people, and is short (ADR
 * 20260813-minimum-head-count-departures).
 *
 * The long-range run is the trip a minimum head count exists for: the fuel and
 * the crew cost the same whether two divers turn up or ten, so a shop states a
 * floor and a moment it will decide by. This fixture is that trip in the state
 * a shop actually looks at it — **short, with the deadline still ahead**, which
 * is the window where ringing round the regulars still saves the day.
 *
 * Constraints this scenario has to keep:
 *
 * - **Its own departure, never a diver added to a seeded boat** (ADR
 *   20260803-seed-scenario-modules). The other fixtures pin exact seat counts
 *   and exact blocker stacks; borrowing one of their boats would break them.
 * - **Short, not due.** Four days out with a 48-hour window leaves the decision
 *   two days ahead of the fleet's frozen clock, so the demo shows the working
 *   state and the hourly sweep (`/api/cron/minimum-seats`) has nothing to do —
 *   a fixture that cancelled itself the first time the cron ran would take its
 *   own surface off the board.
 * - **Adds only, called late** like `seedCertGates`/`seedCounterBlockers`, so no
 *   row seeded before it moves (`nextCreatedAt` is shared across scenarios).
 * - **5 seats left** (capacity 8, three sold): the e2e fleet matches trips by
 *   remaining seats, and 3, 6, 7, and Full are spoken for.
 * - **No price.** Every departure on the demo board is deliberately unpriced,
 *   which is what makes the board's group-level "None of these departures has
 *   a price yet" flag the one notice rather than a pill on every row — and
 *   `schedule-builder.spec.ts` rests on exactly that. Pricing this one charter
 *   made the board mixed and quietly retired the flag. A price adds nothing to
 *   what this fixture is for, which is a head count.
 */
const DEMO_MINIMUM_TRIP = "Tortugas Run — 3 days out, 6 divers to sail";
const DEMO_MINIMUM_DIVERS = [
  { fullName: "Rosa Lindqvist", email: "rosa.lindqvist@example.com", phone: "+1-305-555-0192" },
  { fullName: "Amir Haddad", email: "amir.haddad@example.com", phone: "+1-305-555-0193" },
  { fullName: "Wren Okafor", email: "wren.okafor@example.com", phone: "+1-305-555-0194" },
] as const;

export async function seedMinimumSeats(
  db: DbExecutor,
  shopId: string,
  ctx: {
    siteByName: Map<string, typeof diveSites.$inferSelect>;
    captainId: string | undefined;
    divemasterId: string | undefined;
  },
): Promise<void> {
  // Fail loudly rather than seed a siteless boat: the same rule
  // `seedCounterBlockers` states, for the same reason — a rename upstream would
  // leave this fixture quietly weaker and still green.
  const site = ctx.siteByName.get("USCGC Duane");
  if (!site) throw new Error("seed: minimum-seat trip needs a dive site");

  const startsAt = at(4, 6, 30);
  const endsAt = at(4, 17, 0);
  const [trip] = await db
    .insert(trips)
    .values({
      shopId,
      diveSiteId: site.id,
      title: DEMO_MINIMUM_TRIP,
      description:
        "A long day offshore. We run this one with at least six divers aboard — if it hasn't filled two days out, we call it off and let everyone know.",
      startsAt,
      endsAt,
      capacity: 8,
      plannedDives: 3,
      minimumBookings: 6,
      minimumDecisionHours: 48,
    })
    .returning();
  if (!trip) throw new Error("seed: minimum-seat trip insert returned no row");

  await db.insert(tripScheduleDays).values({ tripId: trip.id, dayNumber: 1, startsAt, endsAt });
  await db.insert(tripDives).values([
    { tripId: trip.id, diveNumber: 1, diveSiteId: trip.diveSiteId ?? null },
    { tripId: trip.id, diveNumber: 2, diveSiteId: null },
    { tripId: trip.id, diveNumber: 3, diveSiteId: null },
  ]);

  // The shop's ordinary gate, nothing exotic: this fixture is about the head
  // count, and a stack of blockers on top would make its cards read as a
  // readiness scenario instead.
  await db.insert(tripRequirements).values({
    tripId: trip.id,
    shopId,
    requiresWaiver: true,
    minimumCertificationLevel: "advanced_open_water" as const,
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

  for (const diver of DEMO_MINIMUM_DIVERS) {
    const [person] = await db
      .insert(people)
      .values({ shopId, ...diver, createdAt: nextCreatedAt() })
      .returning();
    if (!person) throw new Error("seed: minimum-seat diver insert returned no row");
    await db.insert(personRoles).values({ personId: person.id, role: "diver" as const });
    await db.insert(bookings).values({
      shopId,
      tripId: trip.id,
      personId: person.id,
      status: "booked" as const,
      createdAt: nextCreatedAt(),
    });
  }
}
