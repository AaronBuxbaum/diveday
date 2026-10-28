import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import {
  listFlySafeFollowUps,
  recordFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { drainNotificationRetries } from "./notifications";
import { bookings, people, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

async function setupToldSeat(email: string) {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { actor: "staff", shopId: shop.id, tripId: reef.id, fullName: "Pat Party", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  await recordFlySafeTold(db, { shopId: shop.id, bookingId, hours: 24, recipientEmail: email });
  return { db, shop, reef, bookingId };
}

describe("queued fly-safe recipient binding", () => {
  it("retries the recorded recipient after the diver changes their current email", async () => {
    const email = "flysafe-pat@example.com";
    const { db, shop, reef, bookingId } = await setupToldSeat(email);
    await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, reef.id));
    const now = new Date(reef.startsAt.getTime() - HOUR_MS);
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: fakeEmail({ status: "failed", retryable: true }).provider,
    });
    const [booking] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    if (!booking) throw new Error("booking missing");
    await db
      .update(people)
      .set({ email: "new-address@example.com" })
      .where(eq(people.id, booking.personId));

    const retry = fakeEmail({ status: "failed", retryable: false });
    const summary = await drainNotificationRetries(db, { now, provider: retry.provider });

    expect(summary).toMatchObject({ scanned: 1, failed: 1 });
    expect(retry.sent).toHaveLength(1);
    expect(retry.sent[0]).toMatchObject({
      kind: "fly_safe_correction",
      to: email,
      seatId: bookingId,
    });
    expect(await listFlySafeFollowUps(db, { shopId: shop.id, tripId: reef.id, now })).toEqual([
      { bookingId, name: "Pat Party", status: "follow_up" },
    ]);
  });
});
