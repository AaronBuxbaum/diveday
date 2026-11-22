import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { issueBookingCapability, revokeBookingCapabilities } from "@/db/booking-capabilities";
import { bookings } from "@/db/schema";
import { fileScopedShopContext } from "@/test/db";
import { tripCreditTestFixture } from "@/test/trip-credit-fixture";
import { redeemOwnTripCredit } from "./self-service";
import { grantTripCredit, readTripCredit } from "./store";

const ctx = fileScopedShopContext();

it("lets the delivered link spend only its own full fare, once", async () => {
  const f = await tripCreditTestFixture(ctx.db, ctx.shop);
  await grantTripCredit(f.db, f.grant);
  const link = await issueBookingCapability(f.db, {
    shopId: f.shop.id,
    bookingId: f.booking.id,
    purpose: "readiness",
    delivered: true,
  });
  if (!link) throw new Error("missing delivered link");
  const attemptId = randomUUID();
  const input = { token: link.token, attemptId, expectedFareCents: 10_000, currency: "usd" };
  expect(await redeemOwnTripCredit(f.db, input)).toMatchObject({
    ok: true,
    balanceCents: 0,
    replay: false,
  });
  expect(await redeemOwnTripCredit(f.db, input)).toMatchObject({ ok: true, replay: true });
  expect(await redeemOwnTripCredit(f.db, { ...input, expectedFareCents: 9_999 })).toMatchObject({
    ok: false,
    reason: "changed",
  });
  expect((await readTripCredit(f.db, f.shop.id, f.diver.id, "usd")).balanceCents).toBe(0);
});

it("refuses an undelivered, revoked, or held link without spending credit", async () => {
  const f = await tripCreditTestFixture(ctx.db, ctx.shop);
  await grantTripCredit(f.db, f.grant);
  const browser = await issueBookingCapability(f.db, {
    shopId: f.shop.id,
    bookingId: f.booking.id,
    purpose: "readiness",
  });
  const delivered = await issueBookingCapability(f.db, {
    shopId: f.shop.id,
    bookingId: f.booking.id,
    purpose: "readiness",
    delivered: true,
  });
  if (!browser || !delivered) throw new Error("missing links");
  const spend = (token: string) =>
    redeemOwnTripCredit(f.db, {
      token,
      attemptId: randomUUID(),
      expectedFareCents: 10_000,
      currency: "usd",
    });
  expect(await spend(browser.token)).toMatchObject({ ok: false });
  await f.db
    .update(bookings)
    .set({ identityUnconfirmedAt: new Date("2026-01-01") })
    .where(eq(bookings.id, f.booking.id));
  expect(await spend(delivered.token)).toMatchObject({ ok: false });
  await f.db
    .update(bookings)
    .set({ identityUnconfirmedAt: null })
    .where(eq(bookings.id, f.booking.id));
  await revokeBookingCapabilities(f.db, { shopId: f.shop.id, bookingId: f.booking.id });
  expect(await spend(delivered.token)).toMatchObject({ ok: false });
  expect((await readTripCredit(f.db, f.shop.id, f.diver.id, "usd")).balanceCents).toBe(10_000);
});
