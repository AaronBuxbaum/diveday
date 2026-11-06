import { and, eq, max } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate, nowMs } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { activityEvents, bookings, people, shops } from "./schema";
import { sendSeatSoldAlerts } from "./seat-sold-alerts";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **Tell the desk when a seat sells** (loop 5, row 8): off until a shop turns
 * it on, one batch per pass, the count by departure and never the diver, and a
 * pass that could not send gives its seats back to the next one.
 */
const ctx = fileScopedShopContext();
const ORIGIN = "https://diveday.example";

function recorder(status: "sent" | "failed" = "sent") {
  const sent: Notification[] = [];
  const provider: NotificationProvider = {
    async send(notification) {
      sent.push(notification);
      return status === "sent"
        ? { status: "sent", providerMessageId: `msg-${sent.length}` }
        : { status: "failed", retryable: false, errorCode: "test" };
    },
  };
  return { sent, provider };
}

async function sellOneSeat(email: string) {
  const { db, shop } = ctx;
  const [trip] = (await upcomingTripsWithCounts(db, shop.id)).filter(
    (candidate) => !candidate.course && candidate.capacity - candidate.booked >= 1,
  );
  if (!trip) throw new Error("no bookable trip");
  const party = await createBookingParty(db, [
    { actor: "staff" as const, shopId: shop.id, tripId: trip.id, fullName: "Buyer", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  return { trip, bookingId: party.bookings[0]?.bookingId ?? "" };
}

async function realShop(on: boolean) {
  const { db, shop } = ctx;
  // The seeded shop's own bookings are dated around the frozen clock, some of
  // them after it. The cursor sits after the newest of them and the clock moves
  // past the cursor, so only what a test sells afterwards is news.
  const [newest] = await db
    .select({ at: max(bookings.createdAt) })
    .from(bookings)
    .where(eq(bookings.shopId, shop.id));
  const cursor = newest?.at ?? nowDate();
  await db
    .update(shops)
    .set({ isDemo: false, seatSoldAlertsEnabled: on, seatSoldAlertedThrough: cursor })
    .where(eq(shops.id, shop.id));
  advanceClock(Math.max(cursor.getTime() - nowMs(), 0) + 1_000);
}

const later = () => nowDate();

describe("sendSeatSoldAlerts", () => {
  it("is off for a shop that has not asked, and sends nothing", async () => {
    const { db } = ctx;
    await realShop(false);
    await sellOneSeat("off@example.com");
    const { sent, provider } = recorder();
    const summary = await sendSeatSoldAlerts(db, { now: later(), origin: ORIGIN, provider });
    expect(summary.shops).toBe(0);
    expect(sent).toEqual([]);
  });

  it("emails each owner and manager the count by departure, then not again", async () => {
    const { db } = ctx;
    await realShop(true);
    const { trip } = await sellOneSeat("one@example.com");
    const { sent, provider } = recorder();
    const now = later();
    const first = await sendSeatSoldAlerts(db, { now, origin: ORIGIN, provider });
    expect(first.seats).toBe(1);
    expect(first.sent).toBeGreaterThan(0);
    for (const message of sent) {
      if (message.kind !== "seat_sold_digest") throw new Error("wrong kind");
      expect(message.departures).toEqual([
        { title: trip.title, startsAt: expect.any(Date), seats: 1 },
      ]);
      // Counts and departures only: no diver, no address of theirs.
      expect(JSON.stringify(message)).not.toContain("one@example.com");
      expect(message.boardUrl).toBe(`${ORIGIN}/shop/${ctx.shop.slug}/schedule`);
    }

    const again = recorder();
    const second = await sendSeatSoldAlerts(db, {
      now: new Date(now.getTime() + 60_000),
      origin: ORIGIN,
      provider: again.provider,
    });
    expect(second.seats).toBe(0);
    expect(again.sent).toEqual([]);
  });

  it("does not announce a seat a staffer put on the boat", async () => {
    const { db, shop } = ctx;
    await realShop(true);
    const { trip, bookingId } = await sellOneSeat("walkin@example.com");
    const [staffer] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
      .limit(1);
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      actorPersonId: staffer?.id,
      code: "seat_added",
      params: { actor: "Dana", diver: "Buyer" },
    });
    const { sent, provider } = recorder();
    const summary = await sendSeatSoldAlerts(db, { now: later(), origin: ORIGIN, provider });
    expect(summary.seats).toBe(0);
    expect(sent).toEqual([]);
  });

  it("gives the seats back to the next pass when nobody could be reached", async () => {
    const { db } = ctx;
    await realShop(true);
    await sellOneSeat("retry@example.com");
    const now = later();
    const down = recorder("failed");
    const failed = await sendSeatSoldAlerts(db, { now, origin: ORIGIN, provider: down.provider });
    expect(failed.sent).toBe(0);
    expect(failed.failed).toBeGreaterThan(0);

    const up = recorder();
    const retried = await sendSeatSoldAlerts(db, {
      now: new Date(now.getTime() + 60_000),
      origin: ORIGIN,
      provider: up.provider,
    });
    expect(retried.seats).toBe(1);
    expect(up.sent.length).toBeGreaterThan(0);
  });

  it("never mails a demo shop", async () => {
    const { db, shop } = ctx;
    await db
      .update(shops)
      .set({ isDemo: true, seatSoldAlertsEnabled: true, seatSoldAlertedThrough: nowDate() })
      .where(eq(shops.id, shop.id));
    await sellOneSeat("demo@example.com");
    const { sent, provider } = recorder();
    await sendSeatSoldAlerts(db, { now: later(), origin: ORIGIN, provider });
    expect(sent).toEqual([]);
  });
});
