import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty, moveBooking } from "../../db/bookings";
import { notificationDeliveries } from "../../db/schema/index";
import { createTrip, moveTrip, upcomingTripsWithCounts } from "../../db/trips";
import { fileScopedShopContext } from "../../test/db";
import { fakeEmail, fakeSms } from "../../test/fakes";
import { sendDueReminders } from "./store";

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

  // Issue #2554: a staff seat move keeps the booking row, so the reminder the
  // diver got for the old departure must not stand for the new one.
  it("a moved seat earns the reminder for its new departure, and the old one stays on record", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const from = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
    if (!from) throw new Error("demo reef trip missing");
    const to = await createTrip(db, {
      shopId: shop.id,
      title: "Two-Tank Reef — moved seat target",
      startsAt: new Date(from.startsAt.getTime() + 9 * DAY),
      endsAt: new Date(from.startsAt.getTime() + 9 * DAY + 4 * HOUR),
      capacity: 6,
      plannedDives: 2,
      priceCents: 12_000,
    });
    if (!to) throw new Error("target trip failed");
    const party = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: from.id,
        fullName: "Mo Mover",
        email: "reminders-seat-move@example.com",
      },
    ]);
    if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
    const { bookingId } = party.bookings[0];
    const emails = fakeEmail();
    const send = (now: Date) =>
      sendDueReminders(db, {
        now,
        emailProvider: emails.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: null,
      });

    await send(new Date(from.startsAt.getTime() - 20 * HOUR));
    const sentToSeat = () =>
      emails.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId).length;
    expect(sentToSeat()).toBe(1);
    const moved = await moveBooking(db, {
      shopId: shop.id,
      fromTripId: from.id,
      toTripId: to.id,
      bookingId,
    });
    expect(moved.ok).toBe(true);
    // The old departure's window is long past; only the new one is due.
    await send(new Date(to.startsAt.getTime() - 20 * HOUR));

    expect(sentToSeat()).toBe(2);
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
