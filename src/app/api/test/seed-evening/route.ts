import { and, asc, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { bookings, rollCallCrewEvents, rollCallEvents, tripAssignments, trips } from "@/db/schema";
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
 * **This is a fixture, and the day it makes is not reachable through the
 * product.** It inserts into `roll_call_events` directly, so it walks past the
 * gate `recordRollCall` puts on a `boarded` at the dock — the shared readiness
 * service has to prove the diver ready at the moment staff board them, and the
 * seeded day deliberately contains divers who are not (an unconfirmed identity
 * on the night charter, the blocked seats the *morning* reading exists to
 * show). A shop could not close this day by tapping; the picture is of the
 * state, not of a path to it. Said here because the alternative is a reader
 * inferring that the gate is optional.
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

  const close =
    new URL(request.url).searchParams.get("heads") === "closed"
      ? await closeHeadCounts(db, shop.id, moved)
      : null;
  // A day that cannot be honestly closed is a refusal, not a partial success.
  // The caller is a visual spec, and the alternative to a 409 naming the trip
  // and the checkpoint is a picture that is quietly of the wrong state.
  if (close && !close.ok) return NextResponse.json(close, { status: 409 });

  return NextResponse.json({
    ok: true,
    moved: moved.length,
    // Events written, not counts closed — `null` when nobody asked for any,
    // which is a different fact from having tried and written none.
    eventsWritten: close ? close.eventsWritten : null,
    departures: moved.map((trip) => ({
      id: trip.id,
      startsAt: trip.startsAt.toISOString(),
      endsAt: trip.endsAt.toISOString(),
    })),
  });
}
/**
 * What closing the day's counts did, or the reason the day cannot be closed.
 *
 * A refusal rather than a best effort: this route's whole job is to produce one
 * exact state, and a caller that gets `ok: true` over a day still holding an
 * open alarm would photograph the wrong picture and never know.
 */
type CloseOutcome =
  | { ok: true; eventsWritten: number }
  | { ok: false; reason: "alarm_standing"; tripId: string; checkpoint: string; subject: string };

/**
 * Close every open head count on the departures just moved, the way a crew
 * does: by appending results to the trail, never by contradicting it.
 *
 * ## The one rule
 *
 * **Never write over a recorded answer.** Everything below is that rule met by
 * a different shape of evidence, and it is worth stating as the rule because
 * the route does happily invent a `boarded` for a booking nobody answered for
 * — which on the demo shop is most of the roster.
 *
 * A **no-show** — `not_boarded` at the dock with nothing after it — is a
 * recorded answer, so it stands. It is not an open count: it is a closed one
 * whose answer was "they never came", and `inAfterDivePopulation`
 * (`src/db/today.ts`) leaves those bookings out of every after-dive scan, so
 * nothing is waiting on them. A diver marked not-boarded at the dock who
 * nevertheless carries a later result is a different person entirely — they
 * joined at the second site — and they *are* in that population, so they are
 * counted like anybody else. The predicate here is the same one, deliberately.
 *
 * A **missing diver or missing crew member** — a standing `not_boarded` at an
 * after-dive checkpoint — makes this route **refuse**. That row is the loudest
 * thing in the product: a human looked at the water and said a body did not
 * come back. Resolving it in a loop is exactly the shape the real surface
 * refuses to offer — asserting aboard over a stated "not back aboard" needs a
 * confirming second tap naming the person, on a separate control, so that a
 * wet thumb on a rolling boat cannot turn that row green by bouncing. A
 * fixture whose job is a clean day says "this day is not clean" rather than
 * cleaning it, and a test that fails with the trip and the checkpoint in the
 * message is worth more than a picture that was quietly wrong.
 *
 * ## Who gets counted
 *
 * Divers are every non-cancelled booking. **Crew are the trip's assigned
 * crew** — `trip_assignments` — and not merely whoever already has a crew
 * result on it. That distinction was the bug in the first version of this: no
 * seed in the repository writes a `roll_call_crew_events` row, so "whoever has
 * a result" was empty on every departure, no crew rows were written, and the
 * day reached `allHome` on the shop home while every one of its manifests
 * still read `crew_awaiting`. `rollCallCompleteness` (`src/lib/manifests.ts`)
 * counts the *assigned* crew and says why: a checkpoint satisfied without them
 * "hands back exactly the silent pass this whole check exists to remove". The
 * people most reliably still in the water at the end of a day are the crew.
 */
async function closeHeadCounts(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  departures: readonly MovedDeparture[],
): Promise<CloseOutcome> {
  if (departures.length === 0) return { ok: true, eventsWritten: 0 };
  const tripIds = departures.map((trip) => trip.id);

  // Any of the shop's staff: this is a seeded record of who did the counting,
  // and `recorded_by_person_id` is a display field on the manifest rather than
  // anything a head count is derived from.
  const [staff] = await listStaff(db, shopId);
  if (!staff) return { ok: true, eventsWritten: 0 };
  const recordedByPersonId = staff.person.id;

  const [roster, crewRoster, events, crewEvents] = await Promise.all([
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
    // Tenancy through `trips`: `trip_assignments` carries no `shop_id` of its
    // own (CR-007), so the trip id alone must never reach a roster.
    db
      .select({ tripId: tripAssignments.tripId, personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(trips, eq(trips.id, tripAssignments.tripId))
      .where(and(liveTrip(), eq(trips.shopId, shopId), inArray(tripAssignments.tripId, tripIds))),
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
  for (const event of crewEvents) {
    latestByCrew.set(`${event.tripId}\0${event.personId}\0${event.checkpoint}`, event);
  }

  const byTrip = <T extends { tripId: string }, K>(rows: readonly T[], pick: (row: T) => K) => {
    const map = new Map<string, K[]>();
    for (const row of rows) {
      const list = map.get(row.tripId) ?? [];
      list.push(pick(row));
      map.set(row.tripId, list);
    }
    return map;
  };
  const rosterByTrip = byTrip(roster, (row) => row.bookingId);
  const crewByTrip = byTrip(crewRoster, (row) => row.personId);

  const diverRows: (typeof rollCallEvents.$inferInsert)[] = [];
  const crewRows: (typeof rollCallCrewEvents.$inferInsert)[] = [];

  for (const trip of departures) {
    const checkpoints = rollCallCheckpoints(trip.plannedDives);
    // Spread across the departure's own window rather than a fixed spacing, so
    // every result lands between the lines cast off and the boat tying up
    // however many dives the trip planned.
    const step = (trip.endsAt.getTime() - trip.startsAt.getTime()) / checkpoints.length;

    /**
     * What to write at each checkpoint for one subject: `null` to leave the
     * subject alone, or an alarm that stops the whole route. `standing` reads
     * the result that currently holds at a checkpoint.
     */
    const results = (
      subject: string,
      standing: (checkpoint: string) => LatestState,
    ): { checkpoint: string; occurredAt: Date }[] | null | CloseOutcome => {
      // A recorded no-show is an answer, not an open count — but only while it
      // is their *whole* answer. `inAfterDivePopulation`, in one line.
      const afterDive = checkpoints.slice(1);
      const joinedLater = afterDive.some((checkpoint) => standing(checkpoint) !== undefined);
      if (standing("departure") === "not_boarded" && !joinedLater) return null;
      const writes: { checkpoint: string; occurredAt: Date }[] = [];
      for (const [index, checkpoint] of checkpoints.entries()) {
        const current = standing(checkpoint);
        // Already boarded here: nothing to close.
        if (current === "boarded") continue;
        if (current === "not_boarded") {
          // Only an after-dive checkpoint can reach here — a dock `not_boarded`
          // returned above unless the subject joined later, and a subject who
          // joined later was never off the boat at the dock in the sense this
          // refusal is about.
          if (index === 0) continue;
          return { ok: false, reason: "alarm_standing", tripId: trip.id, checkpoint, subject };
        }
        writes.push({ checkpoint, occurredAt: new Date(trip.startsAt.getTime() + index * step) });
      }
      return writes;
    };

    for (const bookingId of rosterByTrip.get(trip.id) ?? []) {
      const standing = (checkpoint: string): LatestState => {
        const event = latestByBooking.get(`${bookingId}\0${checkpoint}`);
        return !event || event.status === "cleared" ? undefined : event.status;
      };
      const outcome = results(bookingId, standing);
      if (outcome !== null && !Array.isArray(outcome)) return outcome;
      for (const write of outcome ?? []) {
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
      const outcome = results(personId, standing);
      if (outcome !== null && !Array.isArray(outcome)) return outcome;
      for (const write of outcome ?? []) {
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
  return { ok: true, eventsWritten: diverRows.length + crewRows.length };
}

/** The later of a computed instant and the one it has to supersede. */
function heldLater(computed: Date, held: Date | undefined): Date {
  return held && held.getTime() > computed.getTime() ? held : computed;
}
