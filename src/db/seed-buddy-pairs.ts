import type { DbExecutor } from "./client";
import type { bookings, people, trips } from "./schema";
import { buddyPairMembers } from "./schema";
import { at } from "./seed-clock";

/**
 * Buddy teams on today's reef trip (ADR 20260804-buddy-pairs): Keiko pairs
 * two teams during morning setup, the way a divemaster actually briefs a
 * boat — Tom & Lena, Diego & June. The rest of the roster stays unpaired on
 * purpose: an odd remainder is a normal boat, never an error, and the demo
 * should show both states side by side.
 *
 * Pairs only — no roll-call events are seeded, so this scenario changes what
 * the manifest *shows* without opening any head-count gap on Today or the
 * schedule board. The divergence state ("one buddy back aboard, one not") is
 * demoed live: open the reef manifest at an after-dive checkpoint, board one
 * of a pair, and watch the pair split; board the other and watch it settle.
 *
 * Distinct `createdAt` stamps per pair keep the pairs panel's order stable
 * across re-seeds (`listTripBuddyPairs` orders by creation time; the random
 * `pair_id` would otherwise decide ties differently every seed, and the
 * visual baselines are pixel-keyed to this data).
 */
export async function seedBuddyPairs(
  db: DbExecutor,
  shopId: string,
  ctx: {
    customers: (typeof people.$inferSelect)[];
    tripRows: (typeof trips.$inferSelect)[];
    bookingRows: (typeof bookings.$inferSelect)[];
    /** Who made the call — the seeded divemaster (Keiko). */
    pairedByPersonId: string;
  },
) {
  const [reef] = ctx.tripRows;
  if (!reef) throw new Error("seed: buddy pairs need the reef trip");
  const bookingFor = (customerIndex: number) => {
    const person = ctx.customers[customerIndex];
    const booking = person
      ? ctx.bookingRows.find((row) => row.tripId === reef.id && row.personId === person.id)
      : undefined;
    if (!booking) throw new Error(`seed: no reef booking for customer ${customerIndex}`);
    return booking;
  };

  // Tom Okafor & Lena Fischer, Diego Alvarez & June Park (seed-cast.ts order).
  // Priya (blocked) and the rest stay unpaired.
  const teams: Array<{ members: [number, number]; createdAt: Date }> = [
    { members: [1, 2], createdAt: at(0, 7, 5) },
    { members: [3, 4], createdAt: at(0, 7, 10) },
  ];
  await db.insert(buddyPairMembers).values(
    teams.flatMap((team) => {
      const pairId = crypto.randomUUID();
      return team.members.map((customerIndex) => ({
        shopId,
        tripId: reef.id,
        pairId,
        bookingId: bookingFor(customerIndex).id,
        pairedByPersonId: ctx.pairedByPersonId,
        createdAt: team.createdAt,
      }));
    }),
  );
}
