import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { DEMO_SHOP_SLUG } from "@/db/dev-credentials";
import { trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { liveTrip } from "@/db/trips-live";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * **Send one named departure out without its divers**, by moving its times
 * back rather than moving the clock.
 *
 * The counter's "Not here?" door opens when the boat leaves without the diver
 * and says a different thing once it is really gone (`noShowGate` and
 * `noShowClaim`, src/lib/no-show.ts). Neither state can be built inside a spec
 * as things stand: the fleet's clock is frozen at one instant and is
 * process-wide per worker — `api/test/clock`'s own docblock says the fleet
 * never calls it — while a seat cannot be *sold* onto a departure that has
 * sailed (`createBooking` refuses `trip_unavailable`) and nobody can join a
 * wait list for one that has left at all (`joinTripWaitlist`). So a spec that
 * created a past boat could never fill it, and a spec that filled a future one
 * could never get the door.
 *
 * Moving the departure is the lever `seed-evening` already uses for the
 * evening, and for the same reason. This one is narrower: one trip the caller
 * names, so a spec cannot quietly re-time somebody else's boat in a shared
 * worker database.
 *
 * `minutesAgo` is how long ago it left. Under 60 leaves it inside the standing
 * one-hour late-arrival buffer (`hasSailed`, src/lib/trips.ts), which is the
 * seat-still-sellable half of the door; past 60 it is gone, which is the half
 * that says the diver did not dive. The whole trip slides — `endsAt` keeps its
 * duration — because a boat that left earlier gets home earlier.
 *
 * Gated like every other `/api/test/*` route, and demo-shop only, so it can
 * never be reachable in a real deployment.
 */
export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    tripId?: unknown;
    minutesAgo?: unknown;
  } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  const minutesAgo = typeof body?.minutesAgo === "number" ? body.minutesAgo : Number.NaN;
  if (!tripId || !Number.isFinite(minutesAgo) || minutesAgo <= 0) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const db = await getDb();
  const shop = await getShopBySlug(db, DEMO_SHOP_SLUG);
  if (!shop?.isDemo) return NextResponse.json({ error: "not_demo" }, { status: 404 });

  const [trip] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shop.id), liveTrip()))
    .limit(1);
  if (!trip) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const startsAt = new Date(nowDate().getTime() - minutesAgo * MINUTE_MS);
  // Only ever backwards, the same one-directional discipline `api/test/clock`
  // keeps: a departure dragged *forward* would put a recorded arrival before
  // the boat it was recorded against.
  if (startsAt.getTime() >= trip.startsAt.getTime()) {
    return NextResponse.json({ error: "would_move_forwards" }, { status: 409 });
  }
  const endsAt = new Date(trip.endsAt.getTime() - (trip.startsAt.getTime() - startsAt.getTime()));

  await db.update(trips).set({ startsAt, endsAt }).where(eq(trips.id, tripId));
  return NextResponse.json({ ok: true, startsAt: startsAt.toISOString() });
}
