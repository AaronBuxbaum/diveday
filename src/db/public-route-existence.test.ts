// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { publicRouteExists } from "./public-route-existence";
import { courses, diveSites, shops, trips } from "./schema";
import { createTrip, setTripStatus } from "./trips";

const ctx = fileScopedShopContext();
const HOUR_MS = 60 * 60 * 1000;

/**
 * A database handle that fails the test the moment anything touches it — the
 * only honest way to assert that a shape needing no query makes none.
 */
const NO_DATABASE = new Proxy(
  {},
  {
    get() {
      throw new Error("publicRouteExists queried the database for a malformed route");
    },
  },
) as unknown as AppDb;

async function aCourseSlug(): Promise<string> {
  const [course] = await ctx.db
    .select({ slug: courses.slug })
    .from(courses)
    .where(eq(courses.shopId, ctx.shop.id))
    .limit(1);
  if (!course) throw new Error("seed: the demo shop has no courses");
  return course.slug;
}

async function aSiteSlug(): Promise<string> {
  const [site] = await ctx.db
    .select({ slug: diveSites.slug })
    .from(diveSites)
    .where(eq(diveSites.shopId, ctx.shop.id))
    .limit(1);
  if (!site) throw new Error("seed: the demo shop has no dive sites");
  return site.slug;
}

async function aDeparture(overrides: Partial<Parameters<typeof createTrip>[1]> = {}) {
  const startsAt = new Date(nowDate().getTime() + 3 * 24 * HOUR_MS);
  const trip = await createTrip(ctx.db, {
    shopId: ctx.shop.id,
    title: "Probe",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 4,
    ...overrides,
  });
  if (!trip) throw new Error("createTrip refused the probe departure");
  return trip.id;
}

/** A second shop, so "belongs to somebody else" can be asked for real. */
async function anotherShop(): Promise<string> {
  const slug = `other-shop-${randomUUID().slice(0, 8)}`;
  await ctx.db.insert(shops).values({ name: "Other Shop", slug, timezone: "America/New_York" });
  return slug;
}

describe("publicRouteExists", () => {
  it("answers a malformed shape without opening a connection", async () => {
    await expect(publicRouteExists(NO_DATABASE, { kind: "malformed" })).resolves.toBe(false);
  });

  it("finds a live shop and refuses a slug nobody holds", async () => {
    await expect(
      publicRouteExists(ctx.db, { kind: "shop", shopSlug: ctx.shop.slug }),
    ).resolves.toBe(true);
    await expect(
      publicRouteExists(ctx.db, { kind: "shop", shopSlug: "no-such-shop" }),
    ).resolves.toBe(false);
  });

  it("finds a course, an inactive one included", async () => {
    const courseSlug = await aCourseSlug();
    const shape = { kind: "course", shopSlug: ctx.shop.slug, courseSlug } as const;
    await expect(publicRouteExists(ctx.db, shape)).resolves.toBe(true);

    // `courses/[slug]/page.tsx` serves an inactive course to a staff previewer
    // and 404s it for everyone else. That decision is the page's; an edge that
    // made it first would refuse a URL the previewer is meant to reach.
    await ctx.db
      .update(courses)
      .set({ isActive: false })
      .where(and(eq(courses.shopId, ctx.shop.id), eq(courses.slug, courseSlug)));
    await expect(publicRouteExists(ctx.db, shape)).resolves.toBe(true);
  });

  it("finds a dive site, and refuses a slug the shop never minted", async () => {
    const siteSlug = await aSiteSlug();
    await expect(
      publicRouteExists(ctx.db, { kind: "site", shopSlug: ctx.shop.slug, siteSlug }),
    ).resolves.toBe(true);
    await expect(
      publicRouteExists(ctx.db, {
        kind: "site",
        shopSlug: ctx.shop.slug,
        siteSlug: "never-minted-reef",
      }),
    ).resolves.toBe(false);
  });

  it("finds a departure, and refuses an id no departure carries", async () => {
    const tripId = await aDeparture();
    await expect(
      publicRouteExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId }),
    ).resolves.toBe(true);
    await expect(
      publicRouteExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId: randomUUID() }),
    ).resolves.toBe(false);
  });

  it("refuses another shop's course, dive site and departure", async () => {
    const shopSlug = await anotherShop();
    const [courseSlug, siteSlug, tripId] = [
      await aCourseSlug(),
      await aSiteSlug(),
      await aDeparture(),
    ];
    await expect(publicRouteExists(ctx.db, { kind: "course", shopSlug, courseSlug })).resolves.toBe(
      false,
    );
    await expect(publicRouteExists(ctx.db, { kind: "site", shopSlug, siteSlug })).resolves.toBe(
      false,
    );
    await expect(publicRouteExists(ctx.db, { kind: "trip", shopSlug, tripId })).resolves.toBe(
      false,
    );
  });

  /**
   * The invariant, stated as the two cases that would break it. Both rows are
   * still on the board and each of their pages declines to render them in its
   * own way — a cancelled departure at 200 with its own soft landing, an
   * unlisted one through `publicBoatLine`'s `notFound()`. The edge must hand
   * both to the page: a refusal here is the page's decision taken by a layer
   * that cannot see the reader, and it is how a working shop becomes a 404.
   */
  it("never refuses a departure still on the board, whatever the page will make of it", async () => {
    const cancelled = await aDeparture();
    await setTripStatus(ctx.db, ctx.shop.id, cancelled, "cancelled");
    const unlisted = await aDeparture({ isPrivate: true });

    for (const tripId of [cancelled, unlisted]) {
      await expect(
        publicRouteExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId }),
      ).resolves.toBe(true);
    }
  });

  it("refuses a departure the shop took off the board", async () => {
    // The one status-shaped predicate the edge does carry, and only because
    // every public reader of a departure carries it too: `getTripWithBooked`
    // and `publicBoatLine` both 404 a deleted row, so refusing it here matches
    // the page rather than overruling it.
    const removed = await aDeparture();
    await ctx.db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, removed));
    await expect(
      publicRouteExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId: removed }),
    ).resolves.toBe(false);
  });
});
