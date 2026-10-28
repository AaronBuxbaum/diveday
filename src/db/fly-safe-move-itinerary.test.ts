import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUR_MS, nowMs } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { createBooking } from "./bookings";
import {
  correctFlySafeForPerson,
  recordFlySafeTold,
  sendFlySafeCorrections,
} from "./fly-safe-correction";
import { bookings, notificationSendQueue, trips } from "./schema";
import { moveSeat } from "./seat-diver";
import { createTrip, listStaff } from "./trips";

const ctx = fileScopedShopContext();
const DAY = 24 * HOUR_MS;

async function fixture(toldHours = 18) {
  const { db, shop } = ctx;
  const makeTrip = async (title: string, offset: number) => {
    const startsAt = new Date(nowMs() + offset * DAY);
    const trip = await createTrip(db, {
      shopId: shop.id,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 10,
      plannedDives: 1,
    });
    if (!trip) throw new Error("trip missing");
    return trip;
  };
  const from = await makeTrip("Original day", 10);
  const to = await makeTrip("Decompression day", 30);
  const later = await makeTrip("Later day", 31);
  await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, to.id));
  const book = async (tripId: string, name: string, email: string) => {
    const result = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId,
      fullName: name,
      email,
    });
    if (!result.ok) throw new Error(`booking failed: ${result.reason}`);
    return result;
  };
  const movedSeat = await book(from.id, "Moving Diver", "moving-diver@example.com");
  const laterSeat = await book(later.id, "Moving Diver", "moving-diver@example.com");
  if (movedSeat.personId !== laterSeat.personId) throw new Error("expected same person");
  await recordFlySafeTold(db, {
    shopId: shop.id,
    bookingId: laterSeat.bookingId,
    hours: toldHours,
    recipientEmail: "moving-diver@example.com",
  });
  const otherSeat = await book(later.id, "Other Diver", "other-diver@example.com");
  await recordFlySafeTold(db, {
    shopId: shop.id,
    bookingId: otherSeat.bookingId,
    hours: 18,
    recipientEmail: "other-diver@example.com",
  });
  const owner = (await listStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("owner missing");
  return { db, shop, from, to, later, movedSeat, laterSeat, otherSeat, owner };
}

describe("flying guidance when a seat moves", () => {
  it("corrects the later reminder when a decompression seat moves into its lookback window", async () => {
    const { db, shop, from, to, movedSeat, laterSeat, otherSeat, owner } = await fixture();
    const email = fakeEmail();
    const result = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: movedSeat.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: null },
    );
    expect(result.ok).toBe(true);
    expect(email.sent.filter((item) => item.kind === "fly_safe_correction")).toMatchObject([
      { seatId: laterSeat.bookingId, to: "moving-diver@example.com" },
    ]);
    const [other] = await db.select().from(bookings).where(eq(bookings.id, otherSeat.bookingId));
    expect(other?.flySafeCorrectedAt).toBeNull();
  });
  it("rechecks the later reminder after moving an earlier decompression seat out of its lookback", async () => {
    const { db, shop, from, to, movedSeat, laterSeat, owner } = await fixture(24);
    await db
      .update(trips)
      .set({ startsAt: to.startsAt, endsAt: to.endsAt, exceedsNoDecoLimits: true })
      .where(eq(trips.id, from.id));
    await db
      .update(trips)
      .set({ startsAt: from.startsAt, endsAt: from.endsAt, exceedsNoDecoLimits: false })
      .where(eq(trips.id, to.id));
    const email = fakeEmail();
    const result = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: movedSeat.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: null },
    );
    expect(result.ok).toBe(true);
    expect(email.sent.filter((item) => item.kind === "fly_safe_correction")).toMatchObject([
      { seatId: laterSeat.bookingId, to: "moving-diver@example.com" },
    ]);
  });

  it("leaves cancelled later seats and other shops untouched", async () => {
    const { db, shop, from, to, movedSeat, laterSeat, owner } = await fixture();
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, laterSeat.bookingId));
    const email = fakeEmail();
    expect(
      await correctFlySafeForPerson(db, {
        shopId: crypto.randomUUID(),
        personId: movedSeat.personId,
        emailProvider: email.provider,
      }),
    ).toEqual({ told: 0, failed: 0, unreached: [] });
    const result = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: movedSeat.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: email.provider, appOrigin: null },
    );
    expect(result.ok).toBe(true);
    expect(email.sent.filter((item) => item.kind === "fly_safe_correction")).toEqual([]);
  });

  it("refuses to send when a selected seat no longer belongs to the expected person", async () => {
    const { db, shop, later, laterSeat } = await fixture();
    await db.update(trips).set({ exceedsNoDecoLimits: true }).where(eq(trips.id, later.id));
    const email = fakeEmail();
    expect(
      await sendFlySafeCorrections(db, {
        shopId: shop.id,
        tripId: later.id,
        bookingId: laterSeat.bookingId,
        expectedPersonId: crypto.randomUUID(),
        emailProvider: email.provider,
      }),
    ).toEqual({ told: 0, failed: 0, unreached: [] });
    expect(email.sent).toEqual([]);
  });

  it("queues a later-seat correction when the provider temporarily rejects it", async () => {
    const { db, shop, from, to, movedSeat, laterSeat, owner } = await fixture();
    const result = await moveSeat(
      db,
      {
        shopId: shop.id,
        fromTripId: from.id,
        toTripId: to.id,
        bookingId: movedSeat.bookingId,
        actorPersonId: owner.person.id,
      },
      { emailProvider: fakeEmail({ status: "failed", retryable: true }).provider, appOrigin: null },
    );
    expect(result).toMatchObject({ ok: true, flySafe: { failed: 1 } });
    const queued = await db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.bookingId, laterSeat.bookingId));
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ shopId: shop.id, status: "queued" });
  });
});
