import type { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it, vi } from "vitest";
import { inHorizonReadiness } from "@/db/blockers";
import type { AppDb } from "@/db/client";
import { hasActiveCourses } from "@/db/courses";
import { countGearItems } from "@/db/gear";
import { people, personRoles, trips } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { getShopStripeAccount } from "@/db/stripe-accounts";
import {
  countBlockedDiversNextBoatDay,
  getShopDayDepartures,
  getTodayWork,
  todayNextDepartureTripId,
} from "@/db/today";
import { getTripGuests } from "@/db/trips-guests";
import { liveTrip } from "@/db/trips-live";
import { getTripOverview } from "@/db/trips-overview";
import { loadTripSharedReads } from "@/db/trips-shared-reads";
import { nowDate } from "@/lib/clock";
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
const TODAY_CEILING = 62;
const TRIP_CEILING = 49;
