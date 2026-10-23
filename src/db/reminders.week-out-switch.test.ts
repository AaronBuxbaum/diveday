import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { sendDueReminders } from "./reminders";
import { notificationDeliveries, shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// The week-out reminder is a Features switch; the night-before one is safety
// and always sends (ADR 20261005-optional-shop-features, amendment 2026-10-23).

const ctx = fileScopedShopContext();
const HOUR = 60 * 60 * 1000;

async function bookedSeat() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    {
      actor: "staff",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Wes Weekout",
      email: "week-out-switch@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return { db, shop, reef, bookingId: party.bookings[0].bookingId };
}

describe("the week-out reminder switch", () => {
  it("sends no 7-day reminder while off, writes nothing, and still sends the day-before one", async () => {
    const { db, shop, reef, bookingId } = await bookedSeat();
    await db.update(shops).set({ weekOutReminderEnabled: false }).where(eq(shops.id, shop.id));
    const email = fakeEmail();
    const opts = { emailProvider: email.provider, smsProvider: fakeSms().provider, appOrigin: null };
    const mine = () =>
      email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId).map((n) => n.kind);

    await sendDueReminders(db, { ...opts, now: new Date(reef.startsAt.getTime() - 100 * HOUR) });
    expect(mine()).toEqual([]);
    expect(
      await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.bookingId, bookingId)),
    ).toHaveLength(0);

    await sendDueReminders(db, { ...opts, now: new Date(reef.startsAt.getTime() - 20 * HOUR) });
    expect(mine()).toEqual(["trip_reminder_24h"]);
  });

  it("sends the 7-day reminder while on", async () => {
    const { db, reef, bookingId } = await bookedSeat();
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 100 * HOUR),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    expect(
      email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId).map((n) => n.kind),
    ).toEqual(["trip_reminder_7d"]);
  });
});
