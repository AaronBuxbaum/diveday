// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { issueBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { createTestDb } from "./client";
import { verifiedNitroxPersonIds } from "./nitrox";
import { getTripManifest } from "./manifests";
import { getBookingReadiness } from "./readiness";
import {
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  lastMinuteListEntries,
  lastMinuteListUnsubscribeTokens,
  nitroxCertifications,
  orders,
  paymentOperationIntents,
  people,
  personCourtesyEmailUnsubscribeTokens,
  personRoles,
  shopStripeAccounts,
  shops,
  specialtyCertifications,
  tips,
  tripRequirements,
  trips as tripsTable,
  userAccounts,
} from "./schema";
import { demoTodayDepartureStart, resetDemoSchedule, seedIfEmpty } from "./seed";
import { inviteStaffMember } from "./staff-accounts";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "./stripe-accounts";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { joinTripWaitlist } from "./waitlist";
import { getCurrentWaiverTemplate, listWaiverTemplateHistory, saveWaiverTemplate } from "./waivers";

describe("seeded imported-card states", () => {
  // The two states H-23/H-24 exist for are only visible on a diver who holds an
  // imported, unconfirmed card — and until this seed row existed, no seeded diver
  // did, so the amber "certified · confirm to clear" badge and the
  // attest-you've-seen-it confirm had no visual-regression baseline and no
  // fixture. This test
  // is the guard on the *shape* those baselines depend on: if someone drops or
  // confirms these rows, the visual coverage silently stops covering anything.
  it("holds an imported, unconfirmed specialty and nitrox card for one diver", async () => {
    const { db, shop } = await seededShopContext();
    const [hana] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Hana Kobayashi")))
      .limit(1);
    if (!hana) throw new Error("expected the seeded imported-card diver");

    const specialty = await db
      .select()
      .from(specialtyCertifications)
      .where(eq(specialtyCertifications.personId, hana.id));
    expect(specialty).toHaveLength(1);
    // Verified (the prior system checked it) but unreviewed — which is exactly
    // the pair `specialtyBlocker` holds a depth gate on.
    expect(specialty[0]).toMatchObject({
      specialty: "deep",
      status: "verified",
      reviewedAt: null,
      importedFromLabel: "Coral Coast Divers",
    });
    expect(specialty[0].importedAt).toBeInstanceOf(Date);

    const nitrox = await db
      .select()
      .from(nitroxCertifications)
      .where(eq(nitroxCertifications.personId, hana.id));
    expect(nitrox).toHaveLength(1);
    expect(nitrox[0]).toMatchObject({ status: "verified", reviewedAt: null });
    expect(nitrox[0].importedAt).toBeInstanceOf(Date);
    // And the fill really is still held — this is the behaviour, not just the row.
    expect([...(await verifiedNitroxPersonIds(db, shop.id))]).not.toContain(hana.id);
  });

  it("cards that diver without disturbing the readiness any other spec asserts", async () => {
    // Why she is safe to card: her one seeded booking is on a trip that gates on
    // neither a specialty nor nitrox, so the two held gates above are inert there
    // and her blockers are exactly what they were before these rows existed. This
    // is the assumption the whole seed change rests on — asserted rather than
    // assumed, because a future seed that books her onto the deep or nitrox
    // charter would flip a blocker and quietly break unrelated specs.
    const { db, shop } = await seededShopContext();
    const [hana] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Hana Kobayashi")))
      .limit(1);
    if (!hana) throw new Error("expected the seeded imported-card diver");

    const booked = await db.select().from(bookings).where(eq(bookings.personId, hana.id));
    for (const booking of booked) {
      const [requirement] = await db
        .select()
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, booking.tripId));
      expect(requirement?.requiredSpecialties ?? []).toEqual([]);
      expect(requirement?.requiresNitrox ?? false).toBe(false);
      // So the imported cards hold nothing here: the only open blocker is the
      // waiver this diver hasn't signed.
      const readiness = await getBookingReadiness(db, shop.id, booking.id);
      expect(readiness?.blockers.map((b) => b.code)).toEqual(["waiver_pending"]);
    }
  });
});

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

  it("restores the waiver to version 1 with the shop's own title, so an edited release text doesn't leak into the next spec", async () => {
    // Editing the release text appends a version rather than mutating the one
    // divers may already have signed, so the edit survives a reset that only
    // clears signed records — leaving the next spec on "Version 2" and reading
    // the previous test's body (e2e/waivers.spec.ts's own "Version 1" check).
    const { db, shop } = await seededShopContext();
    const before = await getCurrentWaiverTemplate(db, shop.id);
    expect(before?.version).toBe(1);

    const edited = await saveWaiverTemplate(db, {
      shopId: shop.id,
      title: before?.title ?? "",
      body: "Leaked release text from a previous spec.",
    });
    expect(edited.version).toBe(2);

    await resetDemoSchedule(db, shop.id);

    const after = await getCurrentWaiverTemplate(db, shop.id);
    expect(after?.version).toBe(1);
    expect(after?.title).toBe(before?.title);
    expect(after?.body).toBe(before?.body);
    expect(await listWaiverTemplateHistory(db, shop.id)).toHaveLength(1);
  });

  it("purges a staff member invited mid-test, not just non-staff churn (was the flakiest screenshot in the visual suite: settings/team leaking a test-invited instructor whose email embeds Date.now())", async () => {
    const { db, shop } = await seededShopContext();
    const before = await listStaff(db, shop.id);

    const invite = await inviteStaffMember(db, {
      shopId: shop.id,
      fullName: "Priya Nair",
      email: `new-instructor-${Date.now()}@example.com`,
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

describe("demoTodayDepartureStart", () => {
  const TZ = "America/New_York";
  const localDay = (date: Date) => toDateInputValue(utcToWallTime(date, TZ));

  it("sails five hours out, rounded to a half-hour slot, in the middle of the day", () => {
    const now = new Date("2026-07-20T15:04:00Z"); // 11:04 AM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.toISOString()).toBe("2026-07-20T20:30:00.000Z"); // 4:30 PM EDT
    expect(localDay(start)).toBe(localDay(now));
  });

  it("still sails today when now+5h would round past local midnight", () => {
    // Regression: seeding at 6:34 PM EDT put the "sails today" trip at
    // midnight — tomorrow in shop time — emptying the departure board that
    // the Today queue tests and the demo lead with.
    const now = new Date("2026-07-20T22:34:00Z"); // 6:34 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(localDay(start)).toBe(localDay(now));
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(start.toISOString()).toBe("2026-07-21T03:30:00.000Z"); // 11:30 PM EDT
  });

  it("still sails today even when no future half-hour slot is left before midnight", () => {
    // "Today always has a board" has no exception: with less than thirty
    // minutes of the local day left, a half-hour-rounded slot no longer fits,
    // so this falls back to the earliest still-future moment instead of
    // rolling the trip into tomorrow.
    const now = new Date("2026-07-21T03:45:00Z"); // 11:45 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(localDay(start)).toBe(localDay(now));
    expect(start.toISOString()).toBe("2026-07-21T03:46:00.000Z"); // 11:46 PM EDT
  });

  it("never lets the same-day fallback cross into tomorrow", () => {
    // The last minute before local midnight: even "now + 1 minute" would
    // roll into tomorrow, so this clamps to just before midnight instead.
    const now = new Date("2026-07-21T03:59:30Z"); // 11:59:30 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(localDay(start)).toBe(localDay(now));
  });
});

describe("seedIfEmpty (CR-010)", () => {
  it("seeds a fresh database and is a no-op the second time", async () => {
    const db = await createTestDb();
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
    const db = await createTestDb();
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

/**
 * The demo is a teaching surface: whatever it shows, a shop learns is normal.
 * These history trips used to be inserted with no `trip_requirements` row at
 * all, so every one of their bookings read `requirements_not_configured` —
 * blocked — while the seed wrote a `boarded` roll call for them by direct
 * insert. The result was a green "Boarded" pill beside a red "Requirements not
 * configured" on the same manifest line: a pairing `recordRollCall` refuses to
 * create, because readiness gates boarding at departure. The demo was teaching
 * exactly what the boarding gate exists to prevent.
 */
describe("seeded history manifests", () => {
  const HISTORY_DESCRIPTION = "Sailed. Kept in the log for the shop's monthly numbers.";

  it("never shows a boarded diver beside a blocked readiness result", async () => {
    const { db, shop } = await seededShopContext();
    await resetDemoSchedule(db, shop.id, { history: true });

    const history = await db
      .select({ id: tripsTable.id, title: tripsTable.title })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));
    expect(history.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const trip of history) {
      const [requirement] = await db
        .select({ tripId: tripRequirements.tripId })
        .from(tripRequirements)
        .where(eq(tripRequirements.tripId, trip.id));
      expect(requirement, `${trip.title} has no requirements row`).toBeDefined();

      const manifest = await getTripManifest(db, shop.id, trip.id);
      if (!manifest) throw new Error(`no manifest for ${trip.title}`);
      for (const diver of manifest.divers) {
        if (diver.rollCall?.state === "boarded" && diver.readiness.status !== "ready") {
          offenders.push(`${trip.title} · ${diver.fullName}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the unsigned-waiver story on the divers who never got on the boat", async () => {
    // The demo still needs a blocked diver to look at — it just must not be one
    // the crew boarded. A no-show whose release was never signed is true, common,
    // and the right thing to show beside their "Not boarded".
    const { db, shop } = await seededShopContext();
    await resetDemoSchedule(db, shop.id, { history: true });

    const history = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.shopId, shop.id), eq(tripsTable.description, HISTORY_DESCRIPTION)));

    let blockedAshore = 0;
    for (const trip of history) {
      const manifest = await getTripManifest(db, shop.id, trip.id);
      if (!manifest) continue;
      blockedAshore += manifest.divers.filter(
        (diver) => diver.rollCall?.state !== "boarded" && diver.readiness.status === "blocked",
      ).length;
    }
    expect(blockedAshore).toBeGreaterThan(0);
  });
});
