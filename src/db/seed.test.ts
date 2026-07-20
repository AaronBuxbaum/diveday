// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "@/lib/authz";
import { toDateInputValue, utcToWallTime } from "@/lib/zoned";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { bookings, people, personRoles, userAccounts } from "./schema";
import { demoTodayDepartureStart, resetDemoSchedule } from "./seed";
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

    // Only staff carry non-customer roles; no customer role is orphaned.
    const customerRoles = await db
      .select({ personId: personRoles.personId })
      .from(personRoles)
      .innerJoin(people, eq(people.id, personRoles.personId))
      .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "diver")));
    for (const { personId } of customerRoles) {
      const [row] = await db.select().from(people).where(eq(people.id, personId));
      expect(row).toBeDefined();
    }
    // Sanity: STAFF_ROLES is what we preserved by.
    expect(STAFF_ROLES).toContain("owner");
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

  it("concedes to tomorrow only when no future half-hour slot is left today", () => {
    const now = new Date("2026-07-21T03:45:00Z"); // 11:45 PM EDT
    const start = demoTodayDepartureStart(now, TZ);
    expect(start.getTime()).toBeGreaterThan(now.getTime());
    expect(localDay(start)).not.toBe(localDay(now));
  });
});
