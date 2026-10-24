import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
  deliveryCarriesFigure,
  FLY_SAFE_CORRECTION_WINDOW_MS,
  flySafeToldUncorrected,
  recordFlySafeTold,
  rememberFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { bookings, people, trips as tripRows } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A diver told a fly-safe wait hears once that it no longer applies**
 * (issue #2927). The night-before email said "fly no earlier than 24 hours";
 * the departure was then marked as decompression diving. Each diver who was
 * told a figure gets one correction, and nobody else gets anything.
 */

const ctx = fileScopedShopContext();

async function toldSeat(email = "flysafe-pat@example.com") {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: reef.id, fullName: "Pat Party", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  await recordFlySafeTold(db, { shopId: shop.id, bookingId, hours: 24 });
  return { db, shop, reef, bookingId, email };
}

async function markDeco(db: typeof ctx.db, tripId: string, on = true) {
  await db.update(tripRows).set({ exceedsNoDecoLimits: on }).where(eq(tripRows.id, tripId));
}

async function seat(db: typeof ctx.db, bookingId: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!row) throw new Error("seat missing");
  return row;
}

describe("sendFlySafeCorrections (#2927)", () => {
  it("sends the diver told a figure one correction, in their language, and never a second", async () => {
    const { db, shop, reef, bookingId, email } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - 20 * HOUR_MS);
    const mail = fakeEmail();
    const first = await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: mail.provider,
    });
    expect(first).toEqual({ told: 1, failed: 0, unreached: [] });
    const ours = mail.sent.filter((n) => n.kind === "fly_safe_correction");
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({ kind: "fly_safe_correction", seatId: bookingId, to: email });
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toEqual(now);

    const again = fakeEmail();
    expect(
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        now,
        emailProvider: again.provider,
      }),
    ).toEqual({ told: 0, failed: 0, unreached: [] });
    expect(again.sent).toHaveLength(0);
  });

  it("tells nobody while the departure is not marked as decompression diving", async () => {
    const { db, shop, reef } = await toldSeat();
    const mail = fakeEmail();
    expect(
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        emailProvider: mail.provider,
      }),
    ).toEqual({ told: 0, failed: 0, unreached: [] });
    expect(mail.sent).toHaveLength(0);
  });

  it("tells nobody who was told no figure, nor a cancelled seat", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    // Never told: the night-before email had no fly-safe line.
    await db.update(bookings).set({ flySafeHoursTold: null }).where(eq(bookings.id, bookingId));
    const untold = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      emailProvider: untold.provider,
    });
    expect(untold.sent).toHaveLength(0);

    await recordFlySafeTold(db, { shopId: shop.id, bookingId, hours: 24 });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    const cancelled = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      emailProvider: cancelled.provider,
    });
    expect(cancelled.sent).toHaveLength(0);
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
  });

  it("corrects a held seat at the address the figure went to", async () => {
    const { db, shop, reef, bookingId, email } = await toldSeat("flysafe-held@example.com");
    await markDeco(db, reef.id);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: new Date(reef.startsAt.getTime() - HOUR_MS) })
      .where(eq(bookings.id, bookingId));
    const held = fakeEmail();
    expect(
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        emailProvider: held.provider,
      }),
    ).toEqual({ told: 1, failed: 0, unreached: [] });
    expect(held.sent[0]).toMatchObject({
      kind: "fly_safe_correction",
      seatId: bookingId,
      to: email,
    });
  });

  it("names a diver with no address as unreached, and keeps them owed", async () => {
    const { db, shop, reef, bookingId } = await toldSeat("flysafe-noaddress@example.com");
    await markDeco(db, reef.id);
    const row = await seat(db, bookingId);
    await db.update(people).set({ email: null }).where(eq(people.id, row.personId));
    const mail = fakeEmail();
    expect(
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        emailProvider: mail.provider,
      }),
    ).toEqual({ told: 0, failed: 1, unreached: ["Pat Party"] });
    expect(mail.sent).toHaveLength(0);
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
  });

  it("remembers the figure for a sent or queued night-before email, not a refused one", async () => {
    const { db, shop, bookingId } = await toldSeat("flysafe-queued@example.com");
    await db.update(bookings).set({ flySafeHoursTold: null }).where(eq(bookings.id, bookingId));
    const notification = { kind: "trip_reminder_24h", flySafeHours: 18 } as Notification;
    await rememberFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      notification,
      delivery: { status: "failed", retryable: false },
    });
    expect((await seat(db, bookingId)).flySafeHoursTold).toBeNull();
    await rememberFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      notification,
      delivery: { status: "failed", retryable: true },
    });
    expect((await seat(db, bookingId)).flySafeHoursTold).toBe(18);
    expect(deliveryCarriesFigure({ status: "sent", providerMessageId: "m" })).toBe(true);
    expect(deliveryCarriesFigure({ status: "not_configured" })).toBe(false);
  });

  it("tells nobody once every figure has run out, or on a departure called off", async () => {
    const { db, shop, reef } = await toldSeat();
    await markDeco(db, reef.id);
    const pastWindow = new Date(reef.endsAt.getTime() + FLY_SAFE_CORRECTION_WINDOW_MS + 60_000);
    const late = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now: pastWindow,
      emailProvider: late.provider,
    });
    expect(late.sent).toHaveLength(0);

    // Inside the window after the boat is back: still worth saying.
    const afterDive = fakeEmail();
    const told = await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now: new Date(reef.endsAt.getTime() + 2 * HOUR_MS),
      emailProvider: afterDive.provider,
    });
    expect(told.told).toBe(1);

    const other = await toldSeat("flysafe-sam@example.com");
    await db.update(tripRows).set({ status: "cancelled" }).where(eq(tripRows.id, other.reef.id));
    const calledOff = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: other.reef.id,
      emailProvider: calledOff.provider,
    });
    expect(calledOff.sent).toHaveLength(0);
  });

  it("puts the claim back when the send is refused, so the next save tries again", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const refused = fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" });
    expect(
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        emailProvider: refused.provider,
      }),
    ).toEqual({ told: 0, failed: 1, unreached: ["Pat Party"] });
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
    const retry = fakeEmail();
    expect(
      (
        await sendFlySafeCorrections(db, {
          shopId: shop.id,
          tripId: reef.id,
          emailProvider: retry.provider,
        })
      ).told,
    ).toBe(1);
  });

  it("refuses another shop's departure", async () => {
    const { db, reef } = await toldSeat();
    await markDeco(db, reef.id);
    const mail = fakeEmail();
    expect(
      await sendFlySafeCorrections(db, {
        shopId: "00000000-0000-4000-8000-000000000000",
        tripId: reef.id,
        emailProvider: mail.provider,
      }),
    ).toEqual({ told: 0, failed: 0, unreached: [] });
    expect(mail.sent).toHaveLength(0);
  });

  it("counts the seats told a figure and not yet corrected", async () => {
    const { db, bookingId } = await toldSeat();
    const row = await seat(db, bookingId);
    expect(flySafeToldUncorrected([row])).toBe(1);
    expect(flySafeToldUncorrected([{ ...row, flySafeCorrectedAt: nowDate() }])).toBe(0);
    expect(flySafeToldUncorrected([{ ...row, status: "cancelled" }])).toBe(0);
    expect(flySafeToldUncorrected([{ ...row, flySafeHoursTold: null }])).toBe(0);
    const [person] = await db.select().from(people).where(eq(people.id, row.personId));
    expect(person?.email).toBe("flysafe-pat@example.com");
  });
});
