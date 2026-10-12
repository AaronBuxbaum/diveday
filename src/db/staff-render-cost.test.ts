import type { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inHorizonReadiness } from "@/db/blockers";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import type { AppDb } from "@/db/client";
import { getCourseFormsForBooking } from "@/db/course-forms";
import { hasActiveCourses } from "@/db/courses";
import { countSpendableDives } from "@/db/dive-packages";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { countGearItems } from "@/db/gear";
import { getBookingPayment } from "@/db/payments";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getReadyPageData } from "@/db/ready";
import { getShopReviewAggregate } from "@/db/reviews";
import { bookings, people, personRoles, trips } from "@/db/schema";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { getShopBySlug } from "@/db/shops";
import { getShopStripeAccount } from "@/db/stripe-accounts";
import {
  countBlockedDiversNextBoatDay,
  getShopDayDepartures,
  getTodayWork,
  todayNextDepartureTripId,
} from "@/db/today";
import { listTripChangeEvents } from "@/db/trip-change-events";
import { siteSightings } from "@/db/trip-sightings";
import { latestTripStage } from "@/db/trip-stages";
import {
  getTripWithBooked,
  listTripDives,
  listTripScheduleDays,
  pagedUpcomingTripsWithCounts,
  tripCrewSpokenLanguages,
  tripPublicCrew,
} from "@/db/trips";
import { getTripGuests } from "@/db/trips-guests";
import { liveTrip } from "@/db/trips-live";
import { getTripOverview } from "@/db/trips-overview";
import { loadTripSharedReads } from "@/db/trips-shared-reads";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { queryTimingLogger, withQueryStats } from "@/lib/observability/query-timing";
import { seededShopContext } from "@/test/db";

/**
 * **What the three busiest staff renders cost, in statements** — the evidence
 * for the 2026-10-07 audit's performance batch (items 2, 3 and 4).
 *
 * Each block replays the database half of one render against the seeded shop,
 * through the same counting logger production installs
 * (`src/lib/observability/query-timing.ts`), and pins a ceiling at what it
 * costs today. The ceilings are tripwires, not targets: a change that adds a
 * statement to one of these renders should have to say so here.
 *
 * What a test cannot see: React's `cache()`. Vitest resolves React's client
 * build, whose `cache()` calls straight through, so the per-request memo on the
 * staff gate's session, roles and shop reads (`src/lib/session.ts`) saves
 * nothing *here* — its saving is measured in the running app, by the
 * `render.db_queries` line each staff render logs. The savings below are the
 * structural ones: a reader that no longer runs twice whatever React does.
 *
 * `DIVEDAY_PRINT_QUERY_COUNTS=1 pnpm test src/db/staff-render-cost.test.ts
 * --reporter=dot --silent=false` prints each number, for the PR description.
 *
 * **Statements are half the cost; the other half is how many of them wait on
 * one another.** Sixty statements in three waves are three round trips of
 * latency; the same sixty awaited one at a time are sixty. The count above
 * cannot tell those apart, which is how Today drifted to about twenty serial
 * phases without one ceiling moving (code review 2026-10-10, items 2 and 3).
 * So the last block replays the same renders against a database that hands its
 * answers back in rounds, and counts the rounds: the *phases* a render waits
 * through one after another.
 */

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));

const { getDb } = await import("@/db/client");
const { auth } = await import("@/lib/auth");
const { requireShopSurface } = await import("@/lib/session");

async function timedSeededShop() {
  const { db: plain, shop } = await seededShopContext();
  const db = drizzle({
    client: plain.$client as PGlite,
    logger: queryTimingLogger,
  }) as unknown as AppDb;
  vi.mocked(getDb).mockResolvedValue(db);
  const [owner] = await plain
    .select({ personId: people.id })
    .from(personRoles)
    .innerJoin(people, eq(people.id, personRoles.personId))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("the seeded shop has no owner");
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      roles: ["owner"],
      name: "Seeded owner",
      email: "seeded-owner@demo.invalid",
    },
  });
  return { db, plain, shop, ownerId: owner.personId };
}

function report(label: string, queries: number): number {
  if (process.env.DIVEDAY_PRINT_QUERY_COUNTS === "1") {
    console.info(`[query-count] ${label}: ${queries}`);
  }
  return queries;
}

describe("what a staff render sends", () => {
  it("gates a staff page", async () => {
    const { shop } = await timedSeededShop();
    const { stats } = await withQueryStats(() => requireShopSurface(shop.slug));
    expect(report("gate (requireShopSurface)", stats.queries)).toBeLessThanOrEqual(GATE_CEILING);
  });

  it("draws the staff shell beside every page", async () => {
    const { db, shop } = await timedSeededShop();
    const { stats } = await withQueryStats(async () => {
      const row = await getShopBySlug(db, shop.slug);
      if (!row) throw new Error("no shop");
      await Promise.all([
        countBlockedDiversNextBoatDay(db, row.id, row.timezone, nowDate()),
        todayNextDepartureTripId(db, row.id, row.timezone),
        hasActiveCourses(db, row.id),
        countGearItems(db, row.id),
      ]);
    });
    expect(report("chrome (ShopChrome)", stats.queries)).toBeLessThanOrEqual(CHROME_CEILING);
  });

  it("assembles Today's queue and day spine", async () => {
    const { db, shop } = await timedSeededShop();
    const now = nowDate();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const { stats } = await withQueryStats(async () => {
      const evidence = await inHorizonReadiness(db, shop.id, now);
      await getTodayWork(
        db,
        shop.id,
        shop.slug,
        shop.timezone,
        now,
        undefined,
        undefined,
        undefined,
        true,
        evidence,
      );
      await getShopDayDepartures(db, shop.id, shop.timezone, tomorrow, evidence);
      await getShopStripeAccount(db, shop.id);
    });
    expect(report("today (readiness + today + tomorrow)", stats.queries)).toBeLessThanOrEqual(
      TODAY_CEILING,
    );
  });

  it("reads one departure's overview and guests", async () => {
    const { db, plain, shop, ownerId } = await timedSeededShop();
    const [trip] = await plain
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), liveTrip(), gt(trips.startsAt, nowDate())))
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!trip) throw new Error("the seeded shop has no upcoming departure");
    const { stats } = await withQueryStats(() => {
      const shared = loadTripSharedReads(db, shop.id, trip.id);
      return Promise.all([
        getTripOverview(db, shop, trip.id, ownerId, undefined, shared),
        getTripGuests(db, shop, trip.id, {}, shared),
      ]);
    });
    expect(report("trip (overview + guests)", stats.queries)).toBeLessThanOrEqual(TRIP_CEILING);
  });
});

/**
 * A client that runs every statement at once but **hands answers back in
 * rounds**: it holds each result until nothing is running and nothing new has
 * been sent for {@link QUIET_MS}, then releases every held answer together.
 * Statements sent in one round therefore cannot depend on one another — none
 * of them has an answer yet — so the number of rounds is the length of the
 * longest chain of statements each waiting on the one before: the render's
 * serial round trips, whatever the machine's speed.
 */
const QUIET_MS = 50;

function phaseCountingDb(client: PGlite) {
  let rounds = 0;
  let running = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const held: Array<() => void> = [];
  // Answers from outside the database that are **slower than any chain of
  // statements**, as a provider with a four-second timeout is: each comes back
  // only once the database has nothing left to answer, in a round of its own.
  // A render that awaits one waits that extra phase; one that streams it
  // finishes first.
  const slow: Array<() => void> = [];
  const settleLater = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (running > 0) return;
      const due = held.length > 0 ? held.splice(0) : slow.splice(0);
      if (due.length === 0) return;
      rounds += 1;
      for (const release of due) release();
      if (slow.length > 0) settleLater();
    }, QUIET_MS);
  };
  /** A value from outside the database, answered after the database goes quiet. */
  const slowly = <T>(value: () => T) =>
    new Promise<T>((resolve) => {
      slow.push(() => resolve(value()));
      settleLater();
    });
  const delayed = new Proxy(client, {
    get(target, property, receiver) {
      if (property === "query") {
        return (...args: Parameters<PGlite["query"]>) => {
          running += 1;
          settleLater();
          return target.query(...args).then(
            (result) =>
              new Promise<typeof result>((resolve) => {
                running -= 1;
                held.push(() => resolve(result));
                settleLater();
              }),
            (error: unknown) =>
              new Promise<never>((_resolve, reject) => {
                running -= 1;
                held.push(() => reject(error));
                settleLater();
              }),
          );
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const db = drizzle({ client: delayed as PGlite }) as unknown as AppDb;
  return { db, phases: () => rounds, slowly };
}

describe("how many round trips a staff render waits for, one after another", () => {
  beforeEach(() => {
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "1");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("assembles Today's queue and day spine in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop();
    const { db, phases, slowly } = phaseCountingDb(plain.$client as PGlite);
    // **The marine provider answers late, and Today must not wait for it**
    // (code review 2026-10-11, item 1). Its answer comes back a round after it
    // was asked, so a queue that awaited the forecast would show the wait here
    // as a phase of its own; the high-wind row streams beside the page instead.
    vi.stubEnv("DIVEDAY_DISABLE_EXTERNAL_HTTP", "");
    const provider = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        slowly(() => new Response(JSON.stringify({ hourly: { time: [] } }))),
      );
    const now = nowDate();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    // The page's own shape (`src/app/shop/[shopSlug]/page.tsx`): the readiness
    // pass in its first wave, then today and tomorrow side by side.
    const evidence = await inHorizonReadiness(db, shop.id, now);
    await Promise.all([
      getTodayWork(
        db,
        shop.id,
        shop.slug,
        shop.timezone,
        now,
        undefined,
        undefined,
        undefined,
        true,
        evidence,
      ),
      getShopDayDepartures(db, shop.id, shop.timezone, tomorrow, evidence),
    ]);
    expect(report("today phases", phases())).toBeLessThanOrEqual(TODAY_PHASE_CEILING);
    // The provider was asked: a seeded departure is booked, in the window, at a
    // site with a forecast point, so the count above covers a real request.
    expect(provider).toHaveBeenCalled();
  });

  it("reads one departure's overview and guests in a bounded number of phases", async () => {
    const { plain, shop, ownerId } = await timedSeededShop();
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const [trip] = await plain
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), liveTrip(), gt(trips.startsAt, nowDate())))
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!trip) throw new Error("the seeded shop has no upcoming departure");
    const shared = loadTripSharedReads(db, shop.id, trip.id);
    await Promise.all([
      getTripOverview(db, shop, trip.id, ownerId, undefined, shared),
      getTripGuests(db, shop, trip.id, {}, shared),
    ]);
    expect(report("trip phases", phases())).toBeLessThanOrEqual(TRIP_PHASE_CEILING);
  });
});

/**
 * **The two diver pages a booking lives on**: the public booking page
 * (`src/app/s/[shopSlug]/trips/[id]/page.tsx`) and the readiness thread
 * (`src/app/ready/[token]/page.tsx`). Their reads sit in the page bodies, so
 * each is replayed here in the page's own shape, for an anonymous visitor on
 * the standalone page and for the night-before visit to `/ready` (no Stripe
 * return, no roll call yet). A change to either page's waves changes the
 * replay beside it.
 */
async function upcomingBookableTrip(plain: AppDb, shopId: string) {
  const [trip] = await plain
    .select({ id: trips.id })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!trip) throw new Error("the seeded shop has no upcoming departure");
  return trip.id;
}

async function readinessLinkForUpcomingSeat(plain: AppDb, shopId: string) {
  const [seat] = await plain
    .select({ bookingId: bookings.id })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shopId),
        eq(bookings.status, "booked"),
        liveTrip(),
        eq(trips.status, "scheduled"),
        gt(trips.startsAt, nowDate()),
      ),
    )
    .orderBy(asc(trips.startsAt), asc(bookings.id))
    .limit(1);
  if (!seat) throw new Error("the seeded shop has no upcoming booked seat");
  const issued = await issueBookingCapability(plain, {
    shopId,
    bookingId: seat.bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("no readiness link for the seeded seat");
  return issued.token;
}

/** The public booking page's reads, as the page awaits them. */
async function publicTripPageReads(db: AppDb, shopSlug: string, tripId: string) {
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) throw new Error("no shop");
  const [trip, tripDives] = await Promise.all([
    getTripWithBooked(db, shop.id, tripId),
    listTripDives(db, shop.id, tripId),
    listTripScheduleDays(db, shop.id, tripId),
    tripCrewSpokenLanguages(db, shop.id, tripId),
    tripPublicCrew(db, shop.id, tripId),
  ]);
  if (!trip) throw new Error("no trip");
  await listTripChangeEvents(db, shop.id, tripId);
  const siteIds = tripDives
    .map(({ diveSite }) => diveSite?.id)
    .filter((id): id is string => Boolean(id));
  await listDiveSiteBriefingExtras(db, shop.id, siteIds);
  await siteSightings(db, shop.id, siteIds);
  if (perDiverBookingPriceCents(trip, trip.course)) await getShopStripeAccount(db, shop.id);
  await Promise.all([
    getTripRequirements(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
  ]);
  if (!trip.conditionsHold) {
    await pagedUpcomingTripsWithCounts(db, shop.id, {
      now: nowDate(),
      limit: 50,
      hasSpace: true,
      publicOnly: true,
    });
  }
  if (shop.reviewsEnabled) await getShopReviewAggregate(db, shop.id);
}

/** `/ready`'s reads on the night-before visit, as the page awaits them. */
async function readyPageReads(db: AppDb, token: string) {
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) throw new Error("the readiness link did not verify");
  const data = await getReadyPageData(db, capability.bookingId);
  if (!data) throw new Error("no ready page data");
  // The thread body: party seats, the trip fan-out, the receipt, the course
  // forms and the package dives.
  await issuePartySeatClaims(db, { shopId: data.shop.id, leadBookingId: capability.bookingId });
  await Promise.all([
    getShopBySlug(db, data.shop.slug),
    getTripWithBooked(db, data.shop.id, data.trip.id),
    listTripDives(db, data.shop.id, data.trip.id),
    listTripChangeEvents(db, data.shop.id, data.trip.id),
    tripPublicCrew(db, data.shop.id, data.trip.id),
    latestTripStage(db, data.shop.id, data.trip.id),
  ]);
  await getBookingPayment(db, data.shop.id, capability.bookingId);
  if (data.trip.course) await getCourseFormsForBooking(db, data.shop.id, capability.bookingId);
  await countSpendableDives(db, data.shop.id, data.person.id);
}

describe("what a diver's page sends", () => {
  it("reads the public booking page", async () => {
    const { db, plain, shop } = await timedSeededShop();
    const tripId = await upcomingBookableTrip(plain, shop.id);
    const { stats } = await withQueryStats(() => publicTripPageReads(db, shop.slug, tripId));
    expect(report("public trip", stats.queries)).toBeLessThanOrEqual(PUBLIC_TRIP_CEILING);
  });

  it("reads /ready the night before", async () => {
    const { db, plain, shop } = await timedSeededShop();
    const token = await readinessLinkForUpcomingSeat(plain, shop.id);
    const { stats } = await withQueryStats(() => readyPageReads(db, token));
    expect(report("ready", stats.queries)).toBeLessThanOrEqual(READY_CEILING);
  });
});

describe("how many round trips a diver's page waits for, one after another", () => {
  it("reads the public booking page in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop();
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const tripId = await upcomingBookableTrip(plain, shop.id);
    await publicTripPageReads(db, shop.slug, tripId);
    expect(report("public trip phases", phases())).toBeLessThanOrEqual(PUBLIC_TRIP_PHASE_CEILING);
  });

  it("reads /ready in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop();
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const token = await readinessLinkForUpcomingSeat(plain, shop.id);
    await readyPageReads(db, token);
    expect(report("ready phases", phases())).toBeLessThanOrEqual(READY_PHASE_CEILING);
  });
});

/** What each render sends today: lower one when a change saves a statement, never raise it quietly. */
const GATE_CEILING = 4;
// 17 → 19: the Today badge also counts divers blocked aboard a boat still out
// past the horizon (`countBlockedDiversNextBoatDay` → `blockedAboardOnBoatsOut`,
// UX audit 2026-10-07 item 1): two statements over the boats still out.
// 19 → 20 and 60 → 61: readiness reads the forms its course sessions ask for
// (`requiredCourseFormsForTrips`, ADR 20261008-course-forms). The seeded shop
// has course sessions in the horizon, so the read runs; a horizon of fun dives
// skips it, and the signatures read is skipped while no course asks for a form.
const CHROME_CEILING = 20;
// 61 → 62: the bench's two Today rows, late and uncollected work orders, are
// one statement (`listWorkOrdersNeedingAttention`, ADR 20261008-work-order-follow-up).
// 62 → 63: a diver first counted aboard at a later checkpoint is on the boat
// too (issue #2142), so the queue reads who was boarded at any checkpoint
// (`listBoardedAtAnyCheckpointByTrip`), one statement over the queue's trips.
// 63 → 64: an undecided chargeback is a Today row for the owner
// (`listOpenPaymentDisputes`, ADR 20261009-stripe-reversals-reach-diveday),
// one statement read beside the stuck operations.
// 64 → 66: the owner row for expired boat papers and safety kit
// (`listExpiredBoatSafety`, roadmap N-08) reads the fleet's paper dates and the
// safety-kit units. Their clocks are a third read, skipped while the register
// holds no safety kit, as the seeded shop's does not.
const TODAY_CEILING = 66;
// 49 → 50: the roster reads each diver's unspent package dives for the payment
// control (`spendableDivesForTrip`, H-79, issue #1697). The held seat's
// last-dive-day read beside it (`lastDiveDaysHere`, #1789) skips itself when no
// seat on the departure is held, as none is on the one measured here.
const TRIP_CEILING = 50;

/**
 * Serial phases, the same way: lower one when a change removes a wait, never
 * raise it quietly. Today measured 23 before its reads were grouped (code
 * review 2026-10-10, item 2: `getTodayWork` awaited thirteen single reads one
 * after another after its one fan-out); they now go out in one wave, and what
 * is left is the readiness pass's own chain and the readers' internal steps.
 * The trip page's 10 is its shared reads, then `getTripOverview`'s four steps
 * after its fan-out (`src/db/trips-overview.ts`).
 */
// 7 → 8: not a new wait, an old one made visible. The marine provider now
// answers after the database goes quiet, as a real one does, and Today's queue
// awaited it inside its wave (code review 2026-10-11, item 1).
const TODAY_PHASE_CEILING = 8;
const TRIP_PHASE_CEILING = 10;

/**
 * The diver pages, measured 2026-10-12 before their reads were grouped (code
 * review 2026-10-11, items 2 and 3): the public booking page awaited eight
 * reads one after another after its fan-out, and `/ready` its readiness pass,
 * four more steps of `getReadyPageData` and five single awaits in the thread.
 */
const PUBLIC_TRIP_CEILING = 18;
const READY_CEILING = 36;
const PUBLIC_TRIP_PHASE_CEILING = 10;
const READY_PHASE_CEILING = 12;
