import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import type { bookings, trips } from "./schema";
import { buddyPairMembers, buddyTeamEvents, people } from "./schema";
import { at } from "./seed-clock";

/**
 * Buddy teams on today's reef trip (ADR 20260804-buddy-teams): Keiko groups
 * the boat during morning setup, the way a divemaster actually briefs one —
 * a pair (Tom & Lena), and a trio she leads herself (Diego, June, and Keiko).
 * The rest of the roster stays unteamed on purpose: an odd remainder is a
 * normal boat, never an error, and the demo should show every shape side by
 * side.
 *
 * The trio is the case the *old* two-body model could not express at all. Its
 * own advice for three divers was "pair the strongest two, buddy the third with
 * a divemaster" — unrecordable, because a pair joined two bookings and crew
 * hold none. Seeding it is what makes the difference visible on the manifest,
 * the export, and the incident document without anyone having to click.
 *
 * Membership only — no roll-call events are seeded, so this scenario changes
 * what the manifest *shows* without opening any head-count gap on Today or the
 * schedule board. The divergence state ("someone back aboard, someone not") is
 * demoed live: open the reef manifest at an after-dive checkpoint, board one
 * member, and watch the team split; board the rest and watch it settle.
 *
 * The `formed` events ride along, because the trail's whole job is to outlive
 * the membership rows — a demo that seeds teams with no history would show an
 * incident export whose timeline is silent about the one fact the model exists
 * to make auditable.
 *
 * Distinct `createdAt`/`occurredAt` stamps per team keep the panel's order
 * stable across re-seeds (`listTripBuddyTeams` orders by creation time; the
 * random `pair_id` would otherwise decide ties differently every seed, and the
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
  if (!reef) throw new Error("seed: buddy teams need the reef trip");
  // The trail records names, not ids, so it needs the recorder's own — read
  // here rather than threaded through the orchestrator, which would make every
  // caller carry a field only this scenario uses.
  const [recorder] = await db
    .select({ fullName: people.fullName })
    .from(people)
    .where(eq(people.id, ctx.pairedByPersonId))
    .limit(1);
  if (!recorder) throw new Error("seed: buddy teams need a recorder");
  const customerFor = (customerIndex: number) => {
    const person = ctx.customers[customerIndex];
    const booking = person
      ? ctx.bookingRows.find((row) => row.tripId === reef.id && row.personId === person.id)
      : undefined;
    if (!person || !booking) throw new Error(`seed: no reef booking for customer ${customerIndex}`);
    return { person, booking };
  };

  // Tom Okafor & Lena Fischer; then Diego Alvarez & June Park with Keiko
  // leading (seed-cast.ts order). Priya (blocked) and the rest stay unteamed.
  const teams: Array<{ divers: number[]; withCrew: boolean; at: Date }> = [
    { divers: [1, 2], withCrew: false, at: at(0, 7, 5) },
    { divers: [3, 4], withCrew: true, at: at(0, 7, 10) },
  ];

  for (const team of teams) {
    const pairId = crypto.randomUUID();
    const members = team.divers.map(customerFor);
    await db.insert(buddyPairMembers).values([
      ...members.map(({ booking }) => ({
        shopId,
        tripId: reef.id,
        pairId,
        bookingId: booking.id,
        pairedByPersonId: ctx.pairedByPersonId,
        createdAt: team.at,
      })),
      ...(team.withCrew
        ? [
            {
              shopId,
              tripId: reef.id,
              pairId,
              crewPersonId: ctx.pairedByPersonId,
              pairedByPersonId: ctx.pairedByPersonId,
              createdAt: team.at,
            },
          ]
        : []),
    ]);
    // Names in the same display order `listTripBuddyTeams` sorts into, so the
    // seeded trail reads exactly like one a staffer's own clicks would leave.
    const memberNames = [
      ...members.map(({ person }) => person.fullName),
      ...(team.withCrew ? [recorder.fullName] : []),
    ].sort((a, b) => a.localeCompare(b));
    await db.insert(buddyTeamEvents).values({
      shopId,
      tripId: reef.id,
      pairId,
      action: "formed",
      memberNames,
      recordedByPersonId: ctx.pairedByPersonId,
      occurredAt: team.at,
    });
  }
}
