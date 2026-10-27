import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
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
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now: after })).toContainEqual({
      ...expected,
      status: "queued",
    });
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
    expect(await listShopFlySafeFollowUps(db, { shopId: shop.id, now: after })).toContainEqual({
      ...expected,
      status: "follow_up",
    });
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
});
