import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededTestDb } from "@/test/db";
import { issueAccountToken } from "./account-tokens";
import { DEMO_SHOP_SLUG } from "./dev-credentials";
import {
  accountTokens,
  bookings,
  globalDiveSites,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  shops,
  tips,
  userAccounts,
} from "./schema";
import { createDemoShop, deleteDemoShopCascade, reapExpiredDemoShops } from "./seed";

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
    const a = await createDemoShop(db);
    const b = await createDemoShop(db);

    expect(a.slug).not.toBe(b.slug);
    expect(a.ownerEmail).not.toBe(b.ownerEmail);
    expect(await findShop(db, a.slug)).toBeDefined();
    expect(await findShop(db, b.slug)).toBeDefined();
    // The canonical demo still stands alongside both.
    expect(await findShop(db, DEMO_SHOP_SLUG)).toBeDefined();
  });

  it("evicts the oldest minted demo once the live cap is reached", async () => {
    const db = await seededTestDb();
    const prev = process.env.DEMO_SHOP_MAX_LIVE;
    process.env.DEMO_SHOP_MAX_LIVE = "2";
    try {
      const a = await createDemoShop(db);
      const b = await createDemoShop(db);
      const c = await createDemoShop(db);

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

  it("deletes a booking's tip instead of FK-violating on the booking it references", async () => {
    const db = await seededTestDb();
    const { slug } = await createDemoShop(db);
    const shop = await requireShop(db, slug);
    const [booking] = await db.select().from(bookings).where(eq(bookings.shopId, shop.id)).limit(1);
    if (!booking) throw new Error("test setup: demo shop has no bookings");
    await db.insert(tips).values({
      shopId: shop.id,
      currency: "usd",
      bookingId: booking.id,
      stripeAccountId: "acct_demo",
      stripeSessionId: `cs_demo_${booking.id}`,
      amountCents: 1000,
    });

    // No FK violation here is the real assertion — tips must go before bookings.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect((await db.select().from(tips).where(eq(tips.shopId, shop.id))).length).toBe(0);
  });

  /**
   * The reset endpoint the whole e2e fleet depends on was throwing 23503 on
   * this exact FK: `last_minute_list_unsubscribe_tokens` shipped with Leo's
   * self-serve unsubscribe but was never added to either delete ordering. A
   * half-completed reset left the demo shop wrecked, and the browser suite then
   * failed in whichever spec read it next — which is why the flake appeared to
   * wander between `manifest`, `courses`, and `gear-fit-and-age`.
   */
  it("deletes a last-minute unsubscribe token instead of FK-violating on its entry", async () => {
    const db = await seededTestDb();
    const { slug } = await createDemoShop(db);
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    const [entry] = await db
      .insert(lastMinuteListEntries)
      .values({ shopId: shop.id, personId: person.id })
      .returning();
    if (!entry) throw new Error("test setup: last-minute entry insert returned no row");
    await db
      .insert(lastMinuteListUnsubscribeTokens)
      .values({ shopId: shop.id, entryId: entry.id, tokenHash: `hash_${entry.id}` });

    // No FK violation here is the real assertion — tokens must go before entries.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (
        await db
          .select()
          .from(lastMinuteListUnsubscribeTokens)
          .where(eq(lastMinuteListUnsubscribeTokens.shopId, shop.id))
      ).length,
    ).toBe(0);
  });

  /**
   * The exact same class of bug the last-minute unsubscribe token test above
   * regression-tests, this time for the courtesy-email unsubscribe token that
   * shipped with Leo's general self-serve unsubscribe (story-backlog task
   * 122): `person_courtesy_email_unsubscribe_tokens` references `people`
   * directly (not through an entry), so it must be deleted before people or
   * the whole reset FK-violates and aborts mid-run.
   */
  it("deletes a courtesy-email unsubscribe token instead of FK-violating on its person", async () => {
    const db = await seededTestDb();
    const { slug } = await createDemoShop(db);
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    await db.insert(personCourtesyEmailUnsubscribeTokens).values({
      shopId: shop.id,
      personId: person.id,
      tokenHash: `hash_${person.id}`,
    });

    // No FK violation here is the real assertion — tokens must go before people.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (
        await db
          .select()
          .from(personCourtesyEmailUnsubscribeTokens)
          .where(eq(personCourtesyEmailUnsubscribeTokens.shopId, shop.id))
      ).length,
    ).toBe(0);
  });

  it("deletes an owner's outstanding account token instead of FK-violating (security review finding)", async () => {
    const db = await seededTestDb();
    const { slug, ownerEmail } = await createDemoShop(db);
    const shop = await requireShop(db, slug);
    const [ownerAccount] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, ownerEmail))
      .limit(1);
    if (!ownerAccount) throw new Error("test setup: demo owner account missing");
    await issueAccountToken(db, { userAccountId: ownerAccount.id, purpose: "password_reset" });

    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (
        await db
          .select()
          .from(accountTokens)
          .where(eq(accountTokens.userAccountId, ownerAccount.id))
      ).length,
    ).toBe(0);
  });
});

describe("reapExpiredDemoShops", () => {
  it("clears minted demos past the TTL but never a fresh one or the canonical demo", async () => {
    const db = await seededTestDb();
    const fresh = await createDemoShop(db);
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
