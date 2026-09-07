import { NextResponse } from "next/server";
import { nowDate } from "@/lib/clock";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";

/**
 * Move this server's frozen clock — the one-day simulation's hand on time.
 *
 * `src/lib/clock.ts` reads `DIVEDAY_CLOCK` off `process.env` on every call, so
 * writing the variable here advances "now" for every later read in this
 * process: each page render, each server action, each cron pass. That is what
 * lets `scripts/simulate-day.mjs` book a seat at six in the morning, tap
 * *Underway* at eleven, close the day at seven and fire the recap pass after
 * the four-hour floor — one server, one database, one honest clock.
 *
 * **The e2e fleet never calls this.** A worker's clock is process-wide, shared
 * by every spec that worker runs (`e2e/servers.ts`, and `seed-evening`'s
 * docblock on why the departures move instead). A spec that moved it would
 * move it for the rest of the run. The simulation owns its server outright,
 * which is the only reason this is safe there.
 *
 * Gated like every other `/api/test/*` route (`e2eTestRouteAuthorized`), and
 * the clock module refuses the override outright whenever a real
 * `DATABASE_URL` is configured, so no deployment can be frozen from here even
 * if the gate were misconfigured.
 */
export async function GET(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  return NextResponse.json({ now: nowDate().toISOString() });
}

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { now?: unknown } | null;
  const requested = typeof body?.now === "string" ? Date.parse(body.now) : Number.NaN;
  if (Number.isNaN(requested)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  // The simulation only ever moves forward: a clock stepping back would let a
  // stage word or a signature stamp land before the event it follows, which is
  // exactly the kind of state the rehearsal exists to refuse.
  if (requested < nowDate().getTime()) {
    return NextResponse.json({ error: "clock_would_move_backwards" }, { status: 409 });
  }
  process.env.DIVEDAY_CLOCK = new Date(requested).toISOString();
  return NextResponse.json({ now: nowDate().toISOString() });
}
