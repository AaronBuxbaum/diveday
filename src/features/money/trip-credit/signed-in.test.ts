import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { endDiverSession, issueDiverSignIn, startDiverSession } from "@/db/diver-sign-in";
import { createPerson } from "@/db/people";
import { bookings, people } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { tripCreditTestFixture } from "@/test/trip-credit-fixture";
import { grantTripCredit, readTripCredit, redeemSignedInTripCredit } from "./store";

/**
 * ADR 20261125-diver-sign-in: a signed-in diver's session is the proof that
 * spends their own credit, once, on their own seat.
 */
const ctx = fileScopedShopContext();

async function sessionFor(db: typeof ctx.db, shopId: string, personId: string) {
  const [person] = await db.select().from(people).where(eq(people.id, personId));
  const issued = await issueDiverSignIn(db, { shopId, email: person?.email ?? "" });
  const session = await startDiverSession(db, { token: issued?.token ?? "" });
  if (!session) throw new Error("expected a session");
  return session.token;
}

it("spends once however often the same attempt is replayed", async () => {
  const f = await tripCreditTestFixture(ctx.db, ctx.shop);
  await grantTripCredit(f.db, { ...f.grant, amountCents: 15_000 });
  const sessionToken = await sessionFor(f.db, f.shop.id, f.diver.id);
  const attempt = {
    shopId: f.shop.id,
    sessionToken,
    bookingId: f.booking.id,
    attemptId: randomUUID(),
    currency: "usd",
    expectedFareCents: 10_000,
  };
  expect(await redeemSignedInTripCredit(f.db, attempt)).toMatchObject({
    ok: true,
    replay: false,
    balanceCents: 5_000,
  });
  expect(await redeemSignedInTripCredit(f.db, attempt)).toMatchObject({ ok: true, replay: true });
  // A fresh attempt on the same, now paid, seat spends nothing either.
  expect(
    await redeemSignedInTripCredit(f.db, { ...attempt, attemptId: randomUUID() }),
  ).toMatchObject({ ok: false });
  expect((await readTripCredit(f.db, f.shop.id, f.diver.id, "usd")).balanceCents).toBe(5_000);
});

it("refuses someone else's booking", async () => {
  const f = await tripCreditTestFixture(ctx.db, ctx.shop);
  const stranger = await createPerson(f.db, {
    shopId: f.shop.id,
    fullName: "Someone Else",
    email: `${randomUUID()}@example.com`,
    phone: null,
    origin: "counter",
  });
  await grantTripCredit(f.db, { ...f.grant, personId: stranger.id });
  const sessionToken = await sessionFor(f.db, f.shop.id, stranger.id);
  expect(
    await redeemSignedInTripCredit(f.db, {
      shopId: f.shop.id,
      sessionToken,
      bookingId: f.booking.id,
      attemptId: randomUUID(),
      currency: "usd",
      expectedFareCents: 10_000,
    }),
  ).toMatchObject({ ok: false, reason: "not_found" });
  expect((await readTripCredit(f.db, f.shop.id, stranger.id, "usd")).balanceCents).toBe(10_000);
});

it("refuses after sign out, and on a held identity", async () => {
  const f = await tripCreditTestFixture(ctx.db, ctx.shop);
  await grantTripCredit(f.db, f.grant);
  const sessionToken = await sessionFor(f.db, f.shop.id, f.diver.id);
  const attempt = {
    shopId: f.shop.id,
    sessionToken,
    bookingId: f.booking.id,
    attemptId: randomUUID(),
    currency: "usd",
    expectedFareCents: 10_000,
  };
  await f.db
    .update(bookings)
    .set({ identityUnconfirmedAt: nowDate() })
    .where(eq(bookings.id, f.booking.id));
  expect(await redeemSignedInTripCredit(f.db, attempt)).toMatchObject({
    ok: false,
    reason: "not_authorized",
  });
  await endDiverSession(f.db, { token: sessionToken });
  expect(await redeemSignedInTripCredit(f.db, attempt)).toMatchObject({
    ok: false,
    reason: "not_authorized",
  });
  expect((await readTripCredit(f.db, f.shop.id, f.diver.id, "usd")).balanceCents).toBe(10_000);
});
