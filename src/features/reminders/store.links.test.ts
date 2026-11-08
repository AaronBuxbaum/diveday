import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createBookingParty } from "../../db/bookings";
import { bookingCapabilities, bookings, people, trips } from "../../db/schema/index";
import { recordSmsKeyword } from "../../db/sms-opt-outs";
import { upcomingTripsWithCounts } from "../../db/trips";
import { fileScopedShopContext } from "../../test/db";
import { fakeEmail, fakeSms } from "../../test/fakes";
import { sendDueReminders } from "./store";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`). The cron touches every booking
// the seed holds, so every assertion filters to this test's booking and phone.
const ctx = fileScopedShopContext();

const PHONE = "+13055559999";
const ORIGIN = "https://diveday.example";

async function reminderContext() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
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
  const bookingId = party.bookings[0].bookingId;
  const [person] = await db
    .select()
    .from(people)
    .where(eq(people.email, "reminders-pat@example.com"));
  // 100h out lands in the 7-day bucket (T-168h .. T-24h).
  const inWeekBucket = new Date(reef.startsAt.getTime() - 100 * 60 * 60 * 1000);
  return { db, shop, reef, bookingId, personId: person.id, inWeekBucket };
}

const emailsFor = (email: ReturnType<typeof fakeEmail>, bookingId: string) =>
  email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);

/**
 * Issue #2451 minted nothing for a reminder that cannot go. Since #2711 the
 * link a reminder carries is the booking's one live delivered link, so a send
 * that fails takes nothing back: the diver may hold that link already.
 */
describe("the trip-prep link on a reminder that does not go", () => {
  const capabilitiesFor = (
    db: Awaited<ReturnType<typeof reminderContext>>["db"],
    bookingId: string,
  ) => db.select().from(bookingCapabilities).where(eq(bookingCapabilities.bookingId, bookingId));

  it("mints nothing for a phone-only diver on the STOP list", async () => {
    const { db, bookingId, personId, inWeekBucket } = await reminderContext();
    await db.update(people).set({ email: null, phone: PHONE }).where(eq(people.id, personId));
    await recordSmsKeyword(db, { phone: PHONE, optedOut: true, keywordAt: inWeekBucket });
    const sms = fakeSms();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      appOrigin: ORIGIN,
    });
    expect(sms.sent.filter((m) => m.to === PHONE)).toHaveLength(0);
    expect(await capabilitiesFor(db, bookingId)).toEqual([]);
  });

  it("leaves the link live when the email bounces, and the next send carries that same link", async () => {
    const bounced = await reminderContext();
    await sendDueReminders(bounced.db, {
      now: bounced.inWeekBucket,
      emailProvider: fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" })
        .provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    // One live delivered row: the booking's link, which an earlier mail may
    // already have carried (issue #2711). Nothing is taken back.
    const kept = (await capabilitiesFor(bounced.db, bounced.bookingId)).filter(
      (row) => row.revokedAt === null,
    );
    expect(kept).toHaveLength(1);

    const email = fakeEmail();
    await sendDueReminders(bounced.db, {
      now: bounced.inWeekBucket,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    const [mail] = emailsFor(email, bounced.bookingId);
    if (mail.kind !== "trip_reminder_7d") throw new Error(`unexpected ${mail.kind}`);
    const live = (await capabilitiesFor(bounced.db, bounced.bookingId)).filter(
      (row) => row.revokedAt === null,
    );
    expect(live.map((row) => row.id)).toEqual(kept.map((row) => row.id));
    expect(mail.readinessUrl).toMatch(/\/ready\/c1\./);
  });

  it("never revokes the link a diver already holds when a later reminder fails", async () => {
    const { db, bookingId, inWeekBucket } = await reminderContext();
    await sendDueReminders(db, {
      now: inWeekBucket,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    const delivered = (await capabilitiesFor(db, bookingId)).filter(
      (row) => row.revokedAt === null,
    );
    expect(delivered).toHaveLength(1);

    // The night-before reminder bounces: the 7-day link in the diver's inbox stays live.
    const [trip] = await db
      .select({ startsAt: trips.startsAt })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(eq(bookings.id, bookingId));
    await sendDueReminders(db, {
      now: new Date(trip.startsAt.getTime() - 30 * 60 * 60 * 1000),
      emailProvider: fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" })
        .provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    const after = await capabilitiesFor(db, bookingId);
    expect(after.filter((row) => row.revokedAt === null).map((row) => row.id)).toEqual(
      delivered.map((row) => row.id),
    );
  });
});
