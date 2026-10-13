import type { PGlite } from "@electric-sql/pglite";
import { and, asc, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import { readAfterTheDive } from "@/app/ready/[token]/_components/after-dive-reads";
import { readSchedulePage } from "@/app/s/[shopSlug]/_components/schedule-reads";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { getReadyPageData } from "@/db/ready";
import { getRecapPageState } from "@/db/recap";
import { bookings, tripSeries, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { listRunningPublicSeries } from "@/db/trips";
import { liveTrip } from "@/db/trips-live";
import { buildAfterStateProps } from "@/features/recap-after-state";
import { diverTranslator } from "@/i18n/messages";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { queryTimingLogger, withQueryStats } from "@/lib/observability/query-timing";
import { seededShopContext } from "@/test/db";
import { phaseCountingDb, report } from "@/test/render-phases";

vi.mock("next/server", () => ({ after: vi.fn() }));

/**
 * **What the diver pages whose reads live in `src/app` cost** — the public
 * schedule and `/ready` once the boat is home (code review 2026-10-13, items
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
    params: {},
    actions: {
      submitReview: noop,
      uploadPhoto: noop,
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
  const upcoming = await plain
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        eq(trips.isPrivate, false),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(3);
  if (upcoming.length < 3) throw new Error("the seeded shop has too few public departures");
  for (const trip of upcoming) {
    const [series] = await plain
      .insert(tripSeries)
      .values({
        shopId,
        title: "Measured run",
        weekdayMask: 0b1111111,
        anchorDate: "2026-01-01",
        occurrenceCount: 1,
      })
      .returning({ id: tripSeries.id });
    if (!series) throw new Error("series insert failed");
    await plain
      .update(trips)
      .set({ seriesId: series.id })
      .where(and(eq(trips.shopId, shopId), inArray(trips.id, [trip.id])));
  }
}

async function publicSchedulePageReads(db: AppDb, shopSlug: string) {
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) throw new Error("no shop");
  const now = nowDate();
  await readSchedulePage(db, shop, {
    isEmbed: false,
    lens: undefined,
    after: undefined,
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
const READY_AFTER_CEILING = 60;
const READY_AFTER_PHASE_CEILING = 16;
// The shop, `readSchedulePage`'s batch with its chained reads, then the
// board's-end read. 16 → 14 statements and 7 → 5 phases (item 29): the
// running series' templates are one read, not one per series.
const PUBLIC_SCHEDULE_CEILING = 14;
const PUBLIC_SCHEDULE_PHASE_CEILING = 5;
