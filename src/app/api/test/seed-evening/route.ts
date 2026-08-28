import { and, asc, eq, gte, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { liveTrip } from "@/db/trips-live";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
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
    .select({ id: trips.id })
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
  const moved: { id: string; startsAt: string; endsAt: string }[] = [];
  for (const [index, trip] of [...today].reverse().entries()) {
    const endsAt = new Date(lastEnd - index * (DEPARTURE_MS + TURNAROUND_MS));
    const startsAt = new Date(endsAt.getTime() - DEPARTURE_MS);
    if (startsAt < bounds.from) break;
    await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, trip.id));
    moved.push({ id: trip.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
  }

  return NextResponse.json({ ok: true, moved: moved.length, departures: moved.reverse() });
}
