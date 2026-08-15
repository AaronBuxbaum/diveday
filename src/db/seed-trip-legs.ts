import { and, eq, gte, inArray } from "drizzle-orm";
import { nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { tripDives, trips } from "./schema";

/**
 * **How far the boat actually runs, on the three departures where the answer is
 * not "the shop's usual twenty minutes"** (`trip_dives.travel_minutes`, ADR
 * 20260815-per-leg-travel-minutes).
 *
 * Every seeded `trip_dives` row left `travel_minutes` null until this module,
 * so every departure in the demo fell back to `shops.boat_ride_minutes` (20) and
 * the diver's "Your dock-day rhythm" list rendered the exact shape it rendered
 * before the column existed. A shop owner clicking through the demo — or a
 * screenshot in a pitch — saw the house reef and a long-range Tortugas run
 * described as the same morning, which is the uniform wrongness the feature was
 * built to end.
 *
 * **Updates only, and late.** It writes no rows of its own: it reads three
 * departures other scenarios already own and sets one nullable column on their
 * existing dives. That is deliberately the shape ADR 20260803-seed-scenario-
 * modules asks for — a content decision about this shop's geography, made once,
 * in one file — without wedging anything into `seed-trips.ts` or
 * `seed-minimum-seats.ts`, which are two of the repo's worst conflict magnets.
 * Because nothing is inserted, the shared `nextCreatedAt()` counter never moves
 * and no row seeded before it changes.
 *
 * **Most of the board keeps its nulls on purpose.** The fallback to the shop's
 * own figure is a real state — it is what every existing shop reads on the
 * morning this shipped, and what most departures will always read — so
 * `seed-more-trips.ts`'s whole fortnight, the Benwood boat, the Christ of the
 * Abyss morning and every course session are left alone, and the demo shows
 * both halves of the model.
 *
 * **The canonical demo only, never a minted one** (the history flag, which is
 * also what the lean unit-test template runs without). A minted demo shop is the
 * lean schedule by design — no history, no orders, no last-minute list — and it
 * is also the shop a spec takes when it needs to own a shop's whole
 * configuration (`privateShop`, ADR 20260815-per-test-private-shops). A leg on
 * one of *those* departures silently defeats the shop-level setting such a spec
 * is testing, because a stated leg beats `shops.boat_ride_minutes` — which is
 * the entire point of the column. It is not hypothetical: seeding these
 * unconditionally made `e2e/dock-day-rhythm.spec.ts`'s "shop that walks in off
 * the beach" read a fifteen-minute ride out on a shop that had just set the ride
 * to zero, and the shop was right. Per-leg travel is content a shop fills in
 * over time; a starter schedule should read exactly the numbers its owner typed.
 */

/**
 * Minutes per leg, dive 1 first: from the dock for dive one, from the previous
 * dive's site after that. Distances are the real Florida Keys ones the seeded
 * sites name (`src/db/dive-site-templates.ts`), not arithmetic on coordinates —
 * the ADR declines that outright, because a shop's own figure includes the
 * captain's judgement about the run, not the distance.
 *
 * The three are chosen so the demo shows the three shapes the rule has:
 *
 * - **the two-tank reef morning** — Molasses is fifteen minutes off the dock and
 *   French Reef is the next mooring down the line, so the ride out is *shorter*
 *   than the shop's twenty and the hop across is shorter still. Nothing about
 *   the rendered beats changes (a leg under the 60-minute surface interval is
 *   swallowed by it), which is exactly the point: a shop filling these in for
 *   its house reef should see its day tighten, not rearrange.
 * - **the wreck charter** — a genuinely long steam out to the Spiegel Grove, and
 *   then `0` for the second leg, because both dives are on the same mooring.
 *   Zero is a real answer here rather than "unstated" (`LegTravelTimes`), and
 *   this is the one departure in the demo that says so.
 * - **the Tortugas run** — the long-range day, and the only seeded departure
 *   whose *second* leg is longer than the shop's surface interval. That is the
 *   one shape that changes which beat a diver reads: the gap between two dives
 *   is `max(surfaceInterval, travel)`, so at 75 minutes the window is named
 *   "Ride to the next site" instead of "Surface interval". Nothing else in the
 *   demo exercises it.
 */
const LEG_TRAVEL_MINUTES: Record<string, readonly number[]> = {
  "Two-Tank Reef — Molasses & French": [15, 10],
  "Wreck Trip — Spiegel Grove": [40, 0],
  "Tortugas Run — 3 days out, 6 divers to sail": [120, 75, 25],
};

export async function seedTripLegs(
  db: DbExecutor,
  shopId: string,
  includeHistoryData: boolean,
  now = nowDate(),
): Promise<void> {
  if (!includeHistoryData) return;
  const titles = Object.keys(LEG_TRAVEL_MINUTES);
  // **Upcoming only, and this is not a nicety.** `seed-history.ts` back-fills a
  // trailing quarter of sailed departures under these *same titles* — three more
  // "Two-Tank Reef — Molasses & French" and three more "Wreck Trip — Spiegel
  // Grove" — so a lookup by title alone reaches trips that already happened.
  // They carry no `trip_dives` rows today, which is the only reason a title-only
  // match would have been a silent no-op rather than a wrong answer; a back-fill
  // that ever gained a dive plan would have started rewriting history.
  const departures = await db
    .select({ id: trips.id, title: trips.title })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), inArray(trips.title, titles), gte(trips.startsAt, now)));

  // Fail loudly rather than seed a demo that quietly went back to twenty
  // minutes everywhere — the same rule `seedMinimumSeats` states about its
  // dive site, for the same reason. These titles are owned by other scenario
  // modules, so a rename over there is the one way this can silently stop
  // doing anything, and a silent no-op is precisely the failure the follow-up
  // behind this module was filed about.
  const found = new Set(departures.map((departure) => departure.title));
  const missing = titles.filter((title) => !found.has(title));
  if (missing.length > 0) {
    throw new Error(
      `seed: per-leg travel names departures that do not exist: ${missing.join(", ")}`,
    );
  }

  // Sequential, never `Promise.all`: this can be handed a transaction, and a
  // drizzle transaction is one checked-out client
  // (`scripts/check-db-concurrency.mjs`).
  for (const departure of departures) {
    const legs = LEG_TRAVEL_MINUTES[departure.title] ?? [];
    for (const [index, minutes] of legs.entries()) {
      await db
        .update(tripDives)
        .set({ travelMinutes: minutes })
        .where(and(eq(tripDives.tripId, departure.id), eq(tripDives.diveNumber, index + 1)));
    }
  }
}
