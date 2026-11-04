import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { sendDueReminders } from "./reminders";
import { notificationDeliveries } from "./schema";
import { moveTrip, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Issue #3705: a moved departure keeps the old date's reminder as the record
// the diver was told, stamped superseded, beside the live one for the new date.
describe("a moved departure's superseded reminder", () => {
  it("keeps both sends on record: the old date's superseded, the new live", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: reef.id,
        fullName: "Pat Party",
        email: "reminders-superseded@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const { bookingId } = party.bookings[0];
    const send = (now: Date) =>
      sendDueReminders(db, {
        now,
        emailProvider: fakeEmail().provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: null,
      });

    const nightBefore = new Date(reef.startsAt.getTime() - 20 * HOUR);
    await send(nightBefore);
    const moved = await moveTrip(
      db,
      shop.id,
      reef.id,
      new Date(reef.startsAt.getTime() + 2 * DAY),
      {
        now: nightBefore,
      },
    );
    expect(moved.ok).toBe(true);
    await send(new Date(nightBefore.getTime() + 2 * DAY));

    const rows = (
      await db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.bookingId, bookingId))
    ).sort((a, b) => a.attemptedAt.getTime() - b.attemptedAt.getTime());
    expect(rows.map((row) => [row.kind, row.status, row.supersededAt !== null])).toEqual([
      ["trip_reminder_24h", "sent", true],
      ["trip_reminder_24h", "sent", false],
    ]);
  });
});
