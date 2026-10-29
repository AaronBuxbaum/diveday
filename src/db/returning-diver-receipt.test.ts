// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  acknowledgeReturningDiverReceipt,
  consumeReturningDiverReceipt,
  issueBookingCapability,
  issueReturningDiverReceipt,
  RETURNING_DIVER_MEMORY_MS,
  readReturningDiverReceipt,
  revokeReturningDiverReceipt,
} from "./booking-capabilities";
import { createBooking, createBookingParty } from "./bookings";
import { bookingCapabilities, bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

async function readyBooking() {
  const { db, shop } = ctx;
  const [trip, secondTrip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip || !secondTrip) throw new Error("expected seeded departures");
  const created = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: `Opt-in ${crypto.randomUUID()}`,
    email: `optin-${crypto.randomUUID()}@example.com`,
  });
  if (!created.ok) throw new Error("expected booking to succeed");
  const [booking] = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.id, created.bookingId), eq(bookings.shopId, shop.id)))
    .limit(1);
  if (!booking) throw new Error("created booking missing");
  const redirect = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.id,
    purpose: "readiness",
    expectedPersonId: booking.personId,
    expectedTripId: trip.id,
  });
  const mailed = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.id,
    purpose: "readiness",
    expectedPersonId: booking.personId,
    expectedTripId: trip.id,
    delivered: true,
  });
  if (!redirect || !mailed) throw new Error("expected distinct readiness links");
  return { db, shop, trip, secondTrip, booking, redirect, mailed };
}

describe("returning-diver receipt", () => {
  it("survives leaving before hydration and retries idempotently until storage is acknowledged", async () => {
    const { db, shop, trip, booking, redirect } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");

    // The first page is left before hydration, so no request consumes it.
    const firstVisit = await readReturningDiverReceipt(db, { receiptToken: receipt.token, now });
    if (!firstVisit) throw new Error("expected a retryable receipt");
    expect(firstVisit?.shopSlug).toBe(shop.slug);
    // A later same-origin page can safely retry after a response was lost.
    expect(await readReturningDiverReceipt(db, { receiptToken: receipt.token, now })).toEqual(
      firstVisit,
    );
    expect(
      await acknowledgeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: "00000000-0000-0000-0000-000000000000",
        now,
      }),
    ).toBe(false);
    expect(
      await acknowledgeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: firstVisit.receiptId,
        now,
      }),
    ).toBe(true);
    // If the acknowledgement response was lost, the server recognizes it
    // without returning identity again, and repeated acknowledgements are safe.
    expect(await readReturningDiverReceipt(db, { receiptToken: receipt.token, now })).toBeNull();
    expect(
      await acknowledgeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: firstVisit.receiptId,
        now,
      }),
    ).toBe(true);
  });

  it("does not resolve a receipt for a wrong, canceled, or expired subject", async () => {
    const { db, shop, trip, booking, redirect } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");
    expect(await readReturningDiverReceipt(db, { receiptToken: "a".repeat(32), now })).toBeNull();
    expect(
      await readReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        now: new Date(receipt.expiresAt),
      }),
    ).toBeNull();

    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(await readReturningDiverReceipt(db, { receiptToken: receipt.token, now })).toBeNull();
  });

  it("revokes only the cookie-bound receipt for its matching shop", async () => {
    const { db, shop, trip, booking, redirect } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");
    const memory = await readReturningDiverReceipt(db, { receiptToken: receipt.token, now });
    if (!memory) throw new Error("expected retryable receipt");

    expect(
      await revokeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: "00000000-0000-0000-0000-000000000000",
        shopSlug: shop.slug,
        now,
      }),
    ).toBe(false);
    expect(
      await revokeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: memory.receiptId,
        shopSlug: "another-shop",
        now,
      }),
    ).toBe(false);
    expect(
      await revokeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: memory.receiptId,
        shopSlug: shop.slug,
        now,
      }),
    ).toBe(true);
    expect(await readReturningDiverReceipt(db, { receiptToken: receipt.token, now })).toBeNull();
  });

  it("does not resolve a receipt after erasure", async () => {
    const { db, shop, trip, booking, redirect } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");
    await db
      .update(people)
      .set({
        fullName: "Deleted diver",
        email: null,
        deletedAt: now,
        anonymizedAt: now,
      })
      .where(eq(people.id, booking.personId));
    expect(await readReturningDiverReceipt(db, { receiptToken: receipt.token, now })).toBeNull();
  });

  it("allows duplicate tabs to retry the same receipt and acknowledge safely", async () => {
    const { db, shop, trip, booking, redirect } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");
    const [tabA, tabB] = await Promise.all([
      readReturningDiverReceipt(db, { receiptToken: receipt.token, now }),
      readReturningDiverReceipt(db, { receiptToken: receipt.token, now }),
    ]);
    expect(tabA).toEqual(tabB);
    if (!tabA || !tabB) throw new Error("expected both tabs to resolve the receipt");
    const acks = await Promise.all([
      acknowledgeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: tabA.receiptId,
        now,
      }),
      acknowledgeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        expectedReceiptId: tabB.receiptId,
        now,
      }),
    ]);
    expect(acks).toEqual([true, true]);
  });

  it("redeems only against the exact browser redirect token, once", async () => {
    const { db, shop, trip, booking, redirect, mailed } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");

    expect(
      await consumeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        redirectReadinessToken: mailed.token,
        now,
      }),
    ).toBeNull();
    const redeemed = await consumeReturningDiverReceipt(db, {
      receiptToken: receipt.token,
      redirectReadinessToken: redirect.token,
      now,
    });
    expect(redeemed).toMatchObject({
      diver: {
        fullName: expect.stringMatching(/^Opt-in /),
        email: expect.stringMatching(/^optin-/),
      },
      memoryExpiresAt: now.getTime() + RETURNING_DIVER_MEMORY_MS,
    });
    expect(
      await consumeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        redirectReadinessToken: redirect.token,
        now,
      }),
    ).toBeNull();

    const [row] = await db
      .select({
        purpose: bookingCapabilities.purpose,
        sourceCapabilityId: bookingCapabilities.sourceCapabilityId,
      })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, booking.id),
          eq(bookingCapabilities.purpose, "returning_diver_receipt"),
        ),
      )
      .limit(1);
    expect(row?.sourceCapabilityId).toBeTruthy();
    expect(row).not.toHaveProperty("fullName");
    expect(row).not.toHaveProperty("email");
  });

  it("does not issue a receipt for a mailed token or a different booking", async () => {
    const { db, shop, trip, booking, redirect, mailed, secondTrip } = await readyBooking();
    expect(
      await issueReturningDiverReceipt(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: booking.personId,
        expectedTripId: trip.id,
        redirectReadinessToken: mailed.token,
      }),
    ).toBeNull();
    expect(
      await issueReturningDiverReceipt(db, {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: booking.personId,
        expectedTripId: secondTrip.id,
        redirectReadinessToken: redirect.token,
      }),
    ).toBeNull();
  });

  it("does not issue or redeem a held-identity booking", async () => {
    const { db, shop } = ctx;
    const [trip, nextTrip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip || !nextTrip) throw new Error("expected seeded departures");
    const email = `held-${crypto.randomUUID()}@example.com`;
    const existing = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Alex Rivera",
      email,
    });
    if (!existing.ok) throw new Error("expected original booking");
    const held = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: nextTrip.id,
        fullName: "Sam Rivera",
        email,
      },
    ]);
    if (!held.ok) throw new Error("expected public booking to be held, not refused");
    const bookingId = held.bookings[0]?.bookingId;
    const personId = held.bookings[0]?.personId;
    if (!bookingId || !personId) throw new Error("held booking missing");
    const redirect = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
      expectedPersonId: personId,
      expectedTripId: nextTrip.id,
    });
    if (!redirect) throw new Error("expected redirect readiness capability");
    expect(
      await issueReturningDiverReceipt(db, {
        shopId: shop.id,
        bookingId,
        expectedPersonId: personId,
        expectedTripId: nextTrip.id,
        redirectReadinessToken: redirect.token,
      }),
    ).toBeNull();
  });

  it("expires the receipt independently from the 30-day device-memory lifetime", async () => {
    const { db, shop, trip, booking, redirect } = await readyBooking();
    const now = nowDate();
    const receipt = await issueReturningDiverReceipt(db, {
      shopId: shop.id,
      bookingId: booking.id,
      expectedPersonId: booking.personId,
      expectedTripId: trip.id,
      redirectReadinessToken: redirect.token,
      now,
    });
    if (!receipt) throw new Error("expected receipt to be issued");

    expect(
      await consumeReturningDiverReceipt(db, {
        receiptToken: receipt.token,
        redirectReadinessToken: redirect.token,
        now: new Date(now.getTime() + DAY_MS + 1),
      }),
    ).toBeNull();
  });
});
