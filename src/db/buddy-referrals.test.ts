// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buddyReferralId } from "@/lib/buddy-tokens";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  buddyReferredSeatsForWindow,
  recordBuddyReferral,
  resolveBuddyReferral,
} from "./buddy-referrals";
import type { AppDb } from "./client";
import { bookingReferrals } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The buddy seat, at the database** (ADR 20260908-one-hand, decision 6,
 * lever W).
 *
 * Two rules, and both are about what happens when the id is *wrong*: junk is
 * ignored so a mangled paste still books a seat, and another shop's booking is
 * ignored so a diver carrying one shop's link cannot hand a second shop a
 * number about the first.
 */
async function context() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded trip missing");
  return { db, shop, open };
}

async function book(db: AppDb, shopId: string, tripId: string, who: string) {
  const outcome = await createBooking(db, {
    actor: "public",
    shopId,
    tripId,
    fullName: who,
    email: `${who.toLowerCase().replaceAll(" ", ".")}@example.com`,
  });
  if (!outcome.ok) throw new Error(`booking failed: ${outcome.reason}`);
  return outcome;
}

describe("resolveBuddyReferral", () => {
  it("resolves a signed id to the booking whose recap carried it", async () => {
    const { db, shop, open } = await context();
    const ravi = await book(db, shop.id, open.id, "Ravi Nair");
    const amira = await book(db, shop.id, open.id, "Amira Khan");

    expect(
      await resolveBuddyReferral(db, {
        shopId: shop.id,
        referralId: buddyReferralId(ravi.bookingId),
        bookingId: amira.bookingId,
      }),
    ).toBe(ravi.bookingId);
  });

  it("ignores junk rather than refusing the seat", async () => {
    const { db, shop, open } = await context();
    const amira = await book(db, shop.id, open.id, "Amira Khan");
    for (const referralId of [null, "", "hello", "../etc/passwd", "a".repeat(400)]) {
      expect(
        await resolveBuddyReferral(db, {
          shopId: shop.id,
          referralId,
          bookingId: amira.bookingId,
        }),
      ).toBeNull();
    }
  });

  it("ignores a bare booking id, however real", async () => {
    const { db, shop, open } = await context();
    const ravi = await book(db, shop.id, open.id, "Ravi Nair");
    const amira = await book(db, shop.id, open.id, "Amira Khan");
    expect(
      await resolveBuddyReferral(db, {
        shopId: shop.id,
        referralId: ravi.bookingId,
        bookingId: amira.bookingId,
      }),
    ).toBeNull();
  });

  it("ignores a booking that belongs to another shop", async () => {
    const { db, shop, open } = await context();
    const ravi = await book(db, shop.id, open.id, "Ravi Nair");
    const amira = await book(db, shop.id, open.id, "Amira Khan");
    expect(
      await resolveBuddyReferral(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        referralId: buddyReferralId(ravi.bookingId),
        bookingId: amira.bookingId,
      }),
    ).toBeNull();
  });

  it("ignores a seat crediting itself", async () => {
    const { db, shop, open } = await context();
    const amira = await book(db, shop.id, open.id, "Amira Khan");
    expect(
      await resolveBuddyReferral(db, {
        shopId: shop.id,
        referralId: buddyReferralId(amira.bookingId),
        bookingId: amira.bookingId,
      }),
    ).toBeNull();
  });
});

describe("recordBuddyReferral", () => {
  it("records one row per seat, and a retry converges on the first link", async () => {
    const { db, shop, open } = await context();
    const ravi = await book(db, shop.id, open.id, "Ravi Nair");
    const keiko = await book(db, shop.id, open.id, "Keiko Tan");
    const amira = await book(db, shop.id, open.id, "Amira Khan");

    await recordBuddyReferral(db, {
      shopId: shop.id,
      bookingId: amira.bookingId,
      referredByBookingId: ravi.bookingId,
    });
    await recordBuddyReferral(db, {
      shopId: shop.id,
      bookingId: amira.bookingId,
      referredByBookingId: keiko.bookingId,
    });

    const rows = await db
      .select()
      .from(bookingReferrals)
      .where(eq(bookingReferrals.bookingId, amira.bookingId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.referredByBookingId).toBe(ravi.bookingId);
  });
});

describe("buddyReferredSeatsForWindow", () => {
  it("counts seats on this window's departures, for this shop only", async () => {
    const { db, shop, open } = await context();
    const ravi = await book(db, shop.id, open.id, "Ravi Nair");
    const amira = await book(db, shop.id, open.id, "Amira Khan");
    await recordBuddyReferral(db, {
      shopId: shop.id,
      bookingId: amira.bookingId,
      referredByBookingId: ravi.bookingId,
    });

    const from = new Date(open.startsAt.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(open.startsAt.getTime() + 24 * 60 * 60 * 1000);
    expect(await buddyReferredSeatsForWindow(db, shop.id, from, to)).toBe(1);
    expect(
      await buddyReferredSeatsForWindow(db, "00000000-0000-4000-8000-000000000000", from, to),
    ).toBe(0);

    const before = new Date(open.startsAt.getTime() - 400 * 24 * 60 * 60 * 1000);
    const beforeEnd = new Date(open.startsAt.getTime() - 300 * 24 * 60 * 60 * 1000);
    expect(await buddyReferredSeatsForWindow(db, shop.id, before, beforeEnd)).toBe(0);
  });
});
