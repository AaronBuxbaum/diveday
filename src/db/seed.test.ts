import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext, unseededTestDb } from "@/test/db";
import { fakePromotions } from "@/test/fakes";
import { issueBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import {
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  orders,
  paymentOperationIntents,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  shopStripeAccounts,
  shops,
  tips,
  userAccounts,
} from "./schema";
import { resetDemoSchedule, seedIfEmpty } from "./seed";
import { createShopPromoCode, getShopPromoByCode, setShopPromoEnabled } from "./shop-promos";
import { inviteStaffMember } from "./staff-accounts";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { joinTripWaitlist } from "./waitlist";
import { getCurrentWaiverTemplate, listWaiverTemplateHistory, saveWaiverTemplate } from "./waivers";

describe("resetDemoSchedule", () => {
  it("can restore the full history used by the browser demo", async () => {
    const { db, shop } = await seededShopContext();

    await resetDemoSchedule(db, shop.id, { history: true });

    expect(
      (await db.select().from(orders).where(eq(orders.shopId, shop.id))).length,
    ).toBeGreaterThan(0);
    expect((await db.select().from(tips).where(eq(tips.shopId, shop.id))).length).toBeGreaterThan(
      0,
    );
  });

  it("restores the seeded schedule after the playground is churned", async () => {
    const { db, shop } = await seededShopContext();
    const before = await upcomingTripsWithCounts(db, shop.id);

    // Simulate a prospective customer poking around: book a walk-up onto an
    // open trip, which creates a brand-new customer person.
    const open = before.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Walk-Up Wanda",
      email: "wanda@example.com",
    });
    expect(outcome.ok).toBe(true);

    await resetDemoSchedule(db, shop.id);

    const after = await upcomingTripsWithCounts(db, shop.id);
    expect(after.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity }))).toEqual(
      before.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity })),
    );

    // The walk-up and their booking are gone.
    const walkUp = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "wanda@example.com")));
    expect(walkUp).toHaveLength(0);
  });

  it("clears wait-list entries so a churned playground resets cleanly", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);

    // A wait-list entry references its trip; before the reset cleared it, that
    // dangling row blocked the trips delete with an FK violation and left the
    // fixture dirty for every subsequent e2e test (the real "tests take
    // forever" cause: each poisoned reset then timed out downstream).
    const full = trips.find((t) => t.booked >= t.capacity);
    if (!full) throw new Error("expected a full trip in the seed to wait-list against");
    const outcome = await joinTripWaitlist(db, {
      shopId: shop.id,
      tripId: full.id,
      fullName: "Wait-List Wendy",
      email: "wendy@example.com",
    });
    expect(outcome.ok).toBe(true);

    // Must not throw on the trips/people deletes, and must fully restore.
    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();

    const after = await upcomingTripsWithCounts(db, shop.id);
    expect(after.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity }))).toEqual(
      trips.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity })),
    );
    const wendy = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "wendy@example.com")));
    expect(wendy).toHaveLength(0);
  });

  /**
   * The regression that made the e2e fleet flaky. `/api/test/reset` calls this
   * before every browser test; once Leo's self-serve unsubscribe added
   * `last_minute_list_unsubscribe_tokens` referencing the entries, the delete
   * ordering FK-violated (23503) and aborted the reset **mid-run**, leaving the
   * demo shop half-wiped. Whichever spec read it next failed on missing seeded
   * data — which is why the failure appeared to wander between `manifest`,
   * `courses`, and `gear-fit-and-age` rather than pointing at its own cause.
   */
  it("clears last-minute unsubscribe tokens instead of FK-violating on their entries", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: seeded shop has no people");
    const [entry] = await db
      .insert(lastMinuteListEntries)
      .values({ shopId: shop.id, personId: person.id })
      .returning();
    if (!entry) throw new Error("test setup: last-minute entry insert returned no row");
    await db
      .insert(lastMinuteListUnsubscribeTokens)
      .values({ shopId: shop.id, entryId: entry.id, tokenHash: `hash_${entry.id}` });

    // Resolving rather than throwing is the whole assertion.
    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();

    expect(
      await db
        .select()
        .from(lastMinuteListUnsubscribeTokens)
        .where(eq(lastMinuteListUnsubscribeTokens.shopId, shop.id)),
    ).toHaveLength(0);
  });

  /**
   * The exact same class of regression as the last-minute unsubscribe token
   * test above, this time for the courtesy-email unsubscribe token that
   * shipped with Leo's general self-serve unsubscribe (story-backlog task
   * 122): `person_courtesy_email_unsubscribe_tokens` references `people`
   * directly, so it must be cleared before the people delete or this
   * FK-violates and aborts the reset mid-run.
   */
  it("clears courtesy-email unsubscribe tokens instead of FK-violating on their person", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db.select().from(people).where(eq(people.shopId, shop.id)).limit(1);
    if (!person) throw new Error("test setup: seeded shop has no people");
    await db.insert(personCourtesyEmailUnsubscribeTokens).values({
      shopId: shop.id,
      personId: person.id,
      tokenHash: `hash_${person.id}`,
    });

    // Resolving rather than throwing is the whole assertion.
    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();

    expect(
      await db
        .select()
        .from(personCourtesyEmailUnsubscribeTokens)
        .where(eq(personCourtesyEmailUnsubscribeTokens.shopId, shop.id)),
    ).toHaveLength(0);
  });

  it("restores shop-level fixtures a test can mutate directly, not just schedule/booking data (Codex finding)", async () => {
    // e2e/visual.spec.ts sets a review link via the Settings UI and connects
    // a Stripe account via /api/test/seed-stripe-account, purely to render
    // those surfaces for a screenshot — neither is schedule/booking data, so
    // without this both leaked across specs in the same worker, making
    // assertions like "the review link starts absent" order-dependent.
    const { db, shop } = await seededShopContext();
    await db
      .update(shops)
      .set({ reviewUrl: "https://g.page/r/leaked/review" })
      .where(eq(shops.id, shop.id));
    const account = await upsertShopStripeAccount(db, shop.id, "acct_leaked_test");
    await setShopStripeAccountStatus(db, account.stripeAccountId, {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });

    await resetDemoSchedule(db, shop.id);

    const [resetShop] = await db.select().from(shops).where(eq(shops.id, shop.id));
    expect(resetShop?.reviewUrl).toBeNull();
    const [stripeRow] = await db
      .select()
      .from(shopStripeAccounts)
      .where(eq(shopStripeAccounts.shopId, shop.id));
    expect(stripeRow).toBeUndefined();
  });

  it("restores the waiver to its seeded version history with the shop's own title, so an edited release text doesn't leak into the next spec", async () => {
    // Editing the release text appends a version rather than mutating the one
    // divers may already have signed, so the edit survives a reset that only
    // clears signed records — leaving the next spec a version ahead and reading
    // the previous test's body (e2e/waivers.spec.ts's own version check).
    //
    // "Seeded state" is a *history*, not one row: the demo shop ships with two
    // superseded wordings behind its live release
    // (src/db/seed-waiver-versions.ts), and a reset that restored a bare
    // version 1 would silently empty the template history the demo exists to
    // show.
    const { db, shop } = await seededShopContext();
    const before = await getCurrentWaiverTemplate(db, shop.id);
    const seededHistory = await listWaiverTemplateHistory(db, shop.id);
    expect(before?.version).toBe(seededHistory.length);
    expect(seededHistory.length).toBeGreaterThan(1);

    const edited = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: before?.title ?? "",
      body: "Leaked release text from a previous spec.",
    });
    expect(edited.version).toBe(seededHistory.length + 1);

    await resetDemoSchedule(db, shop.id);

    const after = await getCurrentWaiverTemplate(db, shop.id);
    expect(after?.version).toBe(seededHistory.length);
    expect(after?.title).toBe(before?.title);
    expect(after?.body).toBe(before?.body);
    expect(await listWaiverTemplateHistory(db, shop.id)).toHaveLength(seededHistory.length);
  });

  it("returns the seeded promo code to its live state, so a spec that switched it off doesn't leak that (#330)", async () => {
    // Codes were exempted from this reset for a long time as "shop config".
    // But `setShopPromoEnabled` is a one-click staff action, so a spec that
    // switches REEF10 off leaves the next spec in the same worker with a
    // diver-facing promo box that refuses the very code the seed promises —
    // and a code some test minted outlives the test that minted it.
    const { db, shop } = await seededShopContext();
    const seeded = await getShopPromoByCode(db, shop.id, "REEF10");
    if (!seeded) throw new Error("seeded REEF10 promo code missing");
    expect(seeded.status).toBe("active");

    expect(await setShopPromoEnabled(db, shop.id, seeded.id, false)).toBe(true);
    expect((await getShopPromoByCode(db, shop.id, "REEF10"))?.status).toBe("disabled");

    // Minting a code needs a connected account (the real staff path mints the
    // Stripe objects behind it), so connect one — which this reset clears too.
    const account = await upsertShopStripeAccount(db, shop.id, "acct_promo_reset_test");
    await setShopStripeAccountStatus(db, account.stripeAccountId, {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const minted = await createShopPromoCode(
      db,
      {
        shopId: shop.id,
        code: "LEAKED20",
        description: "Minted by a previous spec",
        discountPercent: 20,
        scope: "all",
      },
      fakePromotions(),
    );
    expect(minted.ok).toBe(true);

    await resetDemoSchedule(db, shop.id);

    const after = await getShopPromoByCode(db, shop.id, "REEF10");
    expect(after?.status).toBe("active");
    expect(after?.discountPercent).toBe(seeded.discountPercent);
    expect(after?.scope).toBe(seeded.scope);
    expect(after?.description).toBe(seeded.description);
    // The other seeded code comes back too, and the test-minted one does not.
    expect(await getShopPromoByCode(db, shop.id, "OPENWATER25")).not.toBeNull();
    expect(await getShopPromoByCode(db, shop.id, "LEAKED20")).toBeNull();
  });

  it("purges a staff member invited mid-test, not just non-staff churn (was the flakiest screenshot in the visual suite: settings/team leaking a test-invited instructor)", async () => {
    const { db, shop } = await seededShopContext();
    const before = await listStaff(db, shop.id);

    const invite = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Priya Nair",
      // A unique suffix, not a time read — the clock is frozen, so two of
      // these in one worker would collide on the email uniqueness constraint.
      email: `new-instructor-${crypto.randomUUID()}@example.com`,
      roles: ["instructor"],
    });
    expect(invite.ok).toBe(true);

    await resetDemoSchedule(db, shop.id);

    const after = await listStaff(db, shop.id);
    expect(after.map((s) => s.person.fullName).sort()).toEqual(
      before.map((s) => s.person.fullName).sort(),
    );
    const leaked = await db
      .select()
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Priya Nair")));
    expect(leaked).toHaveLength(0);
  });

  it("deletes a booking's tip instead of FK-violating on the booking it references (Codex finding — resetDemoSchedule has its own child-first list, separate from deleteDemoShopCascade's)", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Tip Tessa",
      email: "tessa@example.com",
    });
    if (!outcome.ok) throw new Error("setup booking failed");
    await db.insert(tips).values({
      shopId: shop.id,
      currency: "usd",
      bookingId: outcome.bookingId,
      stripeAccountId: "acct_demo",
      stripeSessionId: `cs_demo_${outcome.bookingId}`,
      amountCents: 1000,
    });

    // No FK violation here is the real assertion — tips must go before bookings.
    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();
    expect((await db.select().from(tips).where(eq(tips.shopId, shop.id))).length).toBe(0);
  });

  it("clears issued booking capabilities so a churned playground resets cleanly", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Capability Cameron",
      email: "cameron@example.com",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected booking to succeed");
    // A readiness/confirm capability row references the booking; before the
    // reset cleared it, that row blocked the bookings delete with an FK
    // violation (23503) and left every subsequent test's fixture dirty.
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: outcome.bookingId,
      purpose: "readiness",
    });
    expect(issued).not.toBeNull();

    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();

    const after = await upcomingTripsWithCounts(db, shop.id);
    expect(after.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity }))).toEqual(
      trips.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity })),
    );
    const remainingCapabilities = await db
      .select()
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.shopId, shop.id));
    expect(remainingCapabilities).toHaveLength(0);
  });

  it("clears checkout and payment-intent rows so a churned playground resets cleanly", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Checkout Chris",
      email: "chris@example.com",
    });
    if (!outcome.ok) throw new Error("expected booking to succeed");

    // A Stripe checkout and its payment-operation intent reference the booking,
    // trip, and order. Before the reset cleared them, those rows blocked the
    // bookings/trips deletes with an FK violation (23503) and left every
    // subsequent e2e test's fixture dirty — the pre-existing gap that made
    // trips.spec flake once a payment test (refunds/checkout) ran ahead of it in
    // the same worker.
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        currency: "usd",
        tripId: open.id,
        stripeAccountId: "acct_test",
        stripeSessionId: `cs_test_${outcome.bookingId}`,
        amountPerDiverCents: 12000,
        totalCents: 12000,
      })
      .returning();
    if (!checkout) throw new Error("checkout insert failed");
    await db
      .insert(bookingCheckoutBookings)
      .values({ shopId: shop.id, checkoutId: checkout.id, bookingId: outcome.bookingId });
    await db.insert(paymentOperationIntents).values({
      shopId: shop.id,
      kind: "checkout_session",
      tripId: open.id,
      bookingId: outcome.bookingId,
    });

    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();

    const after = await upcomingTripsWithCounts(db, shop.id);
    expect(after.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity }))).toEqual(
      trips.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity })),
    );
    expect(
      await db.select().from(bookingCheckouts).where(eq(bookingCheckouts.shopId, shop.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(paymentOperationIntents)
        .where(eq(paymentOperationIntents.shopId, shop.id)),
    ).toHaveLength(0);
  });

  it("clears non-staff logins so a churned playground resets cleanly", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: open.id,
      fullName: "Login Logan",
      email: "logan@example.com",
    });
    if (!outcome.ok) throw new Error("expected booking to succeed");

    // A non-staff diver can carry a login (user_accounts.person_id) — contact
    // import (src/db/import.ts) and diver signup both mint one. Before the reset
    // cleared it, that login blocked the delete of its owner with an FK
    // violation (23503) and aborted the whole reset, leaking the churned
    // schedule into every later e2e spec's fixture.
    const [logan] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.email, "logan@example.com")));
    if (!logan) throw new Error("expected booked diver row");
    await db.insert(userAccounts).values({
      personId: logan.id,
      email: "logan@example.com",
      hashedPassword: "x",
      status: "active",
    });

    await expect(resetDemoSchedule(db, shop.id)).resolves.toBeUndefined();

    const after = await upcomingTripsWithCounts(db, shop.id);
    expect(after.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity }))).toEqual(
      trips.map((t) => ({ title: t.title, booked: t.booked, capacity: t.capacity })),
    );
    // The diver and their orphaned login are both gone.
    expect(
      await db.select().from(people).where(eq(people.email, "logan@example.com")),
    ).toHaveLength(0);
    expect(
      await db.select().from(userAccounts).where(eq(userAccounts.email, "logan@example.com")),
    ).toHaveLength(0);
  });

  it("keeps staff and their logins intact so the demo session survives", async () => {
    const { db, shop } = await seededShopContext();
    const staffBefore = await listStaff(db, shop.id);
    const accountsBefore = await db.select().from(userAccounts);

    await resetDemoSchedule(db, shop.id);

    const staffAfter = await listStaff(db, shop.id);
    const accountsAfter = await db.select().from(userAccounts);
    expect(staffAfter.map((s) => s.person.id).sort()).toEqual(
      staffBefore.map((s) => s.person.id).sort(),
    );
    expect(accountsAfter.map((a) => a.id).sort()).toEqual(accountsBefore.map((a) => a.id).sort());
  });

  it("leaves no orphaned bookings, customers, or roles after reset", async () => {
    const { db, shop } = await seededShopContext();
    await resetDemoSchedule(db, shop.id);

    // Every remaining booking points at a live trip and person (no dangling rows).
    const roster = await db
      .select({ bookingId: bookings.id })
      .from(bookings)
      .innerJoin(people, eq(people.id, bookings.personId))
      .where(eq(bookings.shopId, shop.id));
    const allBookings = await db.select().from(bookings).where(eq(bookings.shopId, shop.id));
    expect(roster).toHaveLength(allBookings.length);

    // No role row survives without its person.
    const roles = await db.select({ personId: personRoles.personId }).from(personRoles);
    const orphanedRoles = await db
      .select({ personId: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId));
    expect(orphanedRoles).toHaveLength(roles.length);
  });
});

describe("seedIfEmpty (CR-010)", () => {
  it("seeds a fresh database and is a no-op the second time", async () => {
    const db = await unseededTestDb();
    await expect(db.select({ id: shops.id }).from(shops)).resolves.toHaveLength(0);

    await seedIfEmpty(db);
    const seeded = await db.select({ id: shops.id }).from(shops);
    expect(seeded.length).toBeGreaterThan(0);

    // A shop already exists, so a second call must not mint a duplicate demo
    // shop (or throw on the unique slug it would collide with).
    await seedIfEmpty(db);
    await expect(db.select({ id: shops.id }).from(shops)).resolves.toHaveLength(seeded.length);
  });

  it("rolls back the whole seed atomically when the enclosing transaction fails", async () => {
    // src/db/client.ts's init() wraps seedIfEmpty in exactly this shape — a
    // transaction that seedIfEmpty runs inside of, so a failure after it
    // completes (a crash writing the return value, a network blip) undoes
    // every row instead of leaving a half-seeded shop a retry would find
    // already non-empty and stop repairing (CR-010).
    const db = await unseededTestDb();
    await expect(
      db.transaction(async (tx) => {
        await seedIfEmpty(tx);
        // seeding itself succeeded; simulate a failure elsewhere in the
        // same attempt before the transaction gets to commit.
        throw new Error("simulated failure after seeding");
      }),
    ).rejects.toThrow("simulated failure after seeding");

    // Nothing survived the rollback — a retry sees a genuinely empty
    // database, not a shop with no staff/trips/courses.
    await expect(db.select({ id: shops.id }).from(shops)).resolves.toHaveLength(0);

    // The retry itself then succeeds cleanly.
    await seedIfEmpty(db);
    await expect(db.select({ id: shops.id }).from(shops)).resolves.not.toHaveLength(0);
  });
});
