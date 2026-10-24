import { existsSync } from "node:fs";
import path from "node:path";
import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowMs } from "@/lib/clock";
import { seededTestDb } from "@/test/db";
import { DEMO_SHOP_SLUG } from "./demo-shop";
import {
  bookings,
  globalDiveSites,
  people,
  personRoles,
  shops,
  tips,
  tripReviews,
  userAccounts,
} from "./schema";
import {
  createDemoShop,
  deleteDemoShopCascade,
  MINTED_DEMO_BRAND_COLOR,
  reapExpiredDemoShops,
} from "./seed";

const DAY_MS = 24 * 60 * 60 * 1000;

type Db = Awaited<ReturnType<typeof seededTestDb>>;

/** The shop row, or undefined — for existence/absence assertions. */
async function findShop(db: Db, slug: string) {
  const [shop] = await db.select().from(shops).where(eq(shops.slug, slug)).limit(1);
  return shop;
}

/** The shop row, asserting it exists — for when we then use its id. */
async function requireShop(db: Db, slug: string) {
  const shop = await findShop(db, slug);
  if (!shop) throw new Error(`test setup: shop "${slug}" missing`);
  return shop;
}

// Keep full-history mint, full cascade and stale-TTL deletion as end-to-end
// oracles. Identity/configuration cases use a lean minted shop. The individual
// FK regressions of `deleteDemoShopCascade` are in reap-demos-cascade.test.ts,
// on one database for the file (2026-10-24: this file was 140 s, the heaviest
// one the unit shards deal).
describe("createDemoShop", () => {
  it("mints a self-contained, seeded demo shop with a generated identity", async () => {
    const db = await seededTestDb();
    const { slug, ownerEmail } = await createDemoShop(db);

    expect(slug).not.toBe(DEMO_SHOP_SLUG);
    expect(ownerEmail).toBe(`dana@${slug}.demo.invalid`);

    const shop = await requireShop(db, slug);
    expect(shop.isDemo).toBe(true);

    // The owner account lands under the namespaced email — no collision with the
    // canonical demo's dana@bluemantis.example on the global user_accounts index.
    const [ownerAccount] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, ownerEmail))
      .limit(1);
    expect(ownerAccount).toBeDefined();

    // It's seeded: real bookings, and the same friendly staff cast by role.
    const shopBookings = await db.select().from(bookings).where(eq(bookings.shopId, shop.id));
    expect(shopBookings.length).toBeGreaterThan(0);
    expect((await db.select().from(tips).where(eq(tips.shopId, shop.id))).length).toBeGreaterThan(
      0,
    );
    expect(
      (await db.select().from(tripReviews).where(eq(tripReviews.shopId, shop.id))).length,
    ).toBeGreaterThan(0);

    const roles = await db
      .select({ role: personRoles.role })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(eq(people.shopId, shop.id));
    const roleSet = new Set(roles.map((r) => r.role));
    expect(roleSet.has("owner")).toBe(true);
    expect(roleSet.has("instructor")).toBe(true);
    expect(roleSet.has("divemaster")).toBe(true);
    expect(roleSet.has("captain")).toBe(true);
  });

  it("mints two demos side by side without a slug or email collision", async () => {
    const db = await seededTestDb();
    const a = await createDemoShop(db, { history: false });
    const b = await createDemoShop(db, { history: false });

    expect(a.slug).not.toBe(b.slug);
    expect(a.ownerEmail).not.toBe(b.ownerEmail);
    expect(await findShop(db, a.slug)).toBeDefined();
    expect(await findShop(db, b.slug)).toBeDefined();
    // The canonical demo still stands alongside both.
    expect(await findShop(db, DEMO_SHOP_SLUG)).toBeDefined();
  });

  it("regenerates the whole identity when a generated name is already taken", async () => {
    const db = await seededTestDb();
    const taken = await createDemoShop(db, { history: false });

    // Force the exact collision the dropped random suffix made possible: the
    // next mint draws a name that already exists. It must recover with a fresh
    // identity rather than throwing the unique violation at the visitor.
    const identity = await import("@/lib/demo-identity");
    const real = identity.generateDemoShopIdentity;
    const spy = vi
      .spyOn(identity, "generateDemoShopIdentity")
      .mockImplementationOnce(() => ({
        name: "Taken Name",
        slug: taken.slug,
        emailFor: (localPart: string) => `${localPart}@${taken.slug}.demo.invalid`,
      }))
      .mockImplementation(real);

    try {
      const minted = await createDemoShop(db, { history: false });
      expect(minted.slug).not.toBe(taken.slug);
      // The retry took a *whole* fresh identity: the emails agree with the
      // slug that actually landed, never the one that lost the race.
      expect(minted.ownerEmail).toBe(`dana@${minted.slug}.demo.invalid`);
      expect(await findShop(db, minted.slug)).toBeDefined();
      // The shop that already held the name is untouched.
      expect(await findShop(db, taken.slug)).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * **A minted shop wears a brand only when a capture asks it to.** A fresh
   * tenant is blank shop-wide config (ADR 20260815-per-test-private-shops), so
   * by default it has no logo, cover photo or badges. `brand` exists for the
   * one surface that needs all of them on file: the settings profile row,
   * where a stored logo and cover photo are taken back off (`settings-profile`).
   * The canonical demo wears its own profile (`seed-shop-brand.ts`); the
   * minted fixture differs from it in colour, face and logo.
   */
  it("wears the canonical demo's brand, and a logo, only when asked", async () => {
    const db = await seededTestDb();
    const plain = await requireShop(db, (await createDemoShop(db, { history: false })).slug);
    expect(plain.logoUrl).toBeNull();
    expect(plain.brandHeroImageUrl).toBeNull();
    expect(plain.brandBadges).toEqual([]);

    const canonical = await requireShop(db, DEMO_SHOP_SLUG);
    const branded = await requireShop(
      db,
      (await createDemoShop(db, { brand: true, history: false })).slug,
    );
    expect(branded.brandHeroImageUrl).toBe(canonical.brandHeroImageUrl);
    expect(branded.brandHeroImageAlt).toBe(canonical.brandHeroImageAlt);
    expect(branded.brandBadges).toEqual(canonical.brandBadges);
    // The colour and face are the minted fixture's own, apart from the
    // canonical demo's, so the brand spec proves the shop's choice is worn.
    expect(canonical.brandColor).toBeTruthy();
    expect(canonical.brandColor).not.toBe(MINTED_DEMO_BRAND_COLOR);
    expect(canonical.brandDisplayFont).not.toBe("bricolage_grotesque");
    expect(branded.brandColor).toBe(MINTED_DEMO_BRAND_COLOR);
    expect(branded.brandDisplayFont).toBe("bricolage_grotesque");
    // A bundled file, as the cover photo is, so a capture draws it with no
    // media storage configured, and a different one, so the two read apart.
    expect(branded.logoUrl).toMatch(/^\/dive-sites\//);
    expect(branded.logoUrl).not.toBe(branded.brandHeroImageUrl);
    const logoFile = path.join(process.cwd(), "public", decodeURIComponent(branded.logoUrl ?? ""));
    expect(existsSync(logoFile), logoFile).toBe(true);
  });

  it("evicts the oldest minted demo once the live cap is reached", async () => {
    const db = await seededTestDb();
    const prev = process.env.DEMO_SHOP_MAX_LIVE;
    process.env.DEMO_SHOP_MAX_LIVE = "2";
    try {
      const a = await createDemoShop(db, { history: false });
      const b = await createDemoShop(db, { history: false });
      // Age `a` explicitly. The test clock is frozen (src/test/frozen-clock.ts),
      // so every mint here shares one `createdAt` and "the oldest" would other-
      // wise be decided by `enforceMintedDemoCap`'s `id` tiebreak — which is
      // deterministic but arbitrary, and not the rule this test is about.
      // Back-dating makes `a` unambiguously the oldest by the column eviction
      // actually sorts on.
      await db
        .update(shops)
        .set({ createdAt: new Date(nowMs() - HOUR_MS) })
        .where(eq(shops.slug, a.slug));
      const c = await createDemoShop(db, { history: false });

      // Cap is 2, so minting c evicts the oldest minted demo (a); b and c stay,
      // and the canonical demo is never a candidate.
      expect(await findShop(db, a.slug)).toBeUndefined();
      expect(await findShop(db, b.slug)).toBeDefined();
      expect(await findShop(db, c.slug)).toBeDefined();
      expect(await findShop(db, DEMO_SHOP_SLUG)).toBeDefined();

      const liveMinted = await db
        .select({ id: shops.id })
        .from(shops)
        .where(and(eq(shops.isDemo, true), ne(shops.slug, DEMO_SHOP_SLUG)));
      expect(liveMinted.length).toBe(2);
    } finally {
      if (prev === undefined) delete process.env.DEMO_SHOP_MAX_LIVE;
      else process.env.DEMO_SHOP_MAX_LIVE = prev;
    }
  });
});

describe("deleteDemoShopCascade", () => {
  it("deletes the whole shop and nothing shared, leaving blue-mantis intact", async () => {
    const db = await seededTestDb();
    const globalsBefore = (await db.select().from(globalDiveSites)).length;

    const { slug } = await createDemoShop(db);
    const shop = await requireShop(db, slug);

    // No FK violation here is the real assertion — the delete order is correct.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect((await db.select().from(people).where(eq(people.shopId, shop.id))).length).toBe(0);
    expect((await db.select().from(bookings).where(eq(bookings.shopId, shop.id))).length).toBe(0);

    // The canonical demo and the shared global dive-site catalog are untouched.
    expect(await findShop(db, DEMO_SHOP_SLUG)).toBeDefined();
    expect((await db.select().from(globalDiveSites)).length).toBe(globalsBefore);
  });
});

describe("reapExpiredDemoShops", () => {
  it("clears minted demos past the TTL but never a fresh one or the canonical demo", async () => {
    const db = await seededTestDb();
    const fresh = await createDemoShop(db, { history: false });
    const stale = await createDemoShop(db);

    // Age the stale demo — and the canonical demo — well past the 7-day window.
    const longAgo = new Date(nowMs() - 10 * DAY_MS);
    const staleShop = await requireShop(db, stale.slug);
    await db.update(shops).set({ createdAt: longAgo }).where(eq(shops.id, staleShop.id));
    await db.update(shops).set({ createdAt: longAgo }).where(eq(shops.slug, DEMO_SHOP_SLUG));

    const result = await reapExpiredDemoShops(db);

    expect(result.slugs).toContain(stale.slug);
    expect(result.slugs).not.toContain(fresh.slug);
    expect(result.slugs).not.toContain(DEMO_SHOP_SLUG);

    expect(await findShop(db, stale.slug)).toBeUndefined();
    expect(await findShop(db, fresh.slug)).toBeDefined();
    // The canonical demo is protected by slug regardless of age.
    expect(await findShop(db, DEMO_SHOP_SLUG)).toBeDefined();
  });
});
