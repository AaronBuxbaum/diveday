import { eq } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { activityEvents, type bookings, internalNotes, people, type trips } from "./schema";
import { at } from "./seed-clock";

/**
 * The desk's own paper trail on a departure — the Guests tab's two halves
 * (`/shop/[shopSlug]/trips/[id]/guests`): the private notes staff keep against
 * a diver's seat, and the append-only account of what has been done to the trip.
 *
 * Both tables were empty in every seeded shop, because both are written only by
 * something a *visitor* does — `addInternalNote` from the roster,
 * `recordTripActivity` from the trip page, `checkInBooking` from the counter.
 * So the surface that exists to answer "what has already happened to this
 * boat?" opened on "No activity yet", and the note affordance on the roster had
 * nothing behind it to show what a note even looks like.
 *
 * Written for **today's reef boat**, which is the departure a demo actually
 * opens. Notes and activity are pure annotation: neither is read by
 * `getBookingReadiness` or the Today queue, so today's exactly asserted
 * readiness counts and head counts are untouched by every row here. The live
 * manifest displays notes as crew context, but never uses them as a gate.
 *
 * The wording is the shop talking to itself in its own language, exactly as
 * `addInternalNote` and `recordTripActivity` store it — a name interpolated
 * into a sentence, never a translated string. That is the same shape the live
 * writers use (`${actor.name} added a private note about ${diver.name}`), and
 * it is why these rows are seeded content rather than copy: the UI renders
 * `event.message` verbatim because it is a record of something a person did,
 * not a label the product chose.
 */

/**
 * A note against a seat, by index into today's reef roster. Dated in the shop's
 * own wall clock via `at` like every other seeded instant, so the trail moves
 * with `DIVEDAY_CLOCK` rather than drifting against it — and always yesterday
 * or earlier, since "today at 09:00" is in the future for anyone who opens the
 * demo before the boat leaves.
 */
const NOTE_PLANS: {
  rosterIndex: number;
  daysAgo: number;
  hour: number;
  body: (diver: string) => string;
}[] = [
  {
    rosterIndex: 2,
    daysAgo: 3,
    hour: 16,
    body: (diver) => `${diver} rang ahead — first boat dive in a while, wants a slow descent.`,
  },
  {
    rosterIndex: 4,
    daysAgo: 1,
    hour: 11,
    body: (diver) => `${diver} is bringing their own computer, so only the reg set is needed.`,
  },
  {
    rosterIndex: 6,
    daysAgo: 1,
    hour: 17,
    body: (diver) => `Parking sorted for ${diver}; they are meeting us at the fuel dock instead.`,
  },
];

/** What has been done to the boat. */
const ACTIVITY_PLANS: { daysAgo: number; hour: number; line: (actor: string) => string }[] = [
  { daysAgo: 4, hour: 9, line: (actor) => `${actor} confirmed the charter with the captain` },
  {
    daysAgo: 2,
    hour: 14,
    line: (actor) => `${actor} moved the second dive to French Reef for the swell`,
  },
  { daysAgo: 1, hour: 15, line: (actor) => `${actor} checked the tank count against the roster` },
  {
    daysAgo: 1,
    hour: 18,
    line: (actor) => `${actor} briefed the crew on the two course students aboard`,
  },
];

export async function seedDeskTrail(
  db: DbExecutor,
  shopId: string,
  ctx: {
    /** Today's headline departure — the first trip the trips scenario seeded. */
    trip: typeof trips.$inferSelect;
    /** Its roster, in the order the trip scenario booked it. */
    roster: (typeof bookings.$inferSelect)[];
    divers: (typeof people.$inferSelect)[];
    /** The staffer whose desk this is, and whose name the trail carries. */
    actorPersonId: string;
  },
): Promise<void> {
  // Looked up rather than passed in: the trail is written in the actor's own
  // name, and the canonical demo and a minted one give their staff different
  // rows. Same reason `seedDemoSchedule` looks the instructor up by role.
  const [actor] = await db
    .select({ id: people.id, fullName: people.fullName })
    .from(people)
    .where(eq(people.id, ctx.actorPersonId))
    .limit(1);
  if (!actor) return;
  const tripRoster = ctx.roster.filter((booking) => booking.tripId === ctx.trip.id);
  const diverName = (personId: string) =>
    ctx.divers.find((person) => person.id === personId)?.fullName ?? null;

  const noteRows = NOTE_PLANS.map((plan) => {
    const booking = tripRoster[plan.rosterIndex];
    if (!booking) return null;
    const diver = diverName(booking.personId);
    if (!diver) return null;
    return {
      shopId,
      personId: booking.personId,
      bookingId: booking.id,
      body: plan.body(diver),
      createdByPersonId: actor.id,
      createdAt: at(-plan.daysAgo, plan.hour, (plan.rosterIndex * 11) % 60),
    };
  }).filter((row): row is NonNullable<typeof row> => row !== null);
  if (noteRows.length > 0) await db.insert(internalNotes).values(noteRows);

  // One activity line per note, the way `addInternalNote` writes them, plus the
  // trip-level work. Seeded in chronological order so `seq` — which is what
  // breaks the tie when the frozen clock gives two events the same instant —
  // records the order a reader should see them in.
  const noteEvents = noteRows.map((note) => ({
    shopId,
    tripId: ctx.trip.id,
    bookingId: note.bookingId,
    actorPersonId: actor.id,
    message: `${actor.fullName} added a private note about ${diverName(note.personId)}`,
    occurredAt: note.createdAt,
  }));
  const tripEvents = ACTIVITY_PLANS.map((plan, index) => ({
    shopId,
    tripId: ctx.trip.id,
    bookingId: null,
    actorPersonId: actor.id,
    message: plan.line(actor.fullName),
    occurredAt: at(-plan.daysAgo, plan.hour, (index * 17) % 60),
  }));
  const events = [...noteEvents, ...tripEvents].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );
  if (events.length > 0) await db.insert(activityEvents).values(events);
}
