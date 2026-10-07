import { cache } from "react";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import { OPERATIONAL_MAX_TRIPS, operationalWindow } from "@/lib/operational-window";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import type { AppDb } from "./client";
import { listTripsReadiness } from "./readiness";
import { pagedUpcomingTripsWithCounts } from "./trips";

/**
 * Readiness across the shared operational horizon, read once. The nav badge
 * and the day spine both hang off this, so they cannot report a different
 * number of blocked divers; this file used to cap itself at the nearest 40
 * departures instead, which is exactly how they came to.
 *
 * `OPERATIONAL_MAX_TRIPS` is a work bound, not the window: departures are
 * filtered to the horizon *before* readiness is computed, and the cap only
 * fires for a shop with more departures inside one week than any triage list
 * should carry. When it does fire the queue says so (`truncated`) rather than
 * dropping the tail in silence.
 */

/**
 * Every in-horizon departure plus its readiness rows, in one place. Exported
 * so a page reading the queue more than once in a single request — the shop
 * home reads today's shop-day and tomorrow's — runs the pipeline once and
 * hands the same evidence to each call: the pass costs about ten queries, so
 * recomputing it per read doubles the page's whole database bill.
 *
 * **Shared across the shell and the page by {@link sharedInHorizonReadiness}**
 * (app audit 2026-10-07, item 2). The duplicate worth removing crosses a
 * boundary a prop cannot: the staff shell's blocked-diver badge runs this in
 * `ShopChrome`, and the shop home and the roster each run it again in the
 * `page.tsx` beside it - about ten round trips a time on the seeded fixture.
 *
 * Issue #1121 measured on 2026-09-02 that React's `cache()` could not bridge
 * that gap: the shell and the page rendered in separate passes, so a memo in
 * one never reached the other. Re-measured on 2026-10-07 against `pnpm dev`
 * (Next 16.4) with the `render.db_queries` line and a probe on the shared
 * slot, it now does: one load of `/shop/blue-mantis` ran the pass **once**
 * for the badge and the page together, and the whole render logged one line,
 * not one per pass. If a later Next splits the passes again, the shared reader
 * degrades to exactly the old cost - two passes, each correct - and the
 * `render.db_queries` lines will say so by arriving in pairs.
 *
 * What would still be wrong is a cache keyed *outside* React's request scope:
 * a second, staler answer to "who is blocked", the thing this file exists to
 * prevent.
 */
export async function inHorizonReadiness(db: AppDb, shopId: string, now: Date) {
  const { to: horizon } = operationalWindow(now);
  const { trips: fetched, nextCursor } = await pagedUpcomingTripsWithCounts(db, shopId, {
    now,
    limit: OPERATIONAL_MAX_TRIPS,
  });
  const inWindow = fetched.filter((trip) => trip.startsAt <= horizon);
  // The cap only truncated anything if more departures exist past what it
  // fetched *and* every one it did fetch was still inside the horizon — if the
  // horizon ended the list first, nothing inside the window is missing.
  const truncated = nextCursor !== null && inWindow.length === fetched.length;

  // One batched readiness pass for the whole window — the same call the Today
  // queue makes, so the two surfaces can never disagree about who is blocked.
  const readinessByTrip = new Map<string, Awaited<ReturnType<typeof listTripsReadiness>>>();
  for (const trip of inWindow) readinessByTrip.set(trip.id, []);
  for (const row of await listTripsReadiness(
    db,
    shopId,
    inWindow.map((trip) => trip.id),
    now,
  )) {
    readinessByTrip.get(row.booking.tripId)?.push(row);
  }
  // `upcoming` keeps the pre-horizon fetch alongside the windowed list:
  // Today's "next departure" fallback reads past the window when nothing
  // sails inside it.
  return { trips: inWindow, upcoming: fetched, readinessByTrip, truncated };
}

/** The evidence bundle `inHorizonReadiness` produces, for callers passing it through. */
export type HorizonReadinessEvidence = Awaited<ReturnType<typeof inHorizonReadiness>>;

/**
 * One slot per (connection, shop, clock minute) per render. React's `cache()`
 * memoizes the slot, not the pass, so the pass can be started by whichever
 * caller asks first with its own `now` - see {@link sharedInHorizonReadiness}.
 */
const horizonSlot = cache(
  (
    _db: AppDb,
    _shopId: string,
    _minute: number,
  ): { evidence?: Promise<HorizonReadinessEvidence> } => ({}),
);

/**
 * {@link inHorizonReadiness}, run once per render for every caller asking about
 * the same shop in the same clock minute (app audit 2026-10-07, item 2).
 *
 * The staff shell's badge (`countBlockedDiversToday`), the shop home and the roster
 * each run the pass, about eleven statements a time. The first asker's pass is
 * the one every later asker in the render receives, so the badge and the page
 * it links to now read literally the same evidence - the property this file
 * exists for, held more tightly than two passes a few milliseconds apart ever
 * held it. Keyed on the clock *minute* rather than the exact instant because
 * each caller reads the clock for itself; a second caller in a later minute
 * gets a pass of its own rather than an answer from the previous minute.
 *
 * Outside a render (an action, a route handler, a test) `cache()` calls
 * straight through, so every call runs its own pass, exactly as before. Where
 * the shell and the page render in separate passes, they still read twice -
 * see the note on {@link inHorizonReadiness}; the `render.db_queries` line
 * (`src/lib/observability/query-timing.ts`) is how to tell which is happening.
 */
export function sharedInHorizonReadiness(
  db: AppDb,
  shopId: string,
  now: Date,
): Promise<HorizonReadinessEvidence> {
  const slot = horizonSlot(db, shopId, Math.floor(now.getTime() / MINUTE_MS));
  slot.evidence ??= inHorizonReadiness(db, shopId, now);
  return slot.evidence;
}

/**
 * Divers who can't board yet on **today's** departures, in the shop's own
 * zone: the number the Today row's nav badge carries (UX audit 2026-10-07,
 * item 1). It counts exactly what the day's departure cards count — one per
 * blocked booking on each of today's departures, the sum of every card's
 * "N blocked" — and the summary line under the date says the same number in
 * words, so the badge, the cards and the sentence are one figure.
 *
 * It used to count the whole week's horizon, on a row labelled Today, which is
 * how the badge came to read 21 over a page whose cards said 4.
 */
export async function countBlockedDiversToday(
  db: AppDb,
  shopId: string,
  timeZone: string,
  now: Date = nowDate(),
): Promise<number> {
  const evidence = await sharedInHorizonReadiness(db, shopId, now);
  return blockedOnShopDay(evidence, timeZone, now);
}

/**
 * The shared derivation behind {@link countBlockedDiversToday}, over evidence a
 * caller already holds: blocked readiness rows on the departures whose start
 * falls on `now`'s shop-day.
 */
export function blockedOnShopDay(
  evidence: Pick<HorizonReadinessEvidence, "trips" | "readinessByTrip">,
  timeZone: string,
  now: Date,
): number {
  const day = (date: Date) => toDateInputValue(utcToWallTime(date, timeZone));
  const today = day(now);
  let blocked = 0;
  for (const trip of evidence.trips) {
    if (day(trip.startsAt) !== today) continue;
    for (const row of evidence.readinessByTrip.get(trip.id) ?? []) {
      if (row.readiness.status === "blocked") blocked += 1;
    }
  }
  return blocked;
}
