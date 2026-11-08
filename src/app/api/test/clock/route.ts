import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { bringDemoBoatsAtSeaHome } from "@/db/seed-boat-at-sea";
import { e2eTestRouteAuthorized, testRouteRefused } from "@/features/e2e-test-routes";
import { nowDate } from "@/lib/clock";
import { moveServerClock } from "../../../../features/test-clock/rules";

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
 * **The fleet calls this through the `clock` fixture** (`e2e/fixtures.ts`). A
 * worker's clock is process-wide, shared by every spec that worker runs, so a
 * move is safe only because `/api/test/reset` puts the clock back to the
 * instant the server booted at before the next test (`src/features/test-clock/rules.ts`,
 * issue #2761). Only the reset moves it backwards; this route refuses to.
 *
 * Moving it past the demo's boat at sea brings her home
 * (`bringDemoBoatsAtSeaHome`), the one write this route makes.
 *
 * Gated like every other `/api/test/*` route (`e2eTestRouteAuthorized`), and
 * the clock module refuses the override outright whenever a real
 * `DATABASE_URL` is configured, so no deployment can be frozen from here even
 * if the gate were misconfigured.
 */
export async function GET(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
  return NextResponse.json({ now: nowDate().toISOString() });
}

export async function POST(request: Request) {
  if (!e2eTestRouteAuthorized(request)) return testRouteRefused();
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
  moveServerClock(new Date(requested));
  // A clock moved past the demo's boat at sea brings her home the way the
  // nightly refresh does, rather than leaving dive 2's count open hours after
  // she was due (visual triage of PR #2918, item 1a). A boat still out by the
  // new clock is left at sea.
  await bringDemoBoatsAtSeaHome(await getDb(), nowDate());
  return NextResponse.json({ now: nowDate().toISOString() });
}
