import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { listShopFlySafeFollowUps, sendFlySafeCorrections } from "./fly-safe-correction";
import { openFlySafeExposures } from "./fly-safe-exposures";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { sendDueReminders } from "./reminders";
import { bookings, notificationSendQueue, people, trips } from "./schema";
import { createTrip, upcomingTripsWithCounts } from "./trips";

/**
 * **The night-before email says when it's safe to fly** (ux-delight sheet
 * 2026-10-22, item 1; H-150): the sender hands the renderer the fly-safe
 * hours only on the reminder before a diver's last boat with the shop. The
 * rule itself is `readReminderFlySafeHours`'s (`fly-safe-plan.test.ts`); the
 * words are `diver-state-email.test.ts`'s.
 */

// One seeded database for the file and a rolled-back transaction per test.
const ctx = fileScopedShopContext();

async function reminderContext() {
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
      email: "reminders-pat@example.com",
    },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.email, "reminders-pat@example.com"));
  if (!person) throw new Error("booked person missing");
  // 100h out lands in the 7-day bucket (T-168h .. T-24h).
  const inWeekBucket = new Date(reef.startsAt.getTime() - 100 * 60 * 60 * 1000);
  return {
    db,
    shop,
    reef,
    personId: person.id,
    bookingId: party.bookings[0].bookingId,
    inWeekBucket,
  };
}

const emailsFor = (email: ReturnType<typeof fakeEmail>, bookingId: string) =>
  email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);

describe("sendDueReminders and the fly-safe hours", () => {
  it("replaces an unproven queued reminder figure with crew guidance", async () => {
    const { db, shop, reef, bookingId } = await reminderContext();
    const notification: Notification = {
      kind: "trip_reminder_24h",
      bookingId,
      shopId: shop.id,
      to: "reminders-pat@example.com",
      locale: "en-US",
      shopName: shop.name,
      tripTitle: reef.title,
      startsAt: reef.startsAt,
      timezone: shop.timezone,
      open: 0,
      flySafeHours: 24,
    };
    const rejected = fakeEmail({ status: "failed", retryable: true, errorCode: "temporary" });
    await sendNotification(db, notification, rejected.provider);
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    const retried = fakeEmail();
    await drainNotificationRetries(db, { provider: retried.provider });
    expect(retried.sent).toHaveLength(1);
    expect(retried.sent[0]).toMatchObject({ kind: "trip_reminder_24h", flySafeAskCrew: true });
    expect(retried.sent[0]).not.toHaveProperty("flySafeHours");
  });

  it("reconstructs a verified queued recommendation and corrects a change during retry", async () => {
    const { db, shop, reef, bookingId, personId } = await reminderContext();
    const notification: Notification = {
      kind: "trip_reminder_24h",
      bookingId,
      shopId: shop.id,
      tripId: reef.id,
      personId,
      to: "reminders-pat@example.com",
      locale: "en-US",
      shopName: shop.name,
      tripTitle: reef.title,
      startsAt: reef.startsAt,
      timezone: shop.timezone,
      open: 0,
      flySafeHours: 24,
    };
    const rejected = fakeEmail({ status: "failed", retryable: true, errorCode: "temporary" });
    await sendNotification(db, notification, rejected.provider);
    await db.update(trips).set({ plannedDives: 1 }).where(eq(trips.id, reef.id));
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    const seen: Notification[] = [];
    const provider: NotificationProvider = {
      async send(value) {
        seen.push(value);
        if (value.kind === "trip_reminder_24h") {
          await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, reef.id));
        }
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await drainNotificationRetries(db, {
      provider,
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
    });
    expect(seen[0]).toMatchObject({ kind: "trip_reminder_24h", flySafeHours: 18 });
    expect(seen[1]).toMatchObject({ kind: "fly_safe_correction", seatId: bookingId });
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.flySafeHoursTold).toBe(18);
  });

  it("recomputes the multi-day wait on a verified retry", async () => {
    const { db, shop, reef, bookingId, personId } = await reminderContext();
    await db.update(trips).set({ plannedDives: 1 }).where(eq(trips.id, reef.id));
    const notification: Notification = {
      kind: "trip_reminder_24h",
      bookingId,
      shopId: shop.id,
      tripId: reef.id,
      personId,
      to: "reminders-pat@example.com",
      locale: "en-US",
      shopName: shop.name,
      tripTitle: reef.title,
      startsAt: reef.startsAt,
      timezone: shop.timezone,
      open: 0,
      flySafeHours: 18,
    };
    await sendNotification(
      db,
      notification,
      fakeEmail({ status: "failed", retryable: true }).provider,
    );
    const earlierStart = new Date(reef.startsAt.getTime() + 24 * 60 * 60 * 1000);
    const earlier = await createTrip(db, {
      shopId: shop.id,
      title: "Earlier dive",
      startsAt: earlierStart,
      endsAt: new Date(earlierStart.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!earlier) throw new Error("earlier departure missing");
    const seat = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: earlier.id,
        fullName: "Pat Party",
        email: "reminders-pat@example.com",
      },
    ]);
    if (!seat.ok) throw new Error(`earlier seat missing: ${seat.reason}`);
    await db
      .update(trips)
      .set({
        startsAt: new Date(reef.startsAt.getTime() - 24 * 60 * 60 * 1000),
        endsAt: new Date(reef.startsAt.getTime() - 20 * 60 * 60 * 1000),
      })
      .where(eq(trips.id, earlier.id));
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    const retried = fakeEmail();
    await drainNotificationRetries(db, { provider: retried.provider });
    expect(retried.sent[0]).toMatchObject({ flySafeHours: 24 });
  });

  it("does not reuse a departure's figure after its booking moves", async () => {
    const { db, shop, reef, bookingId, personId } = await reminderContext();
    const notification: Notification = {
      kind: "trip_reminder_24h",
      bookingId,
      shopId: shop.id,
      tripId: reef.id,
      personId,
      to: "reminders-pat@example.com",
      locale: "en-US",
      shopName: shop.name,
      tripTitle: reef.title,
      startsAt: reef.startsAt,
      timezone: shop.timezone,
      open: 0,
      flySafeHours: 24,
    };
    await sendNotification(
      db,
      notification,
      fakeEmail({ status: "failed", retryable: true }).provider,
    );
    const destination = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find(
      (t) => t.id !== reef.id && t.status === "scheduled",
    );
    if (!destination) throw new Error("destination missing");
    await db.update(bookings).set({ tripId: destination.id }).where(eq(bookings.id, bookingId));
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    const retried = fakeEmail();
    await drainNotificationRetries(db, { provider: retried.provider });
    expect(retried.sent[0]).toMatchObject({ flySafeAskCrew: true });
    expect(retried.sent[0]).not.toHaveProperty("flySafeHours");
  });

  it("records the potential numeric exposure before the provider can accept it", async () => {
    const { db, shop, reef, bookingId } = await reminderContext();
    let recordedBeforeSend = false;
    const provider: NotificationProvider = {
      async send(value) {
        if (
          value.kind === "trip_reminder_24h" &&
          value.bookingId === bookingId &&
          value.flySafeHours !== undefined
        ) {
          const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
          const entries = seat?.flySafeRecipientSealed
            ? openFlySafeExposures(seat.flySafeRecipientSealed, shop.id, bookingId)
            : null;
          recordedBeforeSend = entries?.some((entry) => !entry.accepted) ?? false;
        }
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      emailProvider: provider,
      appOrigin: null,
    });
    expect(recordedBeforeSend).toBe(true);
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const entries = seat?.flySafeRecipientSealed
      ? openFlySafeExposures(seat.flySafeRecipientSealed, shop.id, bookingId)
      : null;
    expect(entries?.some((entry) => entry.accepted)).toBe(true);
  });

  it("does not attach the original address to a different person after an in-flight reassignment", async () => {
    const { db, shop, reef, bookingId } = await reminderContext();
    const [other] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Other Diver", email: "other-diver@example.com" })
      .returning();
    if (!other) throw new Error("other person missing");
    const provider: NotificationProvider = {
      async send(value) {
        if (value.kind === "trip_reminder_24h" && value.bookingId === bookingId) {
          await db.update(bookings).set({ personId: other.id }).where(eq(bookings.id, bookingId));
          await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, reef.id));
        }
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      emailProvider: provider,
      appOrigin: null,
    });
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.flySafeRecipientSealed).toBeNull();
    expect(seat?.flySafeRecipientUnknown).toBe(true);
  });

  it("corrects the reminder's actual recipient after the person changes their email", async () => {
    const { db, shop, reef, bookingId, personId } = await reminderContext();
    const now = new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000);
    await sendDueReminders(db, { now, emailProvider: fakeEmail().provider, appOrigin: null });
    await db
      .update(people)
      .set({ email: "new-address@example.com" })
      .where(eq(people.id, personId));
    await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, reef.id));
    const correction = fakeEmail();
    await sendFlySafeCorrections(db, {
      shopId: shop.id,
      tripId: reef.id,
      now,
      emailProvider: correction.provider,
    });
    expect(correction.sent).toMatchObject([
      { kind: "fly_safe_correction", seatId: bookingId, to: "reminders-pat@example.com" },
    ]);
  });

  it("corrects the later reminder when an earlier dive becomes decompression during delivery", async () => {
    const { db, shop, reef, bookingId } = await reminderContext();
    const earlierStart = new Date(reef.startsAt.getTime() + 24 * 60 * 60 * 1000);
    const earlier = await createTrip(db, {
      shopId: shop.id,
      title: "Earlier dive",
      startsAt: earlierStart,
      endsAt: new Date(earlierStart.getTime() + 4 * 60 * 60 * 1000),
      capacity: 6,
      plannedDives: 1,
    });
    if (!earlier) throw new Error("earlier trip missing");
    const seat = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: earlier.id,
        fullName: "Pat Party",
        email: "reminders-pat@example.com",
      },
    ]);
    if (!seat.ok) throw new Error(`earlier seat missing: ${seat.reason}`);
    await db
      .update(trips)
      .set({
        startsAt: new Date(reef.startsAt.getTime() - 24 * 60 * 60 * 1000),
        endsAt: new Date(reef.startsAt.getTime() - 20 * 60 * 60 * 1000),
      })
      .where(eq(trips.id, earlier.id));
    const seen: Notification[] = [];
    const provider: NotificationProvider = {
      async send(value) {
        seen.push(value);
        if (value.kind === "trip_reminder_24h" && value.bookingId === bookingId)
          await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, earlier.id));
        if (value.kind === "fly_safe_correction") return { status: "failed", retryable: true };
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      emailProvider: provider,
      appOrigin: null,
    });
    expect(seen.some((n) => n.kind === "fly_safe_correction" && n.seatId === bookingId)).toBe(true);
    expect(
      await listShopFlySafeFollowUps(db, {
        shopId: shop.id,
        now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      }),
    ).toContainEqual({
      bookingId,
      name: "Pat Party",
      status: "queued",
      tripId: reef.id,
      tripTitle: reef.title,
    });
  });

  it("corrects a figure when the trip becomes decompression during provider delivery", async () => {
    const { db, reef, bookingId } = await reminderContext();
    const seen: Notification[] = [];
    const provider: NotificationProvider = {
      async send(notification) {
        seen.push(notification);
        if (notification.kind === "trip_reminder_24h" && notification.bookingId === bookingId) {
          await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, reef.id));
        }
        return { status: "sent", providerMessageId: "accepted" };
      },
    };
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      emailProvider: provider,
      appOrigin: null,
    });
    const reminder = seen.find(
      (item) => item.kind === "trip_reminder_24h" && item.bookingId === bookingId,
    );
    expect(reminder).toMatchObject({ kind: "trip_reminder_24h", bookingId });
    if (reminder?.kind !== "trip_reminder_24h") throw new Error("reminder missing");
    expect(reminder.flySafeHours).toBeDefined();
    const correction = seen.find(
      (item) => item.kind === "fly_safe_correction" && item.seatId === bookingId,
    );
    if (!correction) throw new Error("correction missing");
    expect(seen.indexOf(correction)).toBeGreaterThan(seen.indexOf(reminder));
  });

  it("gives the night-before email the fly-safe hours on the diver's last boat, and only then", async () => {
    const { db, reef, bookingId, inWeekBucket } = await reminderContext();
    const dayNow = new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000);
    const week = fakeEmail();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: week.provider,
      appOrigin: null,
    });
    const [nudge] = emailsFor(week, bookingId);
    expect(nudge.kind).toBe("trip_reminder_7d");
    expect("flySafeHours" in nudge).toBe(false);

    const day = fakeEmail();
    await sendDueReminders(db, { now: dayNow, emailProvider: day.provider, appOrigin: null });
    const [reminder] = emailsFor(day, bookingId);
    expect(reminder.kind).toBe("trip_reminder_24h");
    if (reminder.kind !== "trip_reminder_24h") return;
    expect([18, 24]).toContain(reminder.flySafeHours);
    // The seat remembers the figure it was told, for a later correction (#2927).
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.flySafeHoursTold).toBe(reminder.flySafeHours);
  });

  it("remembers no figure when the night-before email did not go (#2927)", async () => {
    const { db, reef, bookingId } = await reminderContext();
    const refused = fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" });
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      emailProvider: refused.provider,
      appOrigin: null,
    });
    const [reminder] = emailsFor(refused, bookingId);
    expect(reminder?.kind).toBe("trip_reminder_24h");
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.flySafeHoursTold).toBeNull();
  });

  it("leaves the fly-safe hours off when the diver has another boat after this one", async () => {
    const { db, shop, reef, bookingId } = await reminderContext();
    const later = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find(
      (trip) => trip.startsAt.getTime() > reef.startsAt.getTime() && trip.status === "scheduled",
    );
    if (!later) throw new Error("no later demo departure");
    const again = await createBookingParty(db, [
      {
        actor: "staff",
        shopId: shop.id,
        tripId: later.id,
        fullName: "Pat Party",
        email: "reminders-pat@example.com",
      },
    ]);
    if (!again.ok) throw new Error(`booking failed: ${again.reason}`);
    const day = fakeEmail();
    await sendDueReminders(db, {
      now: new Date(reef.startsAt.getTime() - 6 * 60 * 60 * 1000),
      emailProvider: day.provider,
      appOrigin: null,
    });
    const [reminder] = emailsFor(day, bookingId);
    expect(reminder.kind).toBe("trip_reminder_24h");
    expect("flySafeHours" in reminder).toBe(false);
    const [seat] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    expect(seat?.flySafeHoursTold).toBeNull();
  });
});
