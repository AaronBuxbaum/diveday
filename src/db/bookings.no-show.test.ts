// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

async function seededContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  return { db, shop, open };
}

const visitor = { fullName: "Nora Quinn", email: "nora@example.com", phone: "+1-305-555-0199" };

async function bookVisitor(db: AppDb, shopId: string, tripId: string) {
  return createBooking(db, { actor: "staff", shopId, tripId, ...visitor });
}

describe("a no-show row on a departure still ahead", () => {
  async function noShowOn(startsInFuture: boolean) {
    const { db, shop, open } = await seededContext();
    const first = await bookVisitor(db, shop.id, open.id);
    if (!first.ok) throw new Error("setup booking failed");
    const { activityEvents, bookings, trips } = await import("./schema");
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, first.bookingId));
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: open.id,
      bookingId: first.bookingId,
      actorPersonId: first.personId,
      code: "booking_no_show",
      params: { actor: "Staff", diver: "Visitor" },
      occurredAt: nowDate(),
    });
    if (!startsInFuture) {
      await db
        .update(trips)
        .set({ startsAt: new Date(nowMs() - 3 * 60 * 60 * 1000), revision: 99 })
        .where(eq(trips.id, open.id));
    }
    return { db, shop, open, first, bookings, activityEvents };
  }

  it("is booked again on the same row, and the no-show stays in the trail", async () => {
    const { db, shop, open, first, bookings, activityEvents } = await noShowOn(true);
    const rebook = await bookVisitor(db, shop.id, open.id);
    expect(rebook).toMatchObject({ ok: true, bookingId: first.bookingId });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, first.bookingId));
    expect(row?.status).toBe("booked");
    const trail = await db
      .select({ code: activityEvents.code })
      .from(activityEvents)
      .where(eq(activityEvents.bookingId, first.bookingId));
    expect(trail.map((event) => event.code)).toContain("booking_no_show");
  });

  it("still refuses once the departure has started", async () => {
    const { db, shop, open, first, bookings } = await noShowOn(false);
    const rebook = await bookVisitor(db, shop.id, open.id);
    expect(rebook.ok).toBe(false);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, first.bookingId));
    expect(row?.status).toBe("no_show");
  });
});
