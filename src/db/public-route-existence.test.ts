// @vitest-environment node
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import type { PublicRouteQuery } from "@/lib/public-route-shape";
import { fileScopedShopContext } from "@/test/db";
import type { AppDb } from "./client";
import { publicRouteLookup } from "./public-route-existence";
import { courses, diveSites, shops, trips } from "./schema";
import { createTrip, setTripStatus } from "./trips";

const ctx = fileScopedShopContext();
const HOUR_MS = 60 * 60 * 1000;

/** The half of the answer most of these tests are about. */
async function routeExists(db: AppDb, shape: PublicRouteQuery): Promise<boolean> {
  return (await publicRouteLookup(db, shape)).exists;
}

/**
 * The same database, counting the reads that pass through it.
 *
 * Every reader this module calls goes out through `db.select()`, so the count
 * is the number of round trips a shape costs — which is the thing the return
 * shape exists to hold down. The proxy used to ask a refused route about its
 * shop a second time, and nothing failed when it did.
 *
 * The one shape where the count is not the round-trip count is `region`:
 * `listedShopScope` composes an `exists(...)` subquery, which is a second
 * `db.select()` that never leaves on its own. That test says so where it
 * asserts.
 */
function countingDb(db: AppDb): { db: AppDb; reads: () => number } {
  let reads = 0;
  const counting = new Proxy(db as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "select" || typeof value !== "function") return value;
      return (...args: unknown[]) => {
        reads += 1;
        return (value as (...called: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as AppDb;
  return { db: counting, reads: () => reads };
}

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

describe("publicRouteLookup", () => {
  it("answers a malformed shape with the one read that frames it", async () => {
    // A segment no shop could have minted needs no query to be refused. The
    // shop under it is a different question, and the refusal is framed as that
    // shop's (issue #765), so the shop read is made — once, here, rather than
    // by a second call from the proxy.
    const counting = countingDb(ctx.db);
    await expect(
      publicRouteLookup(counting.db, { kind: "malformed", shopSlug: ctx.shop.slug }),
    ).resolves.toEqual({ exists: false, shopExists: true });
    expect(counting.reads()).toBe(1);
  });

  /**
   * The fact the proxy stamps on `REFUSED_SHOP_SLUG_HEADER`, and the reason
   * this function answers with a record rather than a boolean: a dead link
   * under a live shop is owed that shop's own 404, and working that out used to
   * cost a third read of `shops.slug` on the one request nobody legitimate is
   * making.
   */
  it("says whether the shop is there, on the same read that refuses the route", async () => {
    const counting = countingDb(ctx.db);
    await expect(
      publicRouteLookup(counting.db, {
        kind: "course",
        shopSlug: ctx.shop.slug,
        courseSlug: "never-minted-course",
      }),
    ).resolves.toEqual({ exists: false, shopExists: true });
    expect(counting.reads()).toBe(2);

    // No shop, so nothing under it is looked up and nothing frames the 404.
    const missing = countingDb(ctx.db);
    await expect(
      publicRouteLookup(missing.db, {
        kind: "course",
        shopSlug: "no-such-shop",
        courseSlug: "never-minted-course",
      }),
    ).resolves.toEqual({ exists: false, shopExists: false });
    expect(missing.reads()).toBe(1);
  });

  it("finds a live shop and refuses a slug nobody holds", async () => {
    await expect(routeExists(ctx.db, { kind: "shop", shopSlug: ctx.shop.slug })).resolves.toBe(
      true,
    );
    await expect(routeExists(ctx.db, { kind: "shop", shopSlug: "no-such-shop" })).resolves.toBe(
      false,
    );
  });

  /**
   * **The accepted disclosure, pinned.** A course a shop has hidden answers
   * `true` here and a slug it never minted answers `false`, so from outside the
   * two are one status apart — the price of leaving `isActive` to the page,
   * weighed in this module's header rather than overlooked (issue #1735). The
   * flip is what this assertion guards: an edge that applied `isActive` would
   * hard-404 the staff previewer, whose own check is live and per-shop and who
   * arrives here carrying nothing the edge can verify.
   */
  it("finds a course a shop has hidden, and refuses a slug it never minted", async () => {
    const courseSlug = await aCourseSlug();
    const shape = { kind: "course", shopSlug: ctx.shop.slug, courseSlug } as const;
    await expect(routeExists(ctx.db, shape)).resolves.toBe(true);
    await expect(
      routeExists(ctx.db, {
        kind: "course",
        shopSlug: ctx.shop.slug,
        courseSlug: "never-minted-course",
      }),
    ).resolves.toBe(false);

    // `courses/[slug]/page.tsx` serves an inactive course to a staff previewer
    // and 404s it for everyone else. That decision is the page's; an edge that
    // made it first would refuse a URL the previewer is meant to reach.
    await ctx.db
      .update(courses)
      .set({ isActive: false })
      .where(and(eq(courses.shopId, ctx.shop.id), eq(courses.slug, courseSlug)));
    await expect(routeExists(ctx.db, shape)).resolves.toBe(true);
  });

  it("finds a dive site, and refuses a slug the shop never minted", async () => {
    const siteSlug = await aSiteSlug();
    await expect(
      routeExists(ctx.db, { kind: "site", shopSlug: ctx.shop.slug, siteSlug }),
    ).resolves.toBe(true);
    await expect(
      routeExists(ctx.db, {
        kind: "site",
        shopSlug: ctx.shop.slug,
        siteSlug: "never-minted-reef",
      }),
    ).resolves.toBe(false);
  });

  it("finds a departure, and refuses an id no departure carries", async () => {
    const tripId = await aDeparture();
    await expect(
      routeExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId }),
    ).resolves.toBe(true);
    await expect(
      routeExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId: randomUUID() }),
    ).resolves.toBe(false);
  });

  it("refuses another shop's course, dive site and departure", async () => {
    const shopSlug = await anotherShop();
    const [courseSlug, siteSlug, tripId] = [
      await aCourseSlug(),
      await aSiteSlug(),
      await aDeparture(),
    ];
    await expect(routeExists(ctx.db, { kind: "course", shopSlug, courseSlug })).resolves.toBe(
      false,
    );
    await expect(routeExists(ctx.db, { kind: "site", shopSlug, siteSlug })).resolves.toBe(false);
    await expect(routeExists(ctx.db, { kind: "trip", shopSlug, tripId })).resolves.toBe(false);
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
        routeExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId }),
      ).resolves.toBe(true);
    }
  });

  /**
   * The one shape with no shop over it (issue #1734). `shopExists: false` is
   * not "the shop is gone" here, it is "there was never a shop in the URL" —
   * the proxy reads it as "frame this as DiveDay's own refusal", which is what
   * `/dive/<town>` is.
   */
  it("answers a town on one read, and names no shop to frame it as", async () => {
    const counting = countingDb(ctx.db);
    await expect(
      publicRouteLookup(counting.db, { kind: "region", regionSlug: "key-largo" }),
    ).resolves.toEqual({ exists: true, shopExists: false });
    // Two `db.select()` calls, one statement: `listedShopScope` composes an
    // `exists(...)` subquery that never leaves on its own, and reading the
    // scope through the page's own fragment rather than hand-writing the join
    // is the invariant. What matters is what is absent — the `shops.slug`
    // probe every other shape opens with, which asks whose refusal a diver is
    // about to read, and a town has no answer to that.
    expect(counting.reads()).toBe(2);

    await expect(
      publicRouteLookup(ctx.db, { kind: "region", regionSlug: "not-a-town" }),
    ).resolves.toEqual({ exists: false, shopExists: false });
  });

  it("refuses a departure the shop took off the board", async () => {
    // The one status-shaped predicate the edge does carry, and only because
    // every public reader of a departure carries it too: `getTripWithBooked`
    // and `publicBoatLine` both 404 a deleted row, so refusing it here matches
    // the page rather than overruling it.
    const removed = await aDeparture();
    await ctx.db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, removed));
    await expect(
      routeExists(ctx.db, { kind: "trip", shopSlug: ctx.shop.slug, tripId: removed }),
    ).resolves.toBe(false);
  });
});

/**
 * The premise the proxy's `catch` is built on, pinned against a real database.
 *
 * A shop slug is not pattern-checked before it gets here — the row decides, and
 * `public-route-shape.ts` says at length why that must stay true. So a request
 * can hand this function a string Postgres will not accept as a text parameter,
 * and it raises instead of answering "no such shop". `src/lib/db-failure.ts`
 * reads that raise apart from an unreachable database; if this ever stopped
 * throwing, the `warn` branch it feeds would be dead code.
 */
describe("a slug the driver cannot send", () => {
  it("raises, carrying a SQLSTATE on the cause and the parameter in the wrapper's message", async () => {
    const slug = `blue${String.fromCharCode(0)}mantis`;
    const raised = await routeExists(ctx.db, { kind: "shop", shopSlug: slug }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(raised).toBeInstanceOf(Error);
    // Class 22, data exception: a server received the statement and refused it,
    // which is exactly what tells the classifier nothing is down.
    expect((raised as { cause?: { code?: string } })?.cause?.code).toBe("22021");
    // And why no branch logs the caught message: drizzle's wrapper repeats the
    // bound parameters verbatim, which here is the request's own string.
    expect(String((raised as Error).message)).toContain(slug);
  });
});
