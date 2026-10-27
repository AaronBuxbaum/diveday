import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";
import { fakeEmail } from "@/test/fakes";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { createBookingParty } from "./bookings";
import {
  rearmFailedFlySafeCorrection,
  recordFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { openFlySafeExposures } from "./fly-safe-exposures";
import { bookings, people, trips } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { createTrip } from "./trips";

describePostgres("fly-safe correction leases across connections", () => {
  it("allows one live claim and records acceptance only when the provider returns", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const startsAt = new Date("2035-03-12T12:00:00.000Z");
    const reef = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Concurrent trip",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
      plannedDives: 2,
    });
    if (!reef) throw new Error("trip missing");
    const party = await createBookingParty(pg.db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Concurrent Diver",
        email: "concurrent-flysafe@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`seat failed: ${party.reason}`);
    const bookingId = party.bookings[0].bookingId;
    await recordFlySafeTold(pg.db, {
      shopId: shop.id,
      bookingId,
      hours: 24,
      recipientEmail: "concurrent-flysafe@example.com",
    });
    await pg.db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, reef.id));
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
    const first = sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: provider,
    });
    try {
      await entered;
      const [during] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
      expect(during?.flySafeCorrectedAt).toBeNull();
      const second = fakeEmail();
      await sendFlySafeCorrections(pg.connect(), {
        shopId: shop.id,
        tripId: reef.id,
        now,
        emailProvider: second.provider,
      });
      expect(second.sent).toHaveLength(0);
    } finally {
      release();
      await first;
    }
    const [after] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(after?.flySafeCorrectedAt).toEqual(now);
    if (!after?.flySafeCorrectionId) throw new Error("generation missing");
    const oldGeneration = after.flySafeCorrectionId;
    await recordFlySafeTold(pg.db, {
      shopId: shop.id,
      bookingId,
      hours: 18,
      recipientEmail: "concurrent-flysafe@example.com",
    });
    await sendFlySafeCorrections(pg.db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail().provider,
    });
    await rearmFailedFlySafeCorrection(pg.connect(), {
      shopId: shop.id,
      bookingId,
      correctionId: oldGeneration,
    });
    const [newer] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(newer?.flySafeCorrectedAt).toBeNull();
    if (!newer?.flySafeRecipientSealed) throw new Error("ledger missing");
    const entries = openFlySafeExposures(newer.flySafeRecipientSealed, shop.id, bookingId);
    expect(entries?.find((entry) => entry.hours === 18)?.corrected).toBe(true);
    expect(entries?.find((entry) => entry.hours === 24)?.corrected).toBe(false);
    await pg.db
      .update(bookings)
      .set({ flySafeCorrectedAt: null, flySafeCorrectionAttempts: 3 })
      .where(eq(bookings.id, bookingId));
    const capped = fakeEmail();
    await sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      now,
      automatic: true,
      emailProvider: capped.provider,
    });
    expect(capped.sent).toHaveLength(0);
    await sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: capped.provider,
    });
    expect(capped.sent).toHaveLength(1);
    await Promise.all([
      recordFlySafeTold(pg.connect(), {
        shopId: shop.id,
        bookingId,
        hours: 18,
        recipientEmail: "first-race@example.com",
      }),
      recordFlySafeTold(pg.connect(), {
        shopId: shop.id,
        bookingId,
        hours: 24,
        recipientEmail: "second-race@example.com",
      }),
    ]);
    const two = fakeEmail();
    await sendFlySafeCorrections(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: two.provider,
    });
    expect(two.sent.map((value) => ("to" in value ? value.to : ""))).toEqual(
      expect.arrayContaining(["first-race@example.com", "second-race@example.com"]),
    );

    let locked!: () => void;
    let unlock!: () => void;
    const enteredErasure = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const blockedErasure = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const erase = pg.connect().transaction(async (tx) => {
      await tx
        .update(people)
        .set({ deletedAt: now, anonymizedAt: now })
        .where(eq(people.id, party.bookings[0].personId));
      locked();
      await blockedErasure;
      await tx
        .update(bookings)
        .set({ flySafeRecipientSealed: null })
        .where(eq(bookings.id, bookingId));
    });
    await enteredErasure;
    try {
      await recordFlySafeTold(pg.connect(), {
        shopId: shop.id,
        bookingId,
        hours: 24,
        recipientEmail: "late@example.com",
      });
    } finally {
      unlock();
      await erase;
    }
    const [erased] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(erased?.flySafeRecipientSealed).toBeNull();
    await recordFlySafeTold(pg.connect(), {
      shopId: shop.id,
      bookingId,
      hours: 24,
      recipientEmail: "late@example.com",
    });
    const [afterErasure] = await pg.db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(afterErasure?.flySafeRecipientSealed).toBeNull();
  });
});
