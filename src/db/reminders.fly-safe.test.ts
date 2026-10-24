import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBookingParty } from "./bookings";
import { sendDueReminders } from "./reminders";
import { bookings, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

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
  return { db, shop, reef, bookingId: party.bookings[0].bookingId, inWeekBucket };
}

const emailsFor = (email: ReturnType<typeof fakeEmail>, bookingId: string) =>
  email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);

describe("sendDueReminders and the fly-safe hours", () => {
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
