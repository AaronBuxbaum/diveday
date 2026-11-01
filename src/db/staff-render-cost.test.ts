import type { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, gt, isNotNull, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inHorizonReadiness } from "@/db/blockers";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { getCourseFormsForBooking } from "@/db/course-forms";
import { hasActiveCourses } from "@/db/courses";
import { diverCrewWithAway } from "@/db/crew-away-diver";
import { packageDivesForBooking } from "@/db/dive-packages";
import { listDiveSiteBriefingExtras } from "@/db/dive-sites";
import { countGearItems } from "@/db/gear";
import { getBookingPayment } from "@/db/payments";
import { getTripRequirements, getTripSiteRequirement } from "@/db/readiness";
import { getReadyPageData } from "@/db/ready";
import { getShopReviewAggregate } from "@/db/reviews";
import { bookings, interests, people, personRoles, trips } from "@/db/schema";
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
  createTrip,
  getTripWithBooked,
  listTripDives,
  listTripScheduleDays,
  pagedUpcomingTripsWithCounts,
  tripCrewSpokenLanguages,
} from "@/db/trips";
import { getTripGuests } from "@/db/trips-guests";
import { liveTrip } from "@/db/trips-live";
import { getTripOverview } from "@/db/trips-overview";
import { loadTripSharedReads } from "@/db/trips-shared-reads";
import { nowDate } from "@/lib/clock";
import { perDiverBookingPriceCents } from "@/lib/courses";
import { queryTimingLogger, withQueryStats } from "@/lib/observability/query-timing";
import { seededShopContext } from "@/test/db";
import { phaseCountingDb, report } from "@/test/render-phases";

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
 * replay beside it. The public schedule and `/ready` after the dive replay
 * readers that live in `src/app`, so they are measured beside them, in
 * `src/app/diver-render-cost.test.ts`.
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

/**
 * A readiness link on the lead of a party of `size` booked on the next
 * departure, every other seat unclaimed — the shape `/ready` mints a claim
 * link for per seat (#2488).
 */
async function readinessLinkForParty(plain: AppDb, shopId: string, size: number) {
  // A departure of its own with room for the whole party.
  const startsAt = new Date(nowDate().getTime() + 2 * 24 * 3_600_000);
  const trip = await createTrip(plain, {
    shopId,
    title: "Party departure",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * 3_600_000),
    capacity: 12,
  });
  if (!trip) throw new Error("trip not created");
  const tripId = trip.id;
  const stamp = `${nowDate().getTime()}`;
  const party = await createBookingParty(
    plain,
    Array.from({ length: size }, (_, index) => ({
      actor: "staff" as const,
      shopId,
      tripId,
      fullName: `Party Seat ${index + 1}`,
      email: `party-seat-${index + 1}-${stamp}@example.com`,
    })),
  );
  const lead = party.ok ? party.bookings[0] : undefined;
  if (!lead) throw new Error(`the party was not booked: ${JSON.stringify(party)}`);
  const issued = await issueBookingCapability(plain, {
    shopId,
    bookingId: lead.bookingId,
    purpose: "readiness",
  });
  if (!issued) throw new Error("no readiness link for the party lead");
  return issued.token;
}

/**
 * The public booking page's reads, as the page awaits them: the shop, the
 * fan-out, then one wave of everything else (code review 2026-10-11, item 2).
 */
async function publicTripPageReads(db: AppDb, shopSlug: string, tripId: string) {
  const shop = await getShopBySlug(db, shopSlug);
  if (!shop) throw new Error("no shop");
  // `readTripPage`'s one wave (issue #2353): a read that needs another's answer
  // chains off it inside the wave — the briefings off the dives, the Stripe
  // account and the other boats off the trip.
  const tripRead = getTripWithBooked(db, shop.id, tripId);
  const tripDivesRead = listTripDives(db, shop.id, tripId);
  const [trip] = await Promise.all([
    tripRead,
    tripDivesRead,
    listTripScheduleDays(db, shop.id, tripId),
    tripCrewSpokenLanguages(db, shop.id, tripId),
    tripRead.then((found) => (found ? diverCrewWithAway(db, shop.id, found, shop.timezone) : [])),
    listTripChangeEvents(db, shop.id, tripId),
    tripDivesRead.then((dives) => {
      const siteIds = dives
        .map(({ diveSite }) => diveSite?.id)
        .filter((id): id is string => Boolean(id));
      return Promise.all([
        listDiveSiteBriefingExtras(db, shop.id, siteIds),
        siteSightings(db, shop.id, siteIds),
      ]);
    }),
    getTripRequirements(db, shop.id, tripId),
    getTripSiteRequirement(db, shop.id, tripId),
    tripRead.then((found) =>
      found && perDiverBookingPriceCents(found, found.course)
        ? getShopStripeAccount(db, shop.id)
        : null,
    ),
    tripRead.then((found) =>
      !found || found.conditionsHold
        ? []
        : pagedUpcomingTripsWithCounts(db, shop.id, {
            now: nowDate(),
            limit: 50,
            hasSpace: true,
            publicOnly: true,
          }).then((page) => page.trips),
    ),
    shop.reviewsEnabled ? getShopReviewAggregate(db, shop.id) : null,
  ]);
  if (!trip) throw new Error("no trip");
}

/**
 * `/ready`'s reads on the night-before visit, as the page awaits them: the
 * capability, `getReadyPageData`'s two chains side by side, then the thread's
 * one wave (code review 2026-10-11, item 3).
 */
async function readyPageReads(db: AppDb, token: string) {
  const capability = await verifyBookingCapability(db, { token, purpose: "readiness" });
  if (!capability) throw new Error("the readiness link did not verify");
  const data = await getReadyPageData(db, capability.bookingId);
  if (!data) throw new Error("no ready page data");
  await Promise.all([
    issuePartySeatClaims(db, { shopId: data.shop.id, leadBookingId: capability.bookingId }),
    getShopBySlug(db, data.shop.slug),
    getTripWithBooked(db, data.shop.id, data.trip.id),
    listTripDives(db, data.shop.id, data.trip.id),
    listTripChangeEvents(db, data.shop.id, data.trip.id),
    diverCrewWithAway(db, data.shop.id, data.detail.trip, data.detail.shop.timezone),
    latestTripStage(db, data.shop.id, data.trip.id),
    getBookingPayment(db, data.shop.id, capability.bookingId),
    data.asksCourseForms ? getCourseFormsForBooking(db, data.shop.id, capability.bookingId) : null,
    packageDivesForBooking(db, {
      shopId: data.shop.id,
      personId: data.person.id,
      bookingId: capability.bookingId,
    }),
  ]);
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

/**
 * **The trip page on a departure that wakes every trailing read** (#2487): a
 * course session (materials, next steps), a held seat (the identity reads) and
 * a wait-listed diver (the last-minute and waitlist reads). On the plain seed
 * four of `getTripGuests`' five trailing reads skip themselves, so the ceiling
 * above never saw the wave they make.
 */
describe("the trip page on a course departure with a held seat and a waitlist", () => {
  it("reads overview and guests in a bounded number of phases", async () => {
    const { plain, shop, ownerId } = await timedSeededShop();
    const [trip] = await plain
      .select({ id: trips.id })
      .from(trips)
      .where(
        and(
          eq(trips.shopId, shop.id),
          liveTrip(),
          isNotNull(trips.courseId),
          gt(trips.startsAt, nowDate()),
        ),
      )
      .orderBy(asc(trips.startsAt))
      .limit(1);
    if (!trip) throw new Error("the seeded shop has no upcoming course departure");
    const [seat] = await plain
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.tripId, trip.id), eq(bookings.status, "booked")))
      .limit(1);
    if (!seat) throw new Error("the course departure has no booked seat");
    await plain
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Someone Else" })
      .where(eq(bookings.id, seat.id));
    const [waiting] = await plain
      .select({ id: people.id })
      .from(people)
      .where(
        and(
          eq(people.shopId, shop.id),
          notInArray(
            people.id,
            plain
              .select({ id: bookings.personId })
              .from(bookings)
              .where(eq(bookings.tripId, trip.id)),
          ),
        ),
      )
      .limit(1);
    if (!waiting) throw new Error("no diver is free to wait-list");
    await plain.insert(interests).values({
      shopId: shop.id,
      tripId: trip.id,
      scope: "departure",
      askedBy: "diver",
      personId: waiting.id,
      partySize: 1,
    });
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const shared = loadTripSharedReads(db, shop.id, trip.id);
    await Promise.all([
      getTripOverview(db, shop, trip.id, ownerId, undefined, shared),
      getTripGuests(db, shop, trip.id, {}, shared),
    ]);
    expect(report("trip phases, held seat + waitlist + course", phases())).toBeLessThanOrEqual(
      TRIP_WIDE_PHASE_CEILING,
    );
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

  // The party panel mints a claim link per unclaimed seat: in one statement
  // for the whole party, so three seats wait no longer than one (#2488).
  it("reads /ready for a party of three in a bounded number of phases", async () => {
    const { plain, shop } = await timedSeededShop();
    const { db, phases } = phaseCountingDb(plain.$client as PGlite);
    const token = await readinessLinkForParty(plain, shop.id, 3);
    await readyPageReads(db, token);
    expect(report("ready phases, party of three", phases())).toBeLessThanOrEqual(
      READY_PARTY_PHASE_CEILING,
    );
  });

  it("sends no more statements for a party of six than for a party of three", async () => {
    const small = await timedSeededShop();
    const smallToken = await readinessLinkForParty(small.plain, small.shop.id, 3);
    const threeSeats = await withQueryStats(() => readyPageReads(small.db, smallToken));
    const large = await timedSeededShop();
    const largeToken = await readinessLinkForParty(large.plain, large.shop.id, 6);
    const sixSeats = await withQueryStats(() => readyPageReads(large.db, largeToken));
    expect(report("ready, party of six", sixSeats.stats.queries)).toBe(threeSeats.stats.queries);
    expect(threeSeats.stats.queries).toBeLessThanOrEqual(READY_PARTY_CEILING);
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
// 66 → 67, in this replay only: Today's queue reads the Stripe account inside
// its wave whenever a seat in the window owes money, rather than after it when a
// payment row was raised (code review 2026-10-11, item 26). In a render that is
// the page's own read, shared through `shopStripeAccountForRender`'s `cache()`;
// here `cache()` calls straight through, so the replay counts it twice.
// 67 → 65 (third review, item 4): a boat's work is one reader
// (`readBoatWork`), its sizes, nitrox and contact questions one statement over
// the seats, where Today used to send four. It also counts each boat's open
// orders, a statement Today did not send before.
// 65 → 66: a "certification pending" row offers the agency check (H-20261008-cert-check-extension), so
// Today reads which of the blocked divers' cards the extension could look up
// (`listAgencyCheckableCards`), one statement beside the wave, not after it.
// 66 → 69 (fourth review, items 12 and 14): Today names rostered crew who are
// away (`crewAwayByTrip`, the departures' crew, schedule days and days away)
// and keeps every crew assignment on "Your week" (`readerCrewedTrips`), three
// statements in the queue's one wave.
// 69 → 70 (H-20260916-may-one-hull-carry, issue #2135): a boat on two departures at once is raised on
// Today beside the crew clash (`boatClashesByTrip`), one batched read in the
// same wave as the crew's.
// 70 → 71 (fifth loop, items 3 and 7): the count of found items waiting to go
// home, one statement beside the wave rather than after it, so the phase count
// below does not move. The emergency card rides the shop row the wave reads.
// 71 → 72 (fifth loop, ideas item 1): the open snags the crew wrote against a
// boat's checklist (`openSnagsForShop`), one statement in the wave, so the
// phase count does not move.
// 72 → 73 (issue #2658): the unanswered row counts the open date requests
// (`countOpenDateRequests`), one statement in the wave.
// 73 → 74 (issue #2678): `crewAwayByTrip` reads who is working it anyway
// beside the roster, one statement in the same phase.
const TODAY_CEILING = 74;
// 49 → 50: the roster reads each diver's unspent package dives for the payment
// control (`spendableDivesForTrip`, H-20260916-unconfirmed-identity-withhold-cost, issue #1697). The held seat's
// last-dive-day read beside it (`lastDiveDaysHere`, #1789) skips itself when no
// seat on the departure is held, as none is on the one measured here.
// 50 → 51 (third review, item 4): the band reads the boat's work through the
// reader Today reads (`readBoatWork`), so it now also names nitrox with no card
// and missing emergency contacts. One statement over the seats replaces the
// shared prep list's fit check, and the open-orders count is the one it sent.
// 51 → 52: the roster's agency check (H-20261008-cert-check-extension) reads the seated divers' checkable
// cards (`listAgencyCheckableCards`), one statement in `getTripGuests`' fan-out.
// 52 → 54: the same read also asks for the divers' pending nitrox and specialty
// cards (issue #2592), one statement each, in the same wave as the level read.
// 54 → 55 (issue #2275): on a departure that is not a course session, the
// roster reads each diver's course seats a training mark may name
// (`trainingMarksForRoster`), one statement in the same wave. The marks
// themselves cost nothing until one is set.
// 55 → 66 (fifth loop, r5-6 item 44, H-20261014-one-to-one-invite): the Invite section's past divers
// of the site (`listInviteSuggestions`): the departure row, who is aboard or
// already asked, the 30-day cooldown and the boat's gate in one wave, the
// site's past divers, then every candidate's cards and courses in training in
// one pass (`admittedUnderGate`). As merged it sent each candidate through the
// booking gate one after another: 117 statements and 31 phases here.
// 66 → 67 (dive-domain second pass, X3): the same pass also asks which
// candidates' releases wait on a physician's referral (`physicianReferrals`),
// one statement in the cards' wave, so no new phase.
// 67 → 68 (#2678 dock review S2): who is said to be working it anyway, for the
// crew panel's "No longer working it" (`listCrewAwayAcknowledgements`), one
// statement in the overview's wave, only while the boat is ahead.
const TRIP_CEILING = 68;

/**
 * Serial phases, the same way: lower one when a change removes a wait, never
 * raise it quietly. Today measured 23 before its reads were grouped (code
 * review 2026-10-10, item 2: `getTodayWork` awaited thirteen single reads one
 * after another after its one fan-out); they now go out in one wave, and what
 * is left is the readiness pass's own chain and the readers' internal steps.
 * The trip page measured 10: its shared reads, then `getTripOverview`'s four
 * steps after its fan-out. 10 → 7: the overview's dependent reads (ratings and
 * shifts on the crew, the off-cadence list, both clash reads) now chain inside
 * its one wave (`src/db/trips-overview.ts`, issue #2353).
 */
// 7 → 8: not a new wait, an old one made visible. The marine provider now
// answers after the database goes quiet, as a real one does, and Today's queue
// awaited it inside its wave (code review 2026-10-11, item 1).
// 8 → 5 (code review 2026-10-11): the high-wind rows stream beside the page
// instead (item 1), the readiness pass reads payments, course forms and the
// evidence in one wave (item 13), and the payment rows' Stripe reads joined the
// queue's wave (item 26).
const TODAY_PHASE_CEILING = 5;
// 7 → 6 (code review 2026-10-11): the readiness pass's payments, course forms
// and evidence go out in one wave (item 13), and `getTripGuests`' five trailing
// reads are one wave too (item 12); on the departure measured here four of
// those skip themselves (no held seat, wait list or course).
// 6 → 5 (#2487): the departure row went out beside the four reads that never
// waited on it (`loadTripSharedReads`).
// 5 → 6 (fifth loop, r5-6 item 44): the invite suggestions need the
// departure's site before its past divers, and those before their cards: three
// waves inside `getTripGuests`' first, one more than the roster's own path.
const TRIP_PHASE_CEILING = 6;
// The same page on a course departure with a held seat and a waitlist: the
// shared wave (2), then the longest chain after it: the permission read (3
// here, one request-cached statement chain in a real render) and the
// off-cadence list that waits on it, or `getTripGuests`' fan-out and trailing
// wave.
const TRIP_WIDE_PHASE_CEILING = 6;

/**
 * The diver pages, measured 2026-10-12 before their reads were grouped (code
 * review 2026-10-11, items 2 and 3): the public booking page awaited eight
 * reads one after another after its fan-out, and `/ready` its readiness pass,
 * four more steps of `getReadyPageData` and five single awaits in the thread.
 */
// 18 → 20 (fourth review, item 12; r4-4 reviews N2/N5): both diver doors mark
// an away crew member "to be confirmed", which reads the departure's schedule
// days and the crew's days away beside the crew, in the same round trip.
// 20 → 21 (issue #2678): and who a staffer said is working it anyway, beside them.
const PUBLIC_TRIP_CEILING = 21;
// 36 → 38 (fourth review, item 12): the thread names the crew with who is
// away on the departure's days (`diverCrewWithAway`), which reads the
// schedule days and the days away beside the crew. Measured 38; the phases
// stay 5, since both ride the thread's one wave.
// 38 → 39 (#2687, H-20261014-ask-to-move): a seat that can still be released reads whether an
// ask to move stands (`hasMoveAsk`, one read), beside the rest of the page's
// fan-out, so the phases stay 5. The seed's booking ids are random, so which
// seat the test lands on varies: both a seat past the free window and one not
// past it must stay inside the ceiling.
// 39 → 40: the dive-package line reads what this seat itself spends beside
// what the diver has left (`packageDivesForBooking`, one `queryAll` wave), one
// statement more than the count it replaced, in the same round trip.
// 40 → 41 (issue #2676): the away mark reads through `crewAwayByTrip`, the one
// place the rule lives, which reads the departure's roster beside its public
// crew; still one round trip, since the window is passed in.
// 41 → 42 (issue #2678): and who a staffer said is working it anyway, beside them.
const READY_CEILING = 42;
// 10 → 3: the shop, then `readTripPage`'s one wave (issue #2353; code review
// 2026-10-11, item 2), whose chained reads — the briefings off the dives, the
// Stripe account and the other boats off the trip — are its third round trip.
// The live-staff check chains off the session inside the wave, and
// `generateMetadata` shares the trip row through `publicTripRecord`'s `cache()`:
// a statement saved in a render, not in this replay, which reads the body alone.
const PUBLIC_TRIP_PHASE_CEILING = 3;
// 12 → 5 (item 3): the capability; the readiness detail beside the booking
// row and its fan-out (`getReadyPageData`); the readiness pass's one wave; and
// the thread's one wave.
const READY_PHASE_CEILING = 5;
// 11 → 7 (#2488): a party of three. The claim panel minted one link per seat,
// one after another, each its own read, retire and insert; now the party's
// links are one read of the seats (which carries each departure's end), one
// read of the links already live, and one insert, whatever the party's size.
// The two above them are the capability and the readiness detail, as for one
// seat.
const READY_PARTY_PHASE_CEILING = 7;
// A party of three or six: the single seat's 40, plus the party panel's
// own reads and one claim-link mint for every unclaimed seat together.
// 40 → 42 (#2687, H-20261014-ask-to-move): the same move-ask read as the single seat's, and
// the same dive-package read.
const READY_PARTY_CEILING = 42;
