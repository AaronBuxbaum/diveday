import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import type { CourtesyProvider } from "@/lib/notifications/courtesy";
import type { SmsProvider } from "@/lib/notifications/sms";
import { fileScopedShopContext } from "@/test/db";
import { fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { bookings, notificationDeliveries, people, trips } from "./schema";
import { sendRescheduleNotices } from "./trip-rescheduled";
import { moveTrip, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

it("forwards bounded timeout signals through the WhatsApp fallback and SMS provider", async () => {
  const { db, shop } = ctx;
  const reef = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((trip) =>
    trip.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!reef) throw new Error("demo reef trip missing");
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, reef.id)));
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Signal Test Diver",
    },
  ]);
  if (!party.ok) throw new Error("booking failed");
  const bookingId = party.bookings[0].bookingId;
  const personId = party.bookings[0].personId;
  await db.update(people).set({ phone: "+13055550142" }).where(eq(people.id, personId));
  await db
    .update(trips)
    .set({ meetingPointLabel: "North Pier", meetingPointAddress: "1 Dock St" })
    .where(eq(trips.id, reef.id));
  const previousStartsAt = reef.startsAt;
  const moved = await moveTrip(
    db,
    shop.id,
    reef.id,
    new Date(reef.startsAt.getTime() + 24 * 60 * 60_000),
  );
  if (!moved.ok) throw new Error("move failed");
  const now = new Date(previousStartsAt.getTime() - 5 * 24 * 60 * 60_000);

  const sms = fakeSms();
  let smsSignal: AbortSignal | undefined;
  const smsProvider: SmsProvider = {
    async send(message, options) {
      smsSignal = options?.signal;
      return sms.provider.send(message, options);
    },
  };
  let whatsAppSignal: AbortSignal | undefined;
  const whatsApp: CourtesyProvider = {
    async send(_message, options) {
      whatsAppSignal = options?.signal;
      return { status: "failed", retryable: false, errorCode: "unavailable" };
    },
  };
  await sendRescheduleNotices(
    db,
    shop.id,
    {
      kind: "trip_rescheduled",
      tripId: reef.id,
      previousStartsAt: previousStartsAt.toISOString(),
      meetingPointMoved: true,
    },
    {
      now,
      smsProvider,
      whatsAppProviders: new Map([[shop.id, whatsApp]]),
      appOrigin: "https://diveday.example",
    },
  );

  expect(whatsAppSignal).toBeInstanceOf(AbortSignal);
  expect(whatsAppSignal?.aborted).toBe(false);
  expect(smsSignal).toBeInstanceOf(AbortSignal);
  expect(smsSignal?.aborted).toBe(false);
  const text = sms.sent.find((message) => message.to === "+13055550142");
  expect(text?.body).toContain(`${shop.name}: we moved ${reef.title} to`);
  expect(text?.body).toContain("Meet at North Pier, 1 Dock St.");
  expect(text?.body).toMatch(/Your trip prep: https:\/\/diveday\.example\/ready\//);
  const [delivery] = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.bookingId, bookingId),
        eq(notificationDeliveries.kind, "trip_rescheduled"),
      ),
    );
  expect(delivery?.status).toBe("sent");
  expect(now.getTime()).toBeLessThan(moved.trip.startsAt.getTime());
});
