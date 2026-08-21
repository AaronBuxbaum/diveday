import { inArray } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { activityEvents, type bookings, people } from "./schema";
import { at } from "./seed-clock";

/**
 * The desk's paper trail **per diver** — what the shop has done about a person,
 * across every departure they hold a seat on.
 *
 * `seed-desk-trail.ts` is the same table read the other way round: it writes
 * today's reef boat a history, for the Guests tab that asks "what has been done
 * to this departure?". Neither of those rows helps the diver record, which asks
 * the opposite question and, until the Activity section shipped, had no answer
 * at all — every diver in the demo opened on an empty panel.
 *
 * So this is one scenario per **person**: a handful of the cast get a plausible
 * desk story attached to their own seats — the deposit, the release, the card
 * check, the suit pulled off the rack, the phone call about a changed time.
 * Priya Sharma gets a long one deliberately (she is the record every visual
 * baseline photographs, and the only diver whose trail runs past one page, so
 * the section's pager is a rendered thing rather than a claim).
 *
 * **Annotation only.** `activity_events` is read by the Guests tab's collapsed
 * log and by the diver record, and by nothing else: not readiness, not the
 * manifest, not Today, not a head count. Every row here is additive and moves
 * no other seeded fact — the same contract `seed-desk-trail.ts` states and the
 * reason both can be safely last.
 *
 * Wording is the shop talking to itself, exactly as `recordTripActivity` stores
 * it: a name interpolated into a sentence, never a translated string. The UI
 * prints `event.message` verbatim because it is a record of something a person
 * did, not a label the product chose.
 */

/**
 * The desk's vocabulary, oldest-sounding first. A diver takes the first `n` of
 * these; nobody takes them in a different order, so two divers' trails rhyme
 * the way a real shop's do without reading as copy-paste.
 */
const DESK_LINES: ((actor: string, diver: string) => string)[] = [
  (actor, diver) => `${actor} took ${diver}'s deposit at the counter`,
  (actor, diver) => `${actor} sent ${diver} their release to sign`,
  (actor, diver) => `${actor} confirmed ${diver}'s release came back signed`,
  (actor, diver) => `${actor} checked ${diver}'s card number against the agency register`,
  (actor, diver) => `${actor} put ${diver} down for a 3 mm suit and a reg set`,
  (actor, diver) => `${actor} rang ${diver} about the earlier check-in time`,
  (actor, diver) => `${actor} moved ${diver} to the second boat to dive with their buddy`,
  (actor, diver) => `${actor} walked ${diver} through the site briefing at the shop`,
  (actor, diver) => `${actor} took the balance off ${diver} in cash`,
  (actor, diver) => `${actor} noted ${diver} is driving down the morning of`,
  (actor, diver) => `${actor} swapped ${diver} onto a smaller BCD after the fit check`,
  (actor, diver) => `${actor} logged ${diver}'s nitrox card off the plastic`,
  (actor, diver) => `${actor} confirmed ${diver} is bringing their own computer`,
  (actor, diver) => `${actor} reminded ${diver} to bring the paper card to the dock`,
];

/**
 * Which of the cast get a trail, by their index in `customerDefs`
 * (`seed-cast.ts`), and how many lines each.
 *
 * Indexes rather than names because the roster indexes into that same list
 * everywhere else in the seed, and a name typed twice is a name that can drift.
 * Priya (index 0) is first and longest for the reason in the module docstring.
 */
const TRAIL_PLANS: { diverIndex: number; lines: number }[] = [
  { diverIndex: 0, lines: 13 },
  { diverIndex: 1, lines: 5 },
  { diverIndex: 3, lines: 4 },
  { diverIndex: 4, lines: 6 },
  { diverIndex: 6, lines: 3 },
  { diverIndex: 8, lines: 4 },
  { diverIndex: 12, lines: 5 },
  { diverIndex: 15, lines: 3 },
];

export async function seedDiverTrail(
  db: DbExecutor,
  shopId: string,
  ctx: {
    /** Every seat the seed has sold, in the order the trip scenarios booked them. */
    roster: (typeof bookings.$inferSelect)[];
    /** The cast, in `customerDefs` order — `TRAIL_PLANS` indexes into this. */
    divers: (typeof people.$inferSelect)[];
    /**
     * The staff whose names the trail carries, in the order lines rotate
     * through them. Looked up here rather than passed as names: the canonical
     * demo and a minted one give their staff different rows, and a trail has to
     * name the people this shop actually has.
     */
    actorPersonIds: string[];
  },
): Promise<void> {
  const actorIds = ctx.actorPersonIds.filter(Boolean);
  if (actorIds.length === 0) return;
  const actors = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(inArray(people.id, actorIds));
  // Back into the caller's order: `inArray` answers in whatever order the plan
  // returns, and the trail should rotate through the crew the same way on every
  // seed or the visual baselines move for no reason.
  const crew = actorIds
    .map((id) => actors.find((actor) => actor.id === id))
    .filter((actor): actor is (typeof actors)[number] => actor !== undefined);
  if (crew.length === 0) return;

  const rows: (typeof activityEvents.$inferInsert)[] = [];
  for (const [planIndex, plan] of TRAIL_PLANS.entries()) {
    const diver = ctx.divers[plan.diverIndex];
    if (!diver) continue;
    const seats = ctx.roster.filter((booking) => booking.personId === diver.id);
    if (seats.length === 0) continue;
    for (let line = 0; line < plan.lines; line++) {
      const template = DESK_LINES[line % DESK_LINES.length];
      const seat = seats[line % seats.length];
      const actor = crew[(planIndex + line) % crew.length];
      if (!template || !seat || !actor) continue;
      rows.push({
        shopId,
        // The line belongs to the departure the seat is on, so it reads in that
        // boat's own log too — a shop keeps one trail, not two.
        tripId: seat.tripId,
        bookingId: seat.id,
        actorPersonId: actor.id,
        message: template(actor.fullName, diver.fullName),
        // Oldest first and always in the past: "today at 09:00" is in the
        // future for anyone opening the demo before the boat leaves. Two days
        // apart, staggered per diver, so no two lines tie and the whole trail
        // moves with `DIVEDAY_CLOCK` rather than drifting against it.
        occurredAt: at(-((plan.lines - line) * 2 + planIndex), 8 + (line % 9), (line * 13) % 60),
      });
    }
  }
  if (rows.length === 0) return;
  // Chronological, so `seq` — the tiebreaker when the frozen e2e clock hands
  // two events one instant — records the order a reader should see them in.
  rows.sort((a, b) => (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime());
  await db.insert(activityEvents).values(rows);
}
