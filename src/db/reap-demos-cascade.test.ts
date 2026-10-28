import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { issueAccountToken } from "./account-tokens";
import {
  accountTokens,
  activityEvents,
  authProviderAccounts,
  authVerifications,
  bookings,
  buddyTeamEvents,
  crewAssignmentRequests,
  divePackageEntitlements,
  divePackages,
  gearItems,
  gearReservations,
  interests,
  interestUnsubscribeTokens,
  orders,
  people,
  personCourtesyEmailUnsubscribeTokens,
  shops,
  tips,
  tripBlowoutDivers,
  tripBlowouts,
  trips,
  userAccounts,
} from "./schema";
import { createDemoShop, deleteDemoShopCascade } from "./seed";

/**
 * Each FK regression of `deleteDemoShopCascade`: the exact dependent row the
 * cascade once tripped on, inserted into a freshly minted lean demo, then the
 * cascade. Split out of reap-demos.test.ts (2026-10-24), and on one database for
 * the file: every case mints and deletes its own shop inside its own rolled-back
 * transaction (`fileScopedShopContext`), so the cases cannot see each other's
 * rows, and the file pays one hydration instead of one per case. Its assertions
 * are all scoped to the shop, its people or its owner's account. The full
 * cascade of a full-history shop stays in reap-demos.test.ts on a database of
 * its own.
 */
const ctx = fileScopedShopContext();

type Db = typeof ctx.db;

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

describe("deleteDemoShopCascade", () => {
  it("still removes a demo after the retired saved answers table has been dropped", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    await db.execute(sql`drop table inbox_saved_answers`);

    await deleteDemoShopCascade(db, shop.id);
    expect(await findShop(db, slug)).toBeUndefined();
  });

  it("deletes invoiced counter rentals before their orders", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    const [unit] = await db
      .insert(gearItems)
      .values({ shopId: shop.id, kind: "mask", label: "Rental" })
      .returning();
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: person.id,
        createdByPersonId: person.id,
        collection: "cash",
        currency: "usd",
        totalCents: 1000,
      })
      .returning();
    await db.insert(gearReservations).values({
      shopId: shop.id,
      gearItemId: unit.id,
      personId: person.id,
      orderId: order.id,
      reservedFrom: "2026-01-01",
      reservedUntil: "2026-01-02",
    });

    await deleteDemoShopCascade(db, shop.id);
    expect(await findShop(db, slug)).toBeUndefined();
  });

  it("deletes crew requests before their departures", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    const [trip] = await db.select().from(trips).where(eq(trips.shopId, shop.id)).limit(1);
    if (!person || !trip) throw new Error("test setup: demo shop needs a person and departure");
    await db
      .insert(crewAssignmentRequests)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id });

    await deleteDemoShopCascade(db, shop.id);
    expect(await findShop(db, slug)).toBeUndefined();
  });

  /**
   * A shop that sold a package was the one reset could not clear: the cascade
   * deleted orders before the entitlements that name them, so every
   * /api/test/reset after package-purchase.spec 500'd on the minted shop.
   */
  it("deletes sold package dives instead of FK-violating on the order they came from", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    const [pkg] = await db
      .insert(divePackages)
      .values({ shopId: shop.id, name: "Ten-dive card", diveCount: 10, priceCents: 45_000 })
      .returning();
    const [order] = await db
      .insert(orders)
      .values({
        shopId: shop.id,
        personId: person.id,
        createdByPersonId: person.id,
        collection: "cash",
        currency: "usd",
        totalCents: 45_000,
      })
      .returning();
    if (!pkg || !order) throw new Error("test setup: package or order insert failed");
    await db
      .insert(divePackageEntitlements)
      .values({ shopId: shop.id, packageId: pkg.id, personId: person.id, orderId: order.id });

    // No FK violation here is the real assertion — entitlements go before orders.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (
        await db
          .select()
          .from(divePackageEntitlements)
          .where(eq(divePackageEntitlements.shopId, shop.id))
      ).length,
    ).toBe(0);
  });

  it("deletes a booking's tip instead of FK-violating on the booking it references", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
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
   * this exact FK: `last_minute_list_unsubscribe_tokens` (now `interest_unsubscribe_tokens`) shipped with Leo's
   * self-serve unsubscribe but was never added to either delete ordering. A
   * half-completed reset left the demo shop wrecked, and the browser suite then
   * failed in whichever spec read it next — which is why the flake appeared to
   * wander between `manifest`, `courses`, and `gear-fit-and-age`.
   */
  it("deletes a last-minute unsubscribe token instead of FK-violating on its interest", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    const [interest] = await db
      .insert(interests)
      .values({ shopId: shop.id, scope: "anytime", askedBy: "diver", personId: person.id })
      .returning();
    if (!interest) throw new Error("test setup: last-minute interest insert returned no row");
    await db
      .insert(interestUnsubscribeTokens)
      .values({ shopId: shop.id, interestId: interest.id, tokenHash: `hash_${interest.id}` });

    // No FK violation here is the real assertion — tokens must go before interests.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (
        await db
          .select()
          .from(interestUnsubscribeTokens)
          .where(eq(interestUnsubscribeTokens.shopId, shop.id))
      ).length,
    ).toBe(0);
  });

  /**
   * The same class of bug again, found by a consolidation pass over the
   * 2026-08-04 merge train: the blow-out cascade shipped `trip_blowouts` (which
   * references `trips`) and `trip_blowout_divers` (which references `bookings`
   * and the cascade row) without adding either to **either** delete ordering.
   * Any run that had called a blow-out then made `/api/test/reset` throw 23503
   * on `trip_blowouts_trip_id_trips_id_fkey`, aborting the reset half-done — and
   * the browser fleet failed in whichever spec next read the wreckage, which is
   * why 25 specs went red at once with nothing in common.
   */
  it("deletes a blow-out cascade instead of FK-violating on its trip", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    const [trip] = await db.select().from(trips).where(eq(trips.shopId, shop.id)).limit(1);
    if (!trip) throw new Error("test setup: demo shop has no trips");
    const [booking] = await db.select().from(bookings).where(eq(bookings.tripId, trip.id)).limit(1);
    if (!booking) throw new Error("test setup: demo trip has no bookings");

    const [blowout] = await db
      .insert(tripBlowouts)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        calledByPersonId: person.id,
        calledAt: new Date("2026-08-04T11:00:00.000Z"),
      })
      .returning();
    if (!blowout) throw new Error("test setup: blow-out insert returned no row");
    await db.insert(tripBlowoutDivers).values({
      shopId: shop.id,
      blowoutId: blowout.id,
      bookingId: booking.id,
      personId: booking.personId,
    });

    // No FK violation here is the real assertion — the cascade's rows must go
    // before the bookings and trips they point at.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (await db.select().from(tripBlowouts).where(eq(tripBlowouts.shopId, shop.id))).length,
    ).toBe(0);
    expect(
      (await db.select().from(tripBlowoutDivers).where(eq(tripBlowoutDivers.shopId, shop.id)))
        .length,
    ).toBe(0);
  });

  /**
   * The buddy-team trail (ADR 20260804-buddy-teams) references trips and people
   * and is deliberately *not* deleted when a team dissolves — its whole job is
   * to outlive the membership rows. That makes it exactly the kind of table
   * that goes missing from this ordering, so it gets its case here in the same
   * change that adds it, as this file's own docs require.
   */
  it("deletes the buddy-team trail instead of FK-violating on its trip", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    const [trip] = await db.select().from(trips).where(eq(trips.shopId, shop.id)).limit(1);
    if (!trip) throw new Error("test setup: demo shop has no trips");

    await db.insert(buddyTeamEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      pairId: crypto.randomUUID(),
      action: "formed",
      memberNames: ["Ana Diaz", "Ben Cho"],
      recordedByPersonId: person.id,
      occurredAt: new Date("2026-08-04T07:05:00.000Z"),
    });

    // No FK violation here is the real assertion.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (await db.select().from(buddyTeamEvents).where(eq(buddyTeamEvents.shopId, shop.id))).length,
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
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
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

  /**
   * The sharpest of nine omissions the shop-scoped sweep in
   * `delete-path-coverage.test.ts` found on its first run: `activity_events`
   * references `shops` and `people` with no cascade and was in **neither**
   * delete ordering — and `seat-diver.ts` writes one every time staff seat a
   * diver, so *any* minted demo where somebody used the Guests tab could never
   * be reaped. It failed silently and permanently: every later reap hit the
   * same row, so the shop stayed live past its TTL forever.
   *
   * It gets a case here, as this file's own docs require, because a sweep
   * proves the table is *named* and only a real FK can prove it is named in the
   * right place.
   */
  it("deletes the activity trail instead of FK-violating on its shop", async () => {
    const { db } = ctx;
    const { slug } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: demo shop has no people");
    await db.insert(activityEvents).values({
      shopId: shop.id,
      actorPersonId: person.id,
      code: "seat_added_walk_in",
      params: { actor: person.fullName, diver: person.fullName },
    });

    // No FK violation here is the real assertion.
    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (await db.select().from(activityEvents).where(eq(activityEvents.shopId, shop.id))).length,
    ).toBe(0);
  });

  it("deletes an owner's outstanding account token instead of FK-violating (security review finding)", async () => {
    const { db } = ctx;
    const { slug, ownerEmail } = await createDemoShop(db, { history: false });
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

  /**
   * The same finding one table over, written before it can bite. A provider
   * login references `user_accounts` and carries no `ON DELETE CASCADE`, so a
   * demo owner who had ever signed in with a provider would strand their shop
   * past the reaper's TTL on a 23503 (issue #1594). Nothing writes the table
   * today — no provider is configured — so the row here is inserted by hand,
   * which is the only way to exercise the ordering before the feature that
   * fills it exists.
   */
  it("deletes an owner's provider login instead of FK-violating (issue #1594)", async () => {
    const { db } = ctx;
    const { slug, ownerEmail } = await createDemoShop(db, { history: false });
    const shop = await requireShop(db, slug);
    const [ownerAccount] = await db
      .select()
      .from(userAccounts)
      .where(eq(userAccounts.email, ownerEmail))
      .limit(1);
    if (!ownerAccount) throw new Error("test setup: demo owner account missing");
    await db.insert(authProviderAccounts).values({
      userAccountId: ownerAccount.id,
      providerId: "google",
      accountId: "google-subject-demo",
      refreshToken: "live-refresh-token",
    });
    // No foreign key reaches this one — it names its person as text — so the
    // reap sweeps it by `identifier` or not at all, and a row left behind
    // holds the demo owner's address and a live token.
    await db.insert(authVerifications).values({
      identifier: ownerEmail,
      value: "a-live-reset-token",
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    await deleteDemoShopCascade(db, shop.id);

    expect(await findShop(db, slug)).toBeUndefined();
    expect(
      (
        await db
          .select()
          .from(authProviderAccounts)
          .where(eq(authProviderAccounts.userAccountId, ownerAccount.id))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(authVerifications)
          .where(eq(authVerifications.identifier, ownerEmail))
      ).length,
    ).toBe(0);
  });
});
