import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { sealSecret, secretKeyFromEnvironment } from "@/lib/secret-box";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
  acknowledgeFlySafeFollowUp,
  FLY_SAFE_CORRECTION_WINDOW_MS,
  listShopFlySafeFollowUps,
  recordFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { drainNotificationRetries } from "./notifications";
import { bookings, notificationSendQueue, people, trips as tripRows } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
async function toldSeat() {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((t) =>
    t.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Pat Party",
      email: "flysafe-pat@example.com",
    },
  ]);
  if (!party.ok) throw new Error("booking failed");
  const bookingId = party.bookings[0].bookingId;
  await recordFlySafeTold(db, {
    shopId: shop.id,
    bookingId,
    hours: 24,
    recipientEmail: "flysafe-pat@example.com",
  });
  return { db, shop, reef, bookingId };
}
async function markDeco(db: typeof ctx.db, tripId: string) {
  await db.update(tripRows).set({ exceedsNoDecoLimits: true }).where(eq(tripRows.id, tripId));
}
async function seat(db: typeof ctx.db, bookingId: string) {
  const [row] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!row) throw new Error("seat missing");
  return row;
}

describe("flying guidance follow-up", () => {
  it("retains a cancelled seat's unresolved task until staff acknowledge the reviewed guidance", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    await db.update(tripRows).set({ status: "cancelled" }).where(eq(tripRows.id, reef.id));
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toEqual([
      expect.objectContaining({ bookingId, status: "queued" }),
    ]);
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, {
      now,
      provider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    const [staff] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff Member" })
      .returning();
    if (!staff) throw new Error("staff missing");
    const [task] = await listShopFlySafeFollowUps(db, { shopId: shop.id, now });
    expect(task).toMatchObject({ bookingId, status: "follow_up" });
    expect(
      await acknowledgeFlySafeFollowUp(db, {
        shopId: crypto.randomUUID(),
        bookingId,
        actorPersonId: staff.id,
        fingerprint: task.fingerprint,
      }),
    ).toBe(false);
    expect(
      await acknowledgeFlySafeFollowUp(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        fingerprint: task.fingerprint,
      }),
    ).toBe(true);
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toEqual([]);
    expect(await seat(db, bookingId)).toMatchObject({
      flySafeAcknowledgedByPersonId: staff.id,
      flySafeAcknowledgementFingerprint: task.fingerprint,
    });
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      hours: 18,
      recipientEmail: "flysafe-pat@example.com",
    });
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toHaveLength(1);
    expect(
      await acknowledgeFlySafeFollowUp(db, {
        shopId: shop.id,
        bookingId,
        actorPersonId: staff.id,
        fingerprint: task.fingerprint,
      }),
    ).toBe(false);
  });

  it("keeps queued and rejected corrections visible after the automatic sending window", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const before = new Date(reef.startsAt.getTime() - HOUR_MS);
    const after = new Date(reef.endsAt.getTime() + FLY_SAFE_CORRECTION_WINDOW_MS + HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now: before,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    const expected = { bookingId, name: "Pat Party", tripId: reef.id, tripTitle: reef.title };
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now: after })).toContainEqual(
      expect.objectContaining({
        ...expected,
        status: "queued",
      }),
    );
    expect(await listShopFlySafeFollowUps(db, { shopId: crypto.randomUUID(), now: after })).toEqual(
      [],
    );
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, {
      now: after,
      provider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now: after })).toContainEqual(
      expect.objectContaining({
        ...expected,
        status: "follow_up",
      }),
    );
    const provider = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now: after,
      emailProvider: provider.provider,
    });
    expect(provider.sent).toEqual([]);
    await db
      .update(people)
      .set({ anonymizedAt: after, deletedAt: after })
      .where(eq(people.id, (await seat(db, bookingId)).personId));
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now: after })).toEqual([]);
  });
  it("marks a legacy queued correction for staff follow-up when its recipient cannot be proven", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    const legacy: Notification = {
      kind: "fly_safe_correction",
      seatId: bookingId,
      shopId: shop.id,
      to: "flysafe-pat@example.com",
      locale: "en-US",
      shopName: shop.name,
      tripTitle: reef.title,
      startsAt: reef.startsAt,
      timezone: shop.timezone,
    };
    // Construct the legacy outbox row directly: new sends refuse an unproven recipient.
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    const key = secretKeyFromEnvironment();
    if (key.status !== "ok") throw new Error("test key missing");
    await db
      .update(notificationSendQueue)
      .set({
        payloadSealed: sealSecret(JSON.stringify(legacy), key.key),
        idempotencyKey: `fly-safe-correction/${bookingId}`,
      })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await db
      .update(bookings)
      .set({ flySafeRecipientSealed: null, flySafeCorrectedAt: now })
      .where(eq(bookings.id, bookingId));
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    const retry = fakeEmail();
    await drainNotificationRetries(db, { now, provider: retry.provider });
    expect(retry.sent).toHaveLength(0);
    const after = await seat(db, bookingId);
    expect(after.flySafeCorrectedAt).toBeNull();
    expect(after.flySafeRecipientUnknown).toBe(true);
  });
});
