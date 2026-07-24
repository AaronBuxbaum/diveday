// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { issueBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { createTestDb } from "./client";
import {
  bookingCapabilities,
  bookingCheckoutBookings,
  bookingCheckouts,
  bookings,
  paymentOperationIntents,
  people,
  personRoles,
  shops,
  userAccounts,
} from "./schema";
import { demoTodayDepartureStart, resetDemoSchedule, seedIfEmpty } from "./seed";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { joinTripWaitlist } from "./waitlist";

describe("resetDemoSchedule", () => {
  it("restores the seeded schedule after the playground is churned", async () => {
    const { db, shop } = await seededShopContext();
    const before = await upcomingTripsWithCounts(db, shop.id);

    // Simulate a prospective customer poking around: book a walk-up onto an
    // open trip, which creates a brand-new customer person.
    const open = before.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
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

  it("clears issued booking capabilities so a churned playground resets cleanly", async () => {
    const { db, shop } = await seededShopContext();
    const trips = await upcomingTripsWithCounts(db, shop.id);
    const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
    if (!open) throw new Error("expected open trip missing");
    const outcome = await createBooking(db, {
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
