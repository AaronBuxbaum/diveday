// @vitest-environment node

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import {
  acknowledgeReturningDiverReceipt,
  issueBookingCapability,
  issueReturningDiverReceipt,
  readReturningDiverReceipt,
  revokeReturningDiverReceipt,
} from "./booking-capabilities";
import { createBooking } from "./bookings";
import { bookingCapabilities, bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
const generationA = "11111111-1111-4111-8111-111111111111";
const generationB = "22222222-2222-4222-8222-222222222222";

function deviceToken() {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

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

async function issueFor(
  input: Awaited<ReturnType<typeof readyBooking>>,
  options: { token?: string; generation?: string | null; now?: Date } = {},
) {
  const token = options.token ?? deviceToken();
  const generation = options.generation ?? null;
  const receipt = await issueReturningDiverReceipt(input.db, {
    shopId: input.shop.id,
    bookingId: input.booking.id,
    expectedPersonId: input.booking.personId,
    expectedTripId: input.trip.id,
    redirectReadinessToken: input.redirect.token,
    deviceToken: token,
    deviceGeneration: generation,
    now: options.now,
  });
  return receipt ? { ...receipt, deviceToken: token, deviceGeneration: generation } : null;
}

describe("returning-diver receipt slots", () => {
  it("retries after leaving before hydration and acknowledges idempotently", async () => {
    const booking = await readyBooking();
    const receipt = await issueFor(booking);
    if (!receipt) throw new Error("expected receipt");
    const firstVisit = await readReturningDiverReceipt(booking.db, {
      deviceToken: receipt.deviceToken,
      deviceGeneration: receipt.deviceGeneration,
    });
    expect(firstVisit?.shopSlug).toBe(booking.shop.slug);
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        deviceGeneration: receipt.deviceGeneration,
      }),
    ).toEqual(firstVisit);
    expect(
      await acknowledgeReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        expectedReceiptId: "00000000-0000-0000-0000-000000000000",
        deviceGeneration: receipt.deviceGeneration,
      }),
    ).toBe(false);
    expect(
      await acknowledgeReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        expectedReceiptId: receipt.receiptId,
        deviceGeneration: receipt.deviceGeneration,
      }),
    ).toBe(true);
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        deviceGeneration: receipt.deviceGeneration,
      }),
    ).toBeNull();
    expect(
      await acknowledgeReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        expectedReceiptId: receipt.receiptId,
        deviceGeneration: receipt.deviceGeneration,
      }),
    ).toBe(true);
  });

  it("uses strict database order to keep the newest same-shop opt-in", async () => {
    const first = await readyBooking();
    const token = deviceToken();
    const sameInstant = nowDate();
    const older = await issueFor(first, { token, now: sameInstant });
    if (!older) throw new Error("expected first receipt");
    const second = await readyBooking();
    const newer = await issueFor(second, { token, now: sameInstant });
    if (!newer) throw new Error("expected second receipt");

    expect(BigInt(newer.receiptOrder)).toBeGreaterThan(BigInt(older.receiptOrder));
    expect(
      await readReturningDiverReceipt(second.db, {
        deviceToken: token,
        deviceGeneration: null,
        now: sameInstant,
      }),
    ).toMatchObject({
      receiptId: newer.receiptId,
      diver: { fullName: expect.stringContaining("Opt-in") },
    });
    expect(
      await readReturningDiverReceipt(second.db, {
        deviceToken: token,
        deviceGeneration: null,
        now: sameInstant,
      }),
    ).not.toMatchObject({ receiptId: older.receiptId });
  });

  it("filters receipts from an old clear generation and accepts a later opt-in", async () => {
    const first = await readyBooking();
    const token = deviceToken();
    const old = await issueFor(first, { token, generation: generationA });
    if (!old) throw new Error("expected old-generation receipt");
    const second = await readyBooking();
    const current = await issueFor(second, { token, generation: generationB });
    if (!current) throw new Error("expected current-generation receipt");

    expect(
      await readReturningDiverReceipt(second.db, {
        deviceToken: token,
        deviceGeneration: generationA,
      }),
    ).toBeNull();
    expect(
      await readReturningDiverReceipt(second.db, {
        deviceToken: token,
        deviceGeneration: generationB,
      }),
    ).toMatchObject({ receiptId: current.receiptId });
  });

  it("clears by receipt and device slot without accepting a caller-selected shop", async () => {
    const booking = await readyBooking();
    const receipt = await issueFor(booking);
    if (!receipt) throw new Error("expected receipt");
    expect(
      await revokeReturningDiverReceipt(booking.db, {
        deviceToken: "b".repeat(64),
        nextDeviceGeneration: generationB,
      }),
    ).toBe(false);
    expect(
      await revokeReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        nextDeviceGeneration: generationB,
      }),
    ).toBe(true);
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        deviceGeneration: receipt.deviceGeneration,
      }),
    ).toBeNull();
  });

  it("refuses canceled, erased, expired, wrong-slot, and unrelated capabilities", async () => {
    const booking = await readyBooking();
    const receipt = await issueFor(booking);
    if (!receipt) throw new Error("expected receipt");
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: "c".repeat(64),
        deviceGeneration: null,
      }),
    ).toBeNull();
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        deviceGeneration: null,
        now: new Date(booking.redirect.expiresAt.getTime() + 1),
      }),
    ).toBeNull();

    await booking.db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, booking.booking.id));
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        deviceGeneration: null,
      }),
    ).toBeNull();

    const unrelated = await readyBooking();
    expect(
      await issueReturningDiverReceipt(unrelated.db, {
        shopId: unrelated.shop.id,
        bookingId: unrelated.booking.id,
        expectedPersonId: unrelated.booking.personId,
        expectedTripId: unrelated.trip.id,
        redirectReadinessToken: unrelated.mailed.token,
        deviceToken: deviceToken(),
        deviceGeneration: null,
      }),
    ).toBeNull();
  });

  it("does not resolve the person after erasure and stores no identity in the capability", async () => {
    const booking = await readyBooking();
    const receipt = await issueFor(booking);
    if (!receipt) throw new Error("expected receipt");
    await booking.db
      .update(people)
      .set({
        fullName: "Deleted diver",
        email: null,
        deletedAt: nowDate(),
        anonymizedAt: nowDate(),
      })
      .where(eq(people.id, booking.booking.personId));
    expect(
      await readReturningDiverReceipt(booking.db, {
        deviceToken: receipt.deviceToken,
        deviceGeneration: null,
      }),
    ).toBeNull();
    const [row] = await booking.db
      .select({
        tokenHash: bookingCapabilities.tokenHash,
        returningDeviceHash: bookingCapabilities.returningDeviceHash,
        returningOrder: bookingCapabilities.returningOrder,
      })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.id, receipt.receiptId))
      .limit(1);
    expect(row?.tokenHash).not.toBe(receipt.deviceToken);
    expect(row?.returningDeviceHash).not.toBe(receipt.deviceToken);
    expect(row).not.toHaveProperty("fullName");
    expect(row).not.toHaveProperty("email");
  });
});
