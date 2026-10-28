import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail, fakeSms } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { bookings, notificationDeliveries, people, trips } from "./schema";
import { sendRescheduleNotices } from "./trip-rescheduled";
import { moveTrip, upcomingTripsWithCounts } from "./trips";

const ORIGIN = "https://diveday.example";
const ctx = fileScopedShopContext();

async function movedTrip() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.tripId, reef.id), eq(bookings.shopId, shop.id)));
  const party = await createBookingParty(db, [
    {
      actor: "public",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Priya Shah",
      email: "reschedule-priya@example.com",
    },
    {
      actor: "public",
      shopId: shop.id,
      tripId: reef.id,
      fullName: "Sam Shah",
      email: "reschedule-sam@example.com",
    },
    { actor: "public", shopId: shop.id, tripId: reef.id, fullName: "Kid Shah" },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [priya, sam, kid] = party.bookings.map((booking) => booking.bookingId);
  const previousStartsAt = reef.startsAt;
  const moved = await moveTrip(
    db,
    shop.id,
    reef.id,
    new Date(reef.startsAt.getTime() + 24 * 60 * 60 * 1000),
  );
  if (!moved.ok) throw new Error("move failed");
  const now = new Date(previousStartsAt.getTime() - 5 * 24 * 60 * 60 * 1000);
  return { db, shop, reef, priya, sam, kid, previousStartsAt, moved: moved.trip, now };
}

function providers() {
  const email = fakeEmail();
  const sms = fakeSms();
  return {
    email,
    sms,
    options: {
      emailProvider: email.provider,
      smsProvider: sms.provider,
      whatsAppProviders: new Map(),
      appOrigin: ORIGIN,
    },
  };
}

async function deliveriesFor(bookingIds: string[]) {
  return ctx.db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        inArray(notificationDeliveries.bookingId, bookingIds),
        eq(notificationDeliveries.kind, "trip_rescheduled"),
      ),
    );
}

describe("reschedule copy without per-seat delivery history", () => {
  it("shows only the new schedule across sent, failed and unconfigured recipients", async () => {
    const { db, shop, reef, priya, sam, kid, previousStartsAt, now } = await movedTrip();
    const attempted: Notification[] = [];
    const email = fakeEmail(
      { status: "sent", providerMessageId: "em_partial" },
      {
        async send(notification) {
          attempted.push(notification);
          return "to" in notification && notification.to === "reschedule-sam@example.com"
            ? { status: "failed", retryable: false, errorCode: "rejected" }
            : { status: "sent", providerMessageId: "em_partial" };
        },
      },
    );
    const outcome = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      {
        emailProvider: email.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: ORIGIN,
        now,
      },
    );
    expect(outcome).toEqual({ told: 1, failed: 2, identityHeld: 0 });
    const delivered = attempted.find(
      (notification) =>
        notification.kind === "trip_rescheduled" && notification.bookingId === priya,
    );
    if (delivered?.kind !== "trip_rescheduled") throw new Error("delivered notice missing");
    const { messageFor } = await import("@/lib/notifications/render");
    const copy = messageFor(delivered);
    expect(copy.text).not.toContain("It was");
    expect(copy.text).not.toContain("Jul 31");
    expect(copy.text).toContain(reef.title);
    expect((await deliveriesFor([priya, sam])).map((row) => row.status).sort()).toEqual([
      "failed",
      "sent",
    ]);
    expect((await deliveriesFor([kid])).map((row) => row.status)).toEqual(["not_configured"]);
  });

  it("does not put a previous schedule in a reschedule text", async () => {
    const { db, shop, reef, kid, previousStartsAt, now } = await movedTrip();
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, kid));
    await db.update(people).set({ phone: "+13055550143" }).where(eq(people.id, booking.personId));
    const { sms, options } = providers();
    await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      { ...options, now },
    );
    const text = sms.sent.find((message) => message.to === "+13055550143")?.body;
    expect(text).toContain(reef.title);
    expect(text).not.toContain("Before");
    expect(text).not.toContain("Jul 31");
  });

  it("states the current schedule in a place update after mixed earlier delivery", async () => {
    const { db, shop, reef, priya, sam, previousStartsAt, moved, now } = await movedTrip();
    const partial = fakeEmail(
      { status: "sent", providerMessageId: "em_partial" },
      {
        async send(notification) {
          return "to" in notification && notification.to === "reschedule-sam@example.com"
            ? { status: "failed", retryable: false, errorCode: "rejected" }
            : { status: "sent", providerMessageId: "em_partial" };
        },
      },
    );
    const first = await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: previousStartsAt.toISOString(),
        meetingPointMoved: false,
      },
      {
        emailProvider: partial.provider,
        smsProvider: fakeSms().provider,
        whatsAppProviders: new Map(),
        appOrigin: ORIGIN,
        now,
      },
    );
    expect(first.told).toBe(1);
    expect(first.failed).toBe(2);
    expect(
      Object.fromEntries(
        (await deliveriesFor([priya, sam])).map((row) => [row.bookingId, row.status]),
      ),
    ).toEqual({ [priya]: "sent", [sam]: "failed" });
    await db
      .update(trips)
      .set({ meetingPointLabel: "North Pier", meetingPointAddress: "1 Dock St" })
      .where(eq(trips.id, reef.id));
    const { email, options } = providers();
    await sendRescheduleNotices(
      db,
      shop.id,
      {
        kind: "trip_rescheduled",
        tripId: reef.id,
        previousStartsAt: moved.startsAt.toISOString(),
        meetingPointMoved: true,
      },
      { ...options, now },
    );
    const { messageFor } = await import("@/lib/notifications/render");
    for (const bookingId of [priya, sam]) {
      const notice = email.sent.find(
        (notification) =>
          notification.kind === "trip_rescheduled" && notification.bookingId === bookingId,
      );
      if (notice?.kind !== "trip_rescheduled") throw new Error("place update missing");
      const copy = messageFor(notice);
      expect(copy.text).toContain("Here is the current schedule.");
      expect(copy.text).toMatch(/\n(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), .+\n\d{1,2}:\d{2}\s+[AP]M/);
      expect(copy.text).toContain("North Pier");
      expect(copy.text).not.toContain("The time is the same");
    }
  });
});
