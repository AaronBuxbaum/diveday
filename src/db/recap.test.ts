// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import type { SmsDelivery, SmsMessage, SmsProvider } from "@/lib/notifications/sms";
import { seededShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { getRecapPageData, sendDueRecaps } from "./recap";
import { bookings, notificationDeliveries, people } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

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

const ORIGIN = "https://diveday.test";

async function recapContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = trips.find((t) => t.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const party = await createBookingParty(db, [
    { shopId: shop.id, tripId: reef.id, fullName: "Rae Recap", email: "recap-rae@example.com" },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const bookingId = party.bookings[0].bookingId;
  // An hour after the reef trip ends lands inside the recap lookback window.
  const afterTrip = new Date(reef.endsAt.getTime() + 60 * 60 * 1000);
  return { db, shop, reef, bookingId, afterTrip };
}

const rowsFor = (db: Awaited<ReturnType<typeof recapContext>>["db"], bookingId: string) =>
  db.select().from(notificationDeliveries).where(eq(notificationDeliveries.bookingId, bookingId));

describe("getRecapPageData", () => {
  it("returns the diver, the sites dived, and the trip for a live booking", async () => {
    const { db, bookingId } = await recapContext();
    const data = await getRecapPageData(db, bookingId);
    expect(data).not.toBeNull();
    if (!data) return;
    expect(data.diverName).toBe("Rae Recap");
    expect(data.trip.title).toContain("Two-Tank Reef");
    expect(data.sites.length).toBeGreaterThan(0);
    // Sites are de-duplicated by name — a two-tank day on one site reads once.
    expect(new Set(data.sites.map((s) => s.name)).size).toBe(data.sites.length);
  });

  it("returns null for a cancelled booking — a cancelled diver never dived", async () => {
    const { db, bookingId } = await recapContext();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, bookingId));
    expect(await getRecapPageData(db, bookingId)).toBeNull();
  });

  it("returns null for an unknown booking", async () => {
    const { db } = await recapContext();
    expect(await getRecapPageData(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("sendDueRecaps", () => {
  it("sends the recap once after departure, records it, and is a no-op on a second run", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const email = fakeEmail();
    const opts = {
      now: afterTrip,
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    };

    await sendDueRecaps(db, opts);
    const mine = email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId);
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe("trip_recap");
    if (mine[0].kind === "trip_recap") {
      expect(mine[0].recapUrl).toContain(`${ORIGIN}/recap/`);
    }
    const rows = await rowsFor(db, bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "trip_recap", status: "sent" });

    await sendDueRecaps(db, opts);
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(1);
    expect(await rowsFor(db, bookingId)).toHaveLength(1);
  });

  it("sends nothing before the trip departs", async () => {
    const { db, reef, bookingId } = await recapContext();
    const email = fakeEmail();
    await sendDueRecaps(db, {
      now: new Date(reef.endsAt.getTime() - 60 * 60 * 1000),
      emailProvider: email.provider,
      smsProvider: fakeSms().provider,
      appOrigin: ORIGIN,
    });
    expect(email.sent.filter((n) => "bookingId" in n && n.bookingId === bookingId)).toHaveLength(0);
    expect(await rowsFor(db, bookingId)).toHaveLength(0);
  });

  it("records not_configured when there is no app origin to build the link", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: fakeSms().provider,
      appOrigin: null,
    });
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]?.status).toBe("not_configured");
  });

  it("texts a phone-only diver the recap link", async () => {
    const { db, bookingId, afterTrip } = await recapContext();
    const [person] = await db
      .select()
      .from(people)
      .where(eq(people.email, "recap-rae@example.com"));
    await db
      .update(people)
      .set({ email: null, phone: "+13055557777" })
      .where(eq(people.id, person.id));
    const sms = fakeSms({ status: "sent", providerMessageId: "SM_recap" });
    await sendDueRecaps(db, {
      now: afterTrip,
      emailProvider: fakeEmail().provider,
      smsProvider: sms.provider,
      appOrigin: ORIGIN,
    });
    const mine = sms.sent.filter((m) => m.to === "+13055557777");
    expect(mine).toHaveLength(1);
    expect(mine[0].body).toContain(`${ORIGIN}/recap/`);
    const rows = await rowsFor(db, bookingId);
    expect(rows[0]).toMatchObject({ status: "sent", providerMessageId: "SM_recap" });
  });
});
