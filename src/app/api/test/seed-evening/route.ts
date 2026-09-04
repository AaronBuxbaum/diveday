import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { bookings, rollCallCrewEvents, rollCallEvents, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listStaff } from "@/db/trips";
import { liveTrip } from "@/db/trips-live";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import { rollCallCheckpoints } from "@/lib/roll-call";
import { shopDayBounds } from "@/lib/zoned";

/** Every seeded departure gets the same length here — the shape is the point, not the duration. */
const DEPARTURE_MS = 2 * HOUR_MS;
/** Gap between one boat tying up and the next one sailing. */
const TURNAROUND_MS = 30 * 60 * 1000;
/**
 * How far behind `now` the last boat ties up. Two hours clears the standing
 * one-hour late-arrival buffer with an hour to spare, so the state this route
 * produces cannot become flaky by sitting near the boundary it is about.
 */
const SETTLED_MARGIN_MS = 2 * HOUR_MS;

/** One departure this route moved, with what closing its count needs to know. */
type MovedDeparture = {
  id: string;
  plannedDives: number;
  startsAt: Date;
  endsAt: Date;
};

/** The latest state a subject holds at a checkpoint; `undefined` is awaiting. */
type LatestState = "boarded" | "not_boarded" | undefined;

/**
 * Puts the seeded demo shop into its **evening**: every departure of the shop
 * day already home, which is the one state the closing block renders in.
 *
 * ## Why this is a route and not seed data, and not the clock
 *
 * The evening is the shop home's own state once every departure of the day has
 * settled (ADR 20260827-clearwater-surface-language, decision 4). The seeded
 * demo day is deliberately mid-morning — a boat home, a boat out, a night dive
 * ahead — because that is the shape the *morning* reading needs, and it is the
 * shape almost every other spec asserts against. Both readings are real, and
 * one seed cannot be both.
 *
 * The clock cannot answer it either: `DIVEDAY_CLOCK` is a single process-wide
 * value shared by the server, the seed and the browser (`e2e/servers.ts`), so
 * moving it to an evening instant moves it for every test in the worker.
 *
 * So the departures move instead. Each of today's is laid out back to back,
 * two hours long, with the last one tying up {@link SETTLED_MARGIN_MS} before
 * `now` — inside the shop's own calendar day throughout, because a trip pushed
 * out of it stops being today's departure at all and the spine would go quiet
 * rather than settle.
 *
 * ## `?heads=closed` — the evening after the counting
 *
 * Two evenings are real and the difference between them is the whole point of
 * the closing block, so this route seeds both rather than picking one.
 *
 * Without the parameter the boats are simply home: they tied up, and nobody
 * has been counted back off them yet. That is the ordinary evening a shop
 * meets when it opens the home at six, and it is what `today-evening` has
 * always photographed.
 *
 * With `?heads=closed` every open count on those departures is closed, which
 * is the state the day is *finished* in — and the only one the spine spends
 * its single coral element on (`spine.allHome`, ADR 20260901-diveday-reimagined
 * decision 1). `assembleEveningClose` will not say it on arithmetic: every
 * station's status has to be `all_home`, because "10 out, 10 back" over a boat
 * nobody counted is a claim the shop's own records do not support. So the only
 * way to photograph that moment is to do the counting.
 *
 * Safe to mutate freely because of the fleet's topology (`e2e/servers.ts`):
 * each Playwright worker has its own `next start` server on its own port
 * backed by its own in-memory PGlite database, and `e2e/fixtures.ts` resets
 * that database before every test. Gated identically to /api/test/reset — and,
 * like every route here, it resolves the shop itself from `DEMO_SHOP_SLUG` and
 * refuses a shop that is not `isDemo`, rather than taking an id from the
 * caller.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_available" }, { status: 404 });

  const now = nowDate();
  const bounds = shopDayBounds(now, shop.timezone);
  const today = await db
    .select({ id: trips.id, plannedDives: trips.plannedDives })
    .from(trips)
    .where(
      and(
        liveTrip(),
        eq(trips.shopId, shop.id),
        eq(trips.status, "scheduled"),
        gte(trips.startsAt, bounds.from),
        lt(trips.startsAt, bounds.to),
      ),
    )
    .orderBy(asc(trips.startsAt));

  // Latest first, so the last boat of the day is the one that ties up closest
  // to `now` and the earlier ones stack backwards from it.
  const lastEnd = now.getTime() - SETTLED_MARGIN_MS;
  const moved: MovedDeparture[] = [];
  for (const [index, trip] of [...today].reverse().entries()) {
    const endsAt = new Date(lastEnd - index * (DEPARTURE_MS + TURNAROUND_MS));
    const startsAt = new Date(endsAt.getTime() - DEPARTURE_MS);
    if (startsAt < bounds.from) break;
    await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, trip.id));
    moved.push({ id: trip.id, plannedDives: trip.plannedDives, startsAt, endsAt });
  }
  moved.reverse();

  const closed =
    new URL(request.url).searchParams.get("heads") === "closed"
      ? await closeHeadCounts(db, shop.id, moved)
      : null;

  return NextResponse.json({
    ok: true,
    moved: moved.length,
    closed,
    departures: moved.map((trip) => ({
      id: trip.id,
      startsAt: trip.startsAt.toISOString(),
      endsAt: trip.endsAt.toISOString(),
    })),
  });
}

/**
 * Close every open head count on the departures just moved, the way a crew
 * does: by appending results to the trail, never by rewriting it.
 *
 * ## What it will and will not record
 *
 * A **no-show** — the latest result at `departure` is `not_boarded` — is left
 * exactly as it stands. That is not an open count, it is a closed one whose
 * answer was "they never came"; `inAfterDivePopulation` (src/db/today.ts)
 * already leaves those bookings out of every after-dive scan, so nothing is
 * waiting on them. Writing a `boarded` over it would be inventing a diver onto
 * a boat, which is the one thing a seed route holding safety history must not
 * do.
 *
 * A **missing diver** — `not_boarded` at an after-dive checkpoint — is
 * resolved rather than skipped, with a later `boarded`. That is a real act and
 * a common one: the alarm says nobody could account for them at the time, and
 * the tap that follows says they turned up. It is also the only honest way to
 * reach the state this parameter names, since a standing alarm is precisely
 * what `all_home` refuses to be said over.
 *
 * **Crew are counted only where the shop already counts them.** The crew
 * roster for a head count is whoever has a crew result on the trip, so a shop
 * that has never tapped one has no crew subjects at all
 * (`listRollCallGaps`). Inserting crew events where there were none would
 * manufacture a population — and then a gap — rather than close one.
 *
 * Returns the number of events written.
 */
async function closeHeadCounts(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  departures: readonly MovedDeparture[],
): Promise<number> {
  if (departures.length === 0) return 0;
  const tripIds = departures.map((trip) => trip.id);

  // Any of the shop's staff: this is a seeded record of who did the counting,
  // and `recorded_by_person_id` is a display field on the manifest rather than
  // anything a head count is derived from.
  const [staff] = await listStaff(db, shopId);
  if (!staff) return 0;
  const recordedByPersonId = staff.person.id;

  const [roster, events, crewEvents] = await Promise.all([
    db
      .select({ tripId: bookings.tripId, bookingId: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.shopId, shopId),
          inArray(bookings.tripId, tripIds),
          ne(bookings.status, "cancelled"),
        ),
      ),
    db
      .select({
        bookingId: rollCallEvents.bookingId,
        checkpoint: rollCallEvents.checkpoint,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shopId), inArray(rollCallEvents.tripId, tripIds)))
      // Oldest first, so the last row read per subject and checkpoint is the
      // one that stands — the same order every reader of this trail uses.
      .orderBy(
        asc(rollCallEvents.occurredAt),
        asc(rollCallEvents.createdAt),
        asc(rollCallEvents.seq),
      ),
    db
      .select({
        tripId: rollCallCrewEvents.tripId,
        personId: rollCallCrewEvents.personId,
        checkpoint: rollCallCrewEvents.checkpoint,
        status: rollCallCrewEvents.status,
        occurredAt: rollCallCrewEvents.occurredAt,
      })
      .from(rollCallCrewEvents)
      .where(
        and(eq(rollCallCrewEvents.shopId, shopId), inArray(rollCallCrewEvents.tripId, tripIds)),
      )
      .orderBy(
        asc(rollCallCrewEvents.occurredAt),
        asc(rollCallCrewEvents.createdAt),
        asc(rollCallCrewEvents.seq),
      ),
  ]);

  const latestByBooking = new Map<string, (typeof events)[number]>();
  for (const event of events) latestByBooking.set(`${event.bookingId}\0${event.checkpoint}`, event);
  const latestByCrew = new Map<string, (typeof crewEvents)[number]>();
  const crewByTrip = new Map<string, Set<string>>();
  for (const event of crewEvents) {
    latestByCrew.set(`${event.tripId}\0${event.personId}\0${event.checkpoint}`, event);
    const people = crewByTrip.get(event.tripId) ?? new Set<string>();
    people.add(event.personId);
    crewByTrip.set(event.tripId, people);
  }

  const rosterByTrip = new Map<string, string[]>();
  for (const row of roster) {
    const list = rosterByTrip.get(row.tripId) ?? [];
    list.push(row.bookingId);
    rosterByTrip.set(row.tripId, list);
  }

  const diverRows: (typeof rollCallEvents.$inferInsert)[] = [];
  const crewRows: (typeof rollCallCrewEvents.$inferInsert)[] = [];

  for (const trip of departures) {
    const checkpoints = rollCallCheckpoints(trip.plannedDives);
    // Spread across the departure's own window rather than a fixed spacing, so
    // every result lands between the lines cast off and the boat tying up
    // however many dives the trip planned.
    const step = (trip.endsAt.getTime() - trip.startsAt.getTime()) / checkpoints.length;

    /**
     * What to write at each checkpoint for one subject, or `null` to leave the
     * subject alone. `standing` reads the result that currently holds.
     */
    const results = (standing: (checkpoint: string) => LatestState) => {
      // A recorded no-show is an answer, not an open count. See the docblock.
      if (standing("departure") === "not_boarded") return null;
      const writes: { checkpoint: string; occurredAt: Date }[] = [];
      for (const [index, checkpoint] of checkpoints.entries()) {
        const current = standing(checkpoint);
        // Already boarded here: nothing to close.
        if (current === "boarded") continue;
        const at = new Date(trip.startsAt.getTime() + index * step);
        writes.push({ checkpoint, occurredAt: at });
      }
      return writes;
    };

    for (const bookingId of rosterByTrip.get(trip.id) ?? []) {
      const standing = (checkpoint: string): LatestState => {
        const event = latestByBooking.get(`${bookingId}\0${checkpoint}`);
        return !event || event.status === "cleared" ? undefined : event.status;
      };
      for (const write of results(standing) ?? []) {
        const held = latestByBooking.get(`${bookingId}\0${write.checkpoint}`);
        diverRows.push({
          shopId,
          tripId: trip.id,
          bookingId,
          recordedByPersonId,
          status: "boarded",
          checkpoint: write.checkpoint,
          source: "live",
          // Never behind the result it supersedes: ordering is by
          // `occurred_at` first, and `seq` only breaks a tie.
          occurredAt: heldLater(write.occurredAt, held?.occurredAt),
        });
      }
    }

    for (const personId of crewByTrip.get(trip.id) ?? []) {
      const standing = (checkpoint: string): LatestState => {
        const event = latestByCrew.get(`${trip.id}\0${personId}\0${checkpoint}`);
        return !event || event.status === "cleared" ? undefined : event.status;
      };
      for (const write of results(standing) ?? []) {
        const held = latestByCrew.get(`${trip.id}\0${personId}\0${write.checkpoint}`);
        crewRows.push({
          shopId,
          tripId: trip.id,
          personId,
          recordedByPersonId,
          status: "boarded",
          checkpoint: write.checkpoint,
          source: "live",
          occurredAt: heldLater(write.occurredAt, held?.occurredAt),
        });
      }
    }
  }

  if (diverRows.length > 0) await db.insert(rollCallEvents).values(diverRows);
  if (crewRows.length > 0) await db.insert(rollCallCrewEvents).values(crewRows);
  return diverRows.length + crewRows.length;
}

/** The later of a computed instant and the one it has to supersede. */
function heldLater(computed: Date, held: Date | undefined): Date {
  return held && held.getTime() > computed.getTime() ? held : computed;
}
