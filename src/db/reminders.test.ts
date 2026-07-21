// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import type { SmsDelivery, SmsMessage, SmsProvider } from "@/lib/notifications/sms";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { sendDueReminders } from "./reminders";
import { notificationDeliveries, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// The seeded shop already has bookings on several future trips, so
// sendDueReminders (a global cron) touches more than the one under test. Every
// assertion here filters to this test's booking, phone, or delivery rows.

function fakeEmail(result: NotificationDelivery = { status: "sent", providerMessageId: "em_1" }) {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return result;
    },
  };
  return { sent, provider };
}

function fakeSms(result: SmsDelivery = { status: "sent", providerMessageId: "SM_1" }) {
  const sent: SmsMessage[] = [];
  const provider: SmsProvider = {
    async send(message) {
      sent.push(message);
      return result;
    },
  };
  return { sent, provider };
}

const PHONE = "+13055559999";

async function reminderContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { shopId: shop.id, tripId: reef.id, fullName: "Pat Party", email: "reminders-pat@example.com" },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.email, "reminders-pat@example.com"));
  // 100h out lands in the 7-day bucket (T-168h .. T-24h).
  const inWeekBucket = new Date(reef.startsAt.getTime() - 100 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, personId: person.id, inWeekBucket };
}

function rowsFor(db: Awaited<ReturnType<typeof reminderContext>>["db"], bookingId: string) {
  return db
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.bookingId, bookingId));
}

const emailsFor = (email: ReturnType<typeof fakeEmail>, bookingId: string) =>
  email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);

describe("sendDueReminders", () => {
  it("emails the due 7-day reminder, records it, and is a no-op on a second run", async () => {
    const { db, bookingId, inWeekBucket } = await reminderContext();
    const email = fakeEmail();
    const sms = fakeSms();
    const opts = {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: null,
    };

    await sendDueReminders(db, opts);
    expect(emailsFor(email, bookingId)).toHaveLength(1);
    expect(emailsFor(email, bookingId)[0].kind).toBe("trip_reminder_7d");
    const rows = await rowsFor(db, bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "trip_reminder_7d", status: "sent" });

    // Dedup: the delivery row already exists, so this booking never re-sends.
    await sendDueReminders(db, opts);
    expect(emailsFor(email, bookingId)).toHaveLength(1);
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });

  it("sends nothing for a booking before any cadence opens", async () => {
    const { db, bookingId, reef } = await reminderContext();
    const email = fakeEmail();
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 300 * 60 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)).toHaveLength(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("adds a courtesy SMS when the diver has a textable phone and email sent", async () => {
    const { db, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ phone: PHONE }).where(eq(people.id, personId));
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    const mine = sms.sent.filter((m) => m.to === PHONE);
    expect(mine).toHaveLength(1);
    expect(mine[0].channel).toBe("sms");
  });

  it("tracks a phone-only diver from the SMS result, not email", async () => {
    const { db, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ email: null, phone: PHONE }).where(eq(people.id, personId));
    const email = fakeEmail();
    const sms = fakeSms({ status: "sent", providerMessageId: "SM_only" });

    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: email.provider,
      smsProvider: sms.provider,
      appOrigin: null,
    });
    expect(emailsFor(email, bookingId)).toHaveLength(0);
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "SM_only" });
  });

  it("records not_configured for a booking with no reachable channel", async () => {
    const { db, bookingId, inWeekBucket } = await reminderContext();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail({ status: "not_configured" }).provider,
      smsProvider: fakeSms({ status: "not_configured" }).provider,
      appOrigin: null,
    });
    const rows = await rowsFor(db, bookingId);
    expect(rows[0].status).toBe("not_configured");
  });
});
