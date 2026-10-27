import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
  deliveryCarriesFigure,
  FLY_SAFE_CORRECTION_LEASE_MS,
  FLY_SAFE_CORRECTION_WINDOW_MS,
  flySafeToldUncorrected,
  listFlySafeFollowUps,
  listShopFlySafeFollowUps,
  recordFlySafeTold,
  rememberFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { openFlySafeExposures } from "./fly-safe-exposures";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { sendDueReminders } from "./reminders";
import { bookings, notificationSendQueue, people, trips as tripRows } from "./schema";
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
  await recordFlySafeTold(db, { shopId: shop.id, bookingId, hours: 24, recipientEmail: email });
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

  it("shows queued corrections and names divers needing follow-up after permanent rejection", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    expect(await listFlySafeFollowUps(db, { shopId: shop.id, tripId: reef.id, now })).toEqual([
      { bookingId, name: "Pat Party", status: "queued" },
    ]);
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toContainEqual({
      bookingId,
      name: "Pat Party",
      status: "queued",
      tripId: reef.id,
      tripTitle: reef.title,
    });
    expect(
      await listFlySafeFollowUps(db, { shopId: crypto.randomUUID(), tripId: reef.id, now }),
    ).toEqual([]);
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, {
      now,
      provider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    expect(await listFlySafeFollowUps(db, { shopId: shop.id, tripId: reef.id, now })).toEqual([
      { bookingId, name: "Pat Party", status: "follow_up" },
    ]);
    await db
      .update(people)
      .set({ deletedAt: now })
      .where(eq(people.id, (await seat(db, bookingId)).personId));
    expect(await listFlySafeFollowUps(db, { shopId: shop.id, tripId: reef.id, now })).toEqual([]);
  });

  it("clears the queued warning only after the provider accepts the queued correction", async () => {
    const { db, shop, reef } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toHaveLength(1);
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, { now, provider: fakeEmail().provider });
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toEqual([]);
  });

  it("shows follow-up when queued retries exhaust and clears queued state on provider acceptance", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0), attempts: 2 })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, {
      now,
      provider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    expect(await listFlySafeFollowUps(db, { shopId: shop.id, tripId: reef.id, now })).toEqual([
      { bookingId, name: "Pat Party", status: "follow_up" },
    ]);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail().provider,
    });
    expect(await listFlySafeFollowUps(db, { shopId: shop.id, tripId: reef.id, now })).toEqual([]);
  });

  it("re-arms a rejected queued correction for a bounded later retry", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, {
      now,
      provider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
    const recovered = fakeEmail();
    await sendDueReminders(db, { now, emailProvider: recovered.provider, appOrigin: null });
    expect(
      recovered.sent.some((n) => n.kind === "fly_safe_correction" && n.seatId === bookingId),
    ).toBe(true);
  });

  it("re-arms a matching correction when its queued payload is missing", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0), payloadSealed: null })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, { now, provider: fakeEmail().provider });
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
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
    await sendNotification(db, legacy, fakeEmail({ status: "failed", retryable: true }).provider);
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

  it("does not deliver an already-claimed correction after its seat loses recipient provenance", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    await db
      .update(bookings)
      .set({ flySafeRecipientSealed: null, flySafeRecipientUnknown: true })
      .where(eq(bookings.id, bookingId));
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    const retry = fakeEmail();
    await drainNotificationRetries(db, { now, provider: retry.provider });
    expect(retry.sent).toHaveLength(0);
  });

  it("does not mark corrected if a queued attempt is rejected before its worker finishes", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
      send: async (client, notification, provider) => {
        const result = await sendNotification(client, notification, provider);
        await client
          .update(notificationSendQueue)
          .set({ nextAttemptAt: new Date(0) })
          .where(eq(notificationSendQueue.shopId, shop.id));
        await drainNotificationRetries(client, {
          now,
          provider: fakeEmail({ status: "failed", retryable: false }).provider,
        });
        return result;
      },
    });
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
  });

  it("re-arms the rejected exposure while preserving a newer accepted correction", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      hours: 18,
      recipientEmail: "flysafe-pat@example.com",
    });
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail().provider,
    });
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    await drainNotificationRetries(db, {
      now,
      provider: fakeEmail({ status: "failed", retryable: false }).provider,
    });
    const state = await seat(db, bookingId);
    expect(state.flySafeCorrectedAt).toBeNull();
    if (!state.flySafeRecipientSealed) throw new Error("ledger missing");
    const entries = openFlySafeExposures(state.flySafeRecipientSealed, shop.id, bookingId);
    expect(entries?.find((entry) => entry.hours === 24)?.corrected).toBe(false);
    expect(entries?.find((entry) => entry.hours === 18)?.corrected).toBe(true);
  });

  it("stops automatic retry after three correction claims", async () => {
    const { db, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    await db
      .update(bookings)
      .set({ flySafeCorrectionAttempts: 3 })
      .where(eq(bookings.id, bookingId));
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - HOUR_MS),
      emailProvider: email.provider,
      appOrigin: null,
    });
    expect(email.sent.some((n) => n.kind === "fly_safe_correction" && n.seatId === bookingId)).toBe(
      false,
    );
  });

  it.each(["before send", "after provider acceptance"])(
    "recovers a simulated worker crash %s after the lease expires",
    async (crashPoint) => {
      const { db, shop, reef, bookingId } = await toldSeat();
      await markDeco(db, reef.id);
      const now = new Date(reef.startsAt.getTime() - HOUR_MS);
      const leaseUntil = new Date(now.getTime() + FLY_SAFE_CORRECTION_LEASE_MS);
      await db
        .update(bookings)
        .set({
          flySafeCorrectionLeaseId: crypto.randomUUID(),
          flySafeCorrectionLeaseUntil: leaseUntil,
        })
        .where(eq(bookings.id, bookingId));
      const mail = fakeEmail();
      if (crashPoint === "after provider acceptance") {
        // The provider may have accepted before the worker could record it.
        await mail.provider.send({
          kind: "fly_safe_correction",
          seatId: bookingId,
          shopId: shop.id,
          to: "flysafe-pat@example.com",
          locale: "en-US",
          shopName: shop.name,
          tripTitle: reef.title,
          startsAt: reef.startsAt,
          timezone: shop.timezone,
        });
      }
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        now,
        emailProvider: mail.provider,
      });
      expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        now: new Date(leaseUntil.getTime() + 1),
        emailProvider: mail.provider,
      });
      expect(mail.sent).toHaveLength(crashPoint === "after provider acceptance" ? 2 : 1);
      expect((await seat(db, bookingId)).flySafeCorrectedAt).not.toBeNull();
    },
  );

  it("does not let an older in-flight correction mark a newer figure corrected", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    const provider: NotificationProvider = {
      async send() {
        await recordFlySafeTold(db, {
          shopId: shop.id,
          bookingId,
          hours: 18,
          recipientEmail: "flysafe-pat@example.com",
        });
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: provider,
    });
    const row = await seat(db, bookingId);
    expect(row.flySafeHoursTold).toBe(18);
    expect(row.flySafeCorrectedAt).toBeNull();
  });

  it("keeps a moved seat owed when a correction for its old trip is in flight", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const destination = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find(
      (trip) => trip.id !== reef.id && trip.status === "scheduled",
    );
    if (!destination) throw new Error("destination missing");
    await markDeco(db, destination.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    const provider: NotificationProvider = {
      async send() {
        await db.update(bookings).set({ tripId: destination.id }).where(eq(bookings.id, bookingId));
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: provider,
    });
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now })).toContainEqual({
      bookingId,
      name: "Pat Party",
      status: "follow_up",
      tripId: destination.id,
      tripTitle: destination.title,
    });
    const retry = fakeEmail();
    await sendDueReminders(db, { now, emailProvider: retry.provider, appOrigin: null });
    expect(retry.sent.some((n) => n.kind === "fly_safe_correction" && n.seatId === bookingId)).toBe(
      true,
    );
  });

  it("does not mark a correction accepted while its provider is still in flight", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    let started!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: NotificationProvider = {
      async send() {
        started();
        await blocked;
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    const first = sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: provider,
    });
    try {
      await entered;
      expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
      expect(
        await sendFlySafeCorrections(db, {
          shopId: shop.id,
          tripId: reef.id,
          now,
          emailProvider: fakeEmail().provider,
        }),
      ).toEqual({ told: 0, failed: 0, unreached: [] });
    } finally {
      release();
      await first;
    }
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toEqual(now);
  });

  it("persists a second correction after a newer figure, without colliding with the first retry", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    const mail = fakeEmail({ status: "failed", retryable: true });
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: mail.provider,
    });
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      hours: 18,
      recipientEmail: "flysafe-pat@example.com",
    });
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: mail.provider,
    });
    const rows = await db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.shopId, shop.id));
    expect(rows.filter((row) => row.status === "queued")).toHaveLength(2);
    expect(new Set(rows.map((row) => row.idempotencyKey)).size).toBe(2);
  });

  it("retries an unqueued correction on the next reminder pass", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    try {
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        now,
        emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
      });
    } finally {
      vi.unstubAllEnvs();
    }
    const recovered = fakeEmail();
    await sendDueReminders(db, { now, emailProvider: recovered.provider, appOrigin: null });
    expect(
      recovered.sent.some(
        (value) => value.kind === "fly_safe_correction" && value.seatId === bookingId,
      ),
    ).toBe(true);
  });

  it("releases the correction claim when a retry cannot be persisted", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    try {
      const result = await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: reef.id,
        now: new Date(reef.startsAt.getTime() - HOUR_MS),
        emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
      });
      expect(result.unreached).toEqual(["Pat Party"]);
      expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
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

    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      hours: 24,
      recipientEmail: "flysafe-pat@example.com",
    });
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

  it("uses the recorded original address when the current address is removed", async () => {
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
    ).toEqual({ told: 1, failed: 0, unreached: [] });
    expect(mail.sent).toMatchObject([{ to: "flysafe-noaddress@example.com" }]);
    expect((await seat(db, bookingId)).flySafeCorrectedAt).not.toBeNull();
  });

  it("reports an unknown historical recipient for staff follow-up", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await markDeco(db, reef.id);
    await db
      .update(bookings)
      .set({ flySafeRecipientSealed: null })
      .where(eq(bookings.id, bookingId));
    const mail = fakeEmail();
    const result = await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      emailProvider: mail.provider,
    });
    expect(result.unreached).toEqual(["Pat Party"]);
    expect(mail.sent).toHaveLength(0);
    expect((await seat(db, bookingId)).flySafeCorrectedAt).toBeNull();
  });

  it("corrects every inbox that received an uncorrected numeric reminder", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      hours: 18,
      recipientEmail: "second-inbox@example.com",
    });
    await markDeco(db, reef.id);
    const mail = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      emailProvider: mail.provider,
    });
    expect(mail.sent.filter((n) => n.kind === "fly_safe_correction").map((n) => n.to)).toEqual(
      expect.arrayContaining(["flysafe-pat@example.com", "second-inbox@example.com"]),
    );
  });

  it("retries only an uncorrected inbox after a partial provider failure", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId,
      hours: 18,
      recipientEmail: "second-inbox@example.com",
    });
    await markDeco(db, reef.id);
    const seen: string[] = [];
    const provider: NotificationProvider = {
      async send(notification) {
        if (!("to" in notification)) throw new Error("recipient missing");
        seen.push(notification.to);
        return notification.to === "second-inbox@example.com"
          ? { status: "failed", retryable: false }
          : { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      emailProvider: provider,
    });
    expect(seen).toEqual(["flysafe-pat@example.com", "second-inbox@example.com"]);
    const retry = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      emailProvider: retry.provider,
    });
    expect(retry.sent).toMatchObject([{ to: "second-inbox@example.com" }]);
  });

  it("refuses a recipient snapshot copied from a different seat", async () => {
    const { db, shop, reef, bookingId } = await toldSeat();
    const other = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Other Diver",
        email: "other-snapshot@example.com",
      },
    ]);
    if (!other.ok) throw new Error("other seat missing");
    await recordFlySafeTold(db, {
      shopId: shop.id,
      bookingId: other.bookings[0].bookingId,
      hours: 24,
      recipientEmail: "other-snapshot@example.com",
    });
    const copied = await seat(db, other.bookings[0].bookingId);
    await db
      .update(bookings)
      .set({ flySafeRecipientSealed: copied.flySafeRecipientSealed })
      .where(eq(bookings.id, bookingId));
    await markDeco(db, reef.id);
    const mail = fakeEmail();
    const result = await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      bookingId,
      emailProvider: mail.provider,
    });
    expect(result.unreached).toEqual(["Pat Party"]);
    expect(mail.sent).toHaveLength(0);
  });

  it("remembers the figure for a sent or queued night-before email, not a refused one", async () => {
    const { db, shop, bookingId } = await toldSeat("flysafe-queued@example.com");
    await db.update(bookings).set({ flySafeHoursTold: null }).where(eq(bookings.id, bookingId));
    const notification = {
      kind: "trip_reminder_24h",
      flySafeHours: 18,
      to: "flysafe-queued@example.com",
      personId: (await seat(db, bookingId)).personId,
    } as Notification;
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
