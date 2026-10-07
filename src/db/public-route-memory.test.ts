import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import {
  forgetPublicRouteLookups,
  PUBLIC_ROUTE_LOOKUP_TTL_MS,
  rememberedPublicRouteLookup,
} from "./public-route-existence";
import { courses, shops } from "./schema";

/**
 * The proxy's memory of public URLs that exist (app audit 2026-10-07, item
 * 21): what it saves, and the two promises it makes about staleness — a new
 * row is never refused by a remembered answer, and a stale yes lasts at most
 * one TTL.
 */

let db: AppDb;
let slug: string;
let opened = 0;
const open = async () => {
  opened += 1;
  return db;
};

beforeEach(async () => {
  forgetPublicRouteLookups();
  opened = 0;
  const context = await seededShopContext();
  db = context.db;
  slug = context.shop.slug;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("remembering which public URLs exist", () => {
  it("opens the pool once for a live shop, then answers from memory", async () => {
    const first = await rememberedPublicRouteLookup({ kind: "shop", shopSlug: slug }, open);
    const second = await rememberedPublicRouteLookup({ kind: "shop", shopSlug: slug }, open);
    expect(first).toEqual({ exists: true, shopExists: true, hidden: false });
    expect(second).toEqual(first);
    expect(opened).toBe(1);
  });

  it("never remembers a refusal, so a row created a moment later is served at once", async () => {
    const shape = { kind: "shop" as const, shopSlug: `new-${randomUUID().slice(0, 8)}` };
    expect((await rememberedPublicRouteLookup(shape, open)).exists).toBe(false);
    // The slug starts naming a shop - the same moment a sign-up would make it.
    await db.update(shops).set({ slug: shape.shopSlug }).where(eq(shops.slug, slug));
    expect((await rememberedPublicRouteLookup(shape, open)).exists).toBe(true);
    expect(opened).toBe(2);
  });

  it("holds a yes for one TTL and asks again after, so a deleted row lingers no longer", async () => {
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const shape = { kind: "trip" as const, shopSlug: slug, tripId: randomUUID() };
    // A yes for a departure, as the lookup would have given it while it was live.
    const live = await rememberedPublicRouteLookup({ kind: "shop", shopSlug: slug }, open);
    expect(live.exists).toBe(true);
    now += PUBLIC_ROUTE_LOOKUP_TTL_MS - 1;
    await rememberedPublicRouteLookup({ kind: "shop", shopSlug: slug }, open);
    expect(opened).toBe(1);
    now += 1;
    await rememberedPublicRouteLookup({ kind: "shop", shopSlug: slug }, open);
    expect(opened).toBe(2);
    // An unknown departure under the same shop is its own key, asked afresh.
    expect((await rememberedPublicRouteLookup(shape, open)).exists).toBe(false);
    expect(opened).toBe(3);
  });

  it("does not remember a hidden course, so publishing it shows at once", async () => {
    const [course] = await db
      .select({ id: courses.id, slug: courses.slug })
      .from(courses)
      .where(
        eq(
          courses.shopId,
          (await db.select().from(shops).where(eq(shops.slug, slug)))[0]?.id ?? "",
        ),
      )
      .limit(1);
    if (!course) throw new Error("seed: no course");
    await db.update(courses).set({ isActive: false }).where(eq(courses.id, course.id));
    const shape = { kind: "course" as const, shopSlug: slug, courseSlug: course.slug };
    expect(await rememberedPublicRouteLookup(shape, open)).toMatchObject({ hidden: true });
    await db.update(courses).set({ isActive: true }).where(eq(courses.id, course.id));
    expect(await rememberedPublicRouteLookup(shape, open)).toMatchObject({ hidden: false });
    expect(opened).toBe(2);
  });

  it("never remembers a failure", async () => {
    const failing = async () => {
      opened += 1;
      throw new Error("database unavailable");
    };
    const shape = { kind: "shop" as const, shopSlug: slug };
    await expect(rememberedPublicRouteLookup(shape, failing)).rejects.toThrow();
    expect((await rememberedPublicRouteLookup(shape, open)).exists).toBe(true);
    expect(opened).toBe(2);
  });
});
