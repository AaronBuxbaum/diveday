import type { PGlite } from "@electric-sql/pglite";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import { readAfterTheDive } from "@/app/ready/[token]/_components/after-dive-reads";
import { readSchedulePage } from "@/app/s/[shopSlug]/_components/schedule-reads";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { getReadyPageData } from "@/db/ready";
import { getRecapPageState } from "@/db/recap";
import { bookings, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { createTripSeries, listRunningPublicSeries } from "@/db/trips";
import { liveTrip } from "@/db/trips-live";
import { buildAfterStateProps } from "@/features/recap-after-state";
import { diverTranslator } from "@/i18n/messages";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { queryTimingLogger, withQueryStats } from "@/lib/observability/query-timing";
import { EVERY_WEEKDAY } from "@/lib/recurrence";
import { seededShopContext } from "@/test/db";
import { phaseCountingDb, report } from "@/test/render-phases";

vi.mock("next/server", () => ({ after: vi.fn() }));

/**
 * **What the diver pages whose reads live in `src/app` cost** — the public
 * schedule, `/recap/[token]` and `/ready` once the boat is home (code review 2026-10-13, items
 * 11 and 29). The same instruments as the staff renders and the public
 * booking page (`src/db/staff-render-cost.test.ts`, whose header says what a
 * ceiling means); here because the replays call the page's own reader
 * (`readSchedulePage`) and the after-state's (`buildAfterStateProps`), which
 * `src/db` may not import.
 *
 * `DIVEDAY_PRINT_QUERY_COUNTS=1 pnpm test src/app/diver-render-cost.test.ts
 * --reporter=dot --silent=false` prints each number.
 */
async function timedSeededShop(options: { history?: boolean } = {}) {
  const { db: plain, shop } = await seededShopContext(options);
  const db = drizzle({
    client: plain.$client as PGlite,
    logger: queryTimingLogger,
  }) as unknown as AppDb;
  return { db, plain, shop };
}

/**
 * `/ready` once the boat is home (ADR 20260827-the-divers-thread, decision 4):
 * a seat on a departure that ended past the recap floor, whose recap is open.
 * The seeded shop's past days carry no roll call, so this is the commonest
 * shape — the four-hour floor decides, and the page renders the afterglow.
 */
async function readinessLinkForSeatAfterTheDive(plain: AppDb, shopId: string) {
  const seats = await plain
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        inArray(bookings.status, ["booked", "checked_in"]),
        liveTrip(),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, new Date(nowDate().getTime() - 6 * HOUR_MS)),
      ),
    )
    .orderBy(desc(trips.startsAt), asc(bookings.id))
    .limit(25);
  for (const { bookingId } of seats) {
    if ((await getRecapPageState(plain, bookingId)).kind !== "recap") continue;
    const issued = await issueBookingCapability(plain, {
      shopId,
      bookingId,
      purpose: "readiness",
    });
    if (issued) return issued.token;
  }
  throw new Error("the seeded shop has no past seat with an open recap");
}

/**
 * `/ready`'s reads after the dive, as the page awaits them: the capability,
 * `getReadyPageData`, then the after-dive branch above the thread — the
 * departure roll call and late boarding with the recap started beside them,
 * and the after-state's one wave (`buildAfterStateProps`). The thread's own wave never runs on this
 * branch.
 */
async function readyAfterTheDiveReads(db: AppDb, token: string) {
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) throw new Error("the readiness link did not verify");
  const { bookingId } = capability;
  const data = await getReadyPageData(db, bookingId);
  if (!data) throw new Error("no ready page data");
  const { detail, shop } = data;
  // The page's own after-dive reads: the roll call, with the recap beside it.
  const afterDive = await readAfterTheDive(db, {
    shopId: shop.id,
    tripId: detail.trip.id,
    endsAt: detail.trip.endsAt,
    bookingId,
    identityHeld: data.identityHeld,
  });
  if (!afterDive.afterTheDive) throw new Error("the seat is not after the dive");
  const recapState = await afterDive.recap();
  if (recapState.kind !== "recap")
    throw new Error(`expected an open recap, got ${recapState.kind}`);
  const noop = async () => undefined;
  await buildAfterStateProps({
    db,
    data: recapState.data,
    bookingId,
    locale: "en-US",
    t: diverTranslator("en-US"),
    mintHandoff: true,
    delivered: true,
    params: {},
    actions: {
      submitReview: noop,
      uploadPhoto: noop,
      unsharePhoto: noop,
      startTip: noop,
      submitPulse: noop,
    } as unknown as Parameters<typeof buildAfterStateProps>[0]["actions"],
  });
}

/**
 * **`/recap/[token]`, the recap email's link** (code review 2026-10-13b, item
 * 32): what the page body awaits once the signature verifies, which reads no
 * row. The recap state, then the after-state's wave; a recap link never mints
 * a handoff, so that write is not here. `generateMetadata` asks for the same
 * state through `recapPageStateCached`, which React answers once per request.
 */
async function recapPageReads(db: AppDb, bookingId: string) {
  const state = await getRecapPageState(db, bookingId);
  if (state.kind !== "recap") throw new Error(`expected an open recap, got ${state.kind}`);
  const noop = async () => undefined;
  await buildAfterStateProps({
    db,
    data: state.data,
    bookingId,
    locale: "en-US",
    t: diverTranslator("en-US"),
    mintHandoff: false,
    delivered: false,
    params: {},
    actions: {
      submitReview: noop,
      uploadPhoto: noop,
      unsharePhoto: noop,
      startTip: noop,
      submitPulse: noop,
    } as unknown as Parameters<typeof buildAfterStateProps>[0]["actions"],
  });
}

/**
 * **The public schedule** (`src/app/s/[shopSlug]/page.tsx`), the shop's
 * most-visited page and the one hot page the tripwire did not measure (code
 * review 2026-10-13, item 11). What its body waits for before it flushes: the
 * shop, `readSchedulePage`'s one batch, and — when the diver has reached the
 * board's last month — the runs that keep going past it. The month's
 * sightings, the reviews and "Our year" each stream behind a boundary of their
 * own, so they hold nothing and are not replayed.
 *
 * Three open-ended runs are made public first, so the board's-end read has
 * series to look at: it is the one read on the page whose cost grew with the
 * shop (code review 2026-10-13, item 29).
 */
async function withRunningSeries(plain: AppDb, shopId: string) {
  // Three open-ended daily runs, each materialized over the whole horizon:
  // the board's-end read used to ship every one of their future dates to
  // keep one line per run (code review 2026-10-13b, item 40), and a replay
  // with one date per run could not see it.
  for (const title of ["Dawn reef", "Midday wreck", "Night dive"]) {
    const created = await createTripSeries(plain, {
      shopId,
      title,
      capacity: 12,
      plannedDives: 1,
      frequency: "weekly",
      intervalWeeks: 1,
      weekdays: EVERY_WEEKDAY,
      anchorDate: "2030-09-07",
      endsOn: null,
      timeZone: "America/New_York",
      template: {
        startsAt: new Date("2030-09-07T11:00:00.000Z"),
        endsAt: new Date("2030-09-07T15:00:00.000Z"),
      },
    });
    if (!created || created.trips.length < 100) throw new Error("the run did not fill its horizon");
  }
}

async function publicSchedulePageReads(db: AppDb, shopSlug: string) {
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) throw new Error("no shop");
  const now = nowDate();
  await readSchedulePage(db, shop, {
    isEmbed: false,
    lens: undefined,
    cursor: { after: undefined, before: undefined },
    now,
    listMonthBounds: null,
    hasSpaceFilter: false,
    tripTypeFilter: undefined,
  });
  const running = await listRunningPublicSeries(db, shop.id, now);
  if (running.length === 0) throw new Error("the board's-end read found no running series");
}

describe("what a diver's page sends", () => {
  it("reads /ready after the dive", async () => {
    // The past days are history, seeded only on request.
    const { db, plain, shop } = await timedSeededShop({ history: true });
    const token = await readinessLinkForSeatAfterTheDive(plain, shop.id);
    const { stats } = await withQueryStats(() => readyAfterTheDiveReads(db, token));
    expect(report("ready after the dive", stats.queries)).toBeLessThanOrEqual(READY_AFTER_CEILING);
  });

  it("reads /recap/[token]", async () => {
    const { db, plain, shop } = await timedSeededShop({ history: true });
    const token = await readinessLinkForSeatAfterTheDive(plain, shop.id);
    const capability = await verifyBookingCapability(plain, { token, purpose: "readiness" });
    if (!capability) throw new Error("the readiness link did not verify");
    const { stats } = await withQueryStats(() => recapPageReads(db, capability.bookingId));
    expect(report("recap", stats.queries)).toBeLessThanOrEqual(RECAP_CEILING);
  });

  it("reads the public schedule", async () => {
    const { db, plain, shop } = await timedSeededShop();
    await withRunningSeries(plain, shop.id);
    const { stats } = await withQueryStats(() => publicSchedulePageReads(db, shop.slug));
    expect(report("public schedule", stats.queries)).toBeLessThanOrEqual(PUBLIC_SCHEDULE_CEILING);
  });
});

describe("how many round trips a diver's page waits for, one after another", () => {
  it("reads /ready after the dive in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop({ history: true });
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const token = await readinessLinkForSeatAfterTheDive(plain, shop.id);
    await readyAfterTheDiveReads(db, token);
    expect(report("ready after the dive phases", phases())).toBeLessThanOrEqual(
      READY_AFTER_PHASE_CEILING,
    );
  });

  it("reads /recap/[token] in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop({ history: true });
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const token = await readinessLinkForSeatAfterTheDive(plain, shop.id);
    const capability = await verifyBookingCapability(plain, { token, purpose: "readiness" });
    if (!capability) throw new Error("the readiness link did not verify");
    await recapPageReads(db, capability.bookingId);
    expect(report("recap phases", phases())).toBeLessThanOrEqual(RECAP_PHASE_CEILING);
  });

  it("reads the public schedule in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop();
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    await withRunningSeries(plain, shop.id);
    await publicSchedulePageReads(db, shop.slug);
    expect(report("public schedule phases", phases())).toBeLessThanOrEqual(
      PUBLIC_SCHEDULE_PHASE_CEILING,
    );
  });
});

// Measured 2026-10-13 when the replays were added (code review 2026-10-13,
// items 11 and 29), before either page's tail was grouped.
// After the dive: the capability and `getReadyPageData` (4 phases), the
// departure roll call, then the recap (8) and the after-state's wave (5).
// 18 → 16 (code review 2026-10-13, item 29): the recap starts beside the roll
// call, and its two seat checks (left at the dock, waiting on a missing
// person) go out together.
// 60 → 59 statements and 16 → 12 phases (code review 2026-10-13b, item 32):
// the gate and the page start from one row, and the page's reads go out
// beside the seat checks with the trip in the same wave, so the recap is 3
// phases where it was 7. The after-state's 5 are its next-dive read and the
// handoff it mints.
// 59 → 60 (issue #2058): the next-dive pick reads the diver's course seats
// once beside the cards (`nextDiveForBooking`), so a departure after a course
// they are booked on is suggested as the booking door sells it. One statement
// in the same wave; the phases stay.
// 60 → 61 (layer r5-4, fifth-loop ideas item 37): the diver's own later
// seats, read once beside the next-dive pick for both the pick and the
// "You're booked" line, and only on a delivered link. The layer's other reads
// went into ones already here: the boat's shared photos ride the diver's own
// photo read, and this page asks the welcome reader for no dive-day count.
// 61 → 63, and the recap's 29 → 31 (market sheet 2026-10-22, item 4): no
// code changed, the seat did. The seeded diver after the dive is now a
// regular who comes back (a seat on a later boat, a mask left aboard), and a
// seat like that reads two statements more on each page than a one-off
// diver's, which stays under both. Measured, not designed: worth a look if
// either page is tightened again.
// 63 → 64: minting the after-state's handoff now locks the diver before the
// booking so it cannot race erasure. Those locks stay separate to preserve
// erasure's person-then-booking order; the extra statement is one round trip.
// 64 → 65: the sailed demo departures carry their planned dives now (the trip's
// site lives only in `trip_dives`, issue #3237), and the page reads them.
const READY_AFTER_CEILING = 65;
const READY_AFTER_PHASE_CEILING = 12;
// `/recap/[token]`, replayed from item 32: the recap's 3 and the after-state's
// next-dive read, with no handoff. Before item 32 the same reads were 7 + 2.
// 31 → 32: the sailed demo departures now carry their planned dives (the trip's
// site lives only in `trip_dives`, issue #3237), so the recap reads them.
const RECAP_CEILING = 32;
const RECAP_PHASE_CEILING = 5;
// The shop, `readSchedulePage`'s batch with its chained reads, then the
// board's-end read. 16 → 14 statements and 7 → 5 phases (item 29): the
// running series' templates are one read, not one per series.
const PUBLIC_SCHEDULE_CEILING = 14;
const PUBLIC_SCHEDULE_PHASE_CEILING = 5;
