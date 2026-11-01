import { randomBytes } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { seededShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { anonymizeDiver } from "./anonymize";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { bookings, notificationSendQueue, people, personRoles, trips } from "./schema";
import { createTrip, listTripDiverContacts } from "./trips";

/**
 * **A queued conditions-hold retry is the seat's, never the address's**
 * (issue #3314).
 *
 * The notice used to be keyed `trip-conditions-hold/<trip>/<published>/<to>`
 * and carried no seat, so its queue row had no person, trip or booking handle:
 * erasure, merge and a cancel could not find it while it waited, and its key
 * kept the address after every other column was cleared. It now names its seat
 * (`seatId`), which keys the row and binds it like every booking-bound retry.
 *
 * On a fresh database per test, not the file-scoped rollback context: erasure,
 * cancel and the drain each open their own transaction.
 */

const HOUR = 60 * 60 * 1000;
const failed = { status: "failed" as const, retryable: true, errorCode: "temporary_failure" };
const failing: NotificationProvider = {
  async send() {
    return failed;
  },
};

afterEach(() => vi.unstubAllEnvs());

/** A retry is due at the next daily tick, so a drain a day and an hour on reaches it. */
const afterNextDailyTick = () => new Date(nowDate().getTime() + 25 * HOUR);

/** One diver on a departure three days out, and the hold notice that would go to their seat. */
async function heldSeat(db: AppDb, shop: { id: string; name: string; timezone: string }) {
  const startsAt = new Date(nowDate().getTime() + 72 * HOUR);
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Hold Test Two-Tank",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR),
    capacity: 8,
    plannedDives: 2,
  });
  if (!trip) throw new Error("test trip could not be created");
  const email = `hold-${randomBytes(4).toString("hex")}@example.invalid`;
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Hana Holt",
    email,
  });
  if (!booked.ok) throw new Error(`setup booking refused: ${booked.reason}`);
  // The crew calls the hold after the seat was sold, as the action does.
  await db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, trip.id));
  const [contact] = await listTripDiverContacts(db, shop.id, trip.id);
  if (!contact?.email) throw new Error("expected the seat's contact");
  const publishedAt = nowDate();
  const notification: Notification = {
    kind: "trip_conditions_hold",
    seatId: contact.bookingId,
    tripId: trip.id,
    shopId: shop.id,
    to: contact.email,
    locale: "en-US",
    diverName: contact.fullName,
    shopName: shop.name,
    tripTitle: trip.title,
    startsAt: trip.startsAt,
    timezone: shop.timezone,
    conditionsSummary: "Watching a squall line.",
    tripUrl: `https://diveday.invalid/s/blue-mantis/trips/${trip.id}`,
    publishedAt,
  };
  return {
    trip,
    email,
    bookingId: booked.bookingId,
    personId: booked.personId,
    publishedAt,
    notification,
  };
}

async function holdRows(db: AppDb, shopId: string) {
  return db
    .select()
    .from(notificationSendQueue)
    .where(
      and(
        eq(notificationSendQueue.shopId, shopId),
        like(notificationSendQueue.idempotencyKey, "trip-conditions-hold/%"),
      ),
    );
}

async function ownerOf(db: AppDb, shopId: string): Promise<string> {
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
    .limit(1);
  if (!owner) throw new Error("expected the seeded owner");
  return owner.id;
}

describe("a failed conditions-hold notice", () => {
  it("queues one row keyed and bound by its seat, with no address in the key", async () => {
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);

    const result = await sendNotification(db, seat.notification, failing);

    expect(result).toMatchObject({ status: "failed", retryQueued: true });
    const [row, ...others] = await holdRows(db, shop.id);
    expect(others).toEqual([]);
    expect(row?.idempotencyKey).toBe(
      `trip-conditions-hold/${seat.bookingId}/${seat.publishedAt.toISOString()}`,
    );
    expect(row?.idempotencyKey).not.toContain("@");
    expect(row).toMatchObject({
      bookingId: seat.bookingId,
      recipientPersonId: seat.personId,
      recipientTripId: seat.trip.id,
    });
  });

  it("leaves no trace of the address on the row once the retry is sent", async () => {
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);
    await sendNotification(db, seat.notification, failing);

    const healthy = fakeEmail();
    const summary = await drainNotificationRetries(db, {
      now: afterNextDailyTick(),
      provider: healthy.provider,
    });

    expect(summary.sent).toBe(1);
    expect(healthy.sent.map((sent) => sent.kind)).toEqual(["trip_conditions_hold"]);
    const [row] = await holdRows(db, shop.id);
    expect(row?.status).toBe("sent");
    expect(JSON.stringify(row)).not.toContain(seat.email);
    expect(JSON.stringify(row)).not.toContain("@");
  });

  it("leaves no trace of the address on the row once the retry gives up", async () => {
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);
    await sendNotification(db, seat.notification, failing);

    await drainNotificationRetries(db, {
      now: afterNextDailyTick(),
      provider: fakeEmail({ status: "failed", retryable: false, errorCode: "rejected" }).provider,
    });

    const [row] = await holdRows(db, shop.id);
    expect(row?.status).toBe("failed");
    expect(JSON.stringify(row)).not.toContain(seat.email);
    expect(JSON.stringify(row)).not.toContain("@");
  });

  it("is gone when the diver is erased while it waits", async () => {
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);
    await sendNotification(db, seat.notification, failing);
    expect(await holdRows(db, shop.id)).toHaveLength(1);

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.personId,
      actorPersonId: await ownerOf(db, shop.id),
    });

    expect(erased.ok).toBe(true);
    const remaining = await holdRows(db, shop.id);
    expect(JSON.stringify(remaining)).not.toContain(seat.email);
    expect(remaining.filter((row) => row.status === "queued")).toEqual([]);
  });

  it("leaves no row naming the seat once the diver is erased after it was sent", async () => {
    // A sent row has dropped its booking handle and keeps only its key, which
    // names the seat; erasure finds it by that key (diver-framed review).
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);
    await sendNotification(db, seat.notification, failing);
    await drainNotificationRetries(db, {
      now: afterNextDailyTick(),
      provider: fakeEmail().provider,
    });
    const [sentRow] = await holdRows(db, shop.id);
    expect(sentRow).toMatchObject({ status: "sent", bookingId: null });

    const erased = await anonymizeDiver(db, {
      shopId: shop.id,
      personId: seat.personId,
      actorPersonId: await ownerOf(db, shop.id),
    });

    expect(erased.ok).toBe(true);
    expect(
      (await holdRows(db, shop.id)).filter((row) => row.idempotencyKey.includes(seat.bookingId)),
    ).toEqual([]);
  });

  it("is never sent once its seat is cancelled", async () => {
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);
    await sendNotification(db, seat.notification, failing);

    const cancelled = await cancelBooking(db, shop.id, seat.bookingId);
    expect(cancelled.ok).toBe(true);
    const healthy = fakeEmail();
    await drainNotificationRetries(db, {
      now: afterNextDailyTick(),
      provider: healthy.provider,
    });

    expect(healthy.sent.filter((sent) => sent.kind === "trip_conditions_hold")).toEqual([]);
    const remaining = await holdRows(db, shop.id);
    expect(remaining.filter((row) => row.status === "queued")).toEqual([]);
    expect(JSON.stringify(remaining)).not.toContain(seat.email);
  });

  /**
   * Before the drain re-checked the trip, a hold queued on Friday evening was
   * sent at the next daily tick even after the crew lifted it, moved the
   * departure, or the boat had sailed (dock-operator review). Each of these
   * ends the row without a send.
   */
  async function drainedAfter(
    change: (db: AppDb, seat: Awaited<ReturnType<typeof heldSeat>>) => Promise<void>,
  ) {
    const { db, shop } = await seededShopContext();
    vi.stubEnv("SECRET_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const seat = await heldSeat(db, shop);
    await sendNotification(db, seat.notification, failing);
    await change(db, seat);
    const healthy = fakeEmail();
    await drainNotificationRetries(db, { now: afterNextDailyTick(), provider: healthy.provider });
    const [row] = await holdRows(db, shop.id);
    return { sent: healthy.sent.filter((sent) => sent.kind === "trip_conditions_hold"), row, seat };
  }

  it("is not sent once the crew lifts the hold", async () => {
    const { sent, row, seat } = await drainedAfter(async (db, { trip }) => {
      await db.update(trips).set({ conditionsHold: false }).where(eq(trips.id, trip.id));
    });
    expect(sent).toEqual([]);
    expect(row).toMatchObject({ status: "failed", errorCode: "stale_hold", payloadSealed: null });
    expect(JSON.stringify(row)).not.toContain(seat.email);
  });

  it("is not sent once the departure moves, since it names the old time", async () => {
    const { sent, row } = await drainedAfter(async (db, { trip }) => {
      const startsAt = new Date(trip.startsAt.getTime() + 24 * HOUR);
      await db
        .update(trips)
        .set({
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * HOUR),
          revision: trip.revision + 1,
        })
        .where(eq(trips.id, trip.id));
    });
    expect(sent).toEqual([]);
    expect(row).toMatchObject({ status: "failed", errorCode: "stale_hold" });
  });

  it("is not sent once the boat has sailed", async () => {
    const { sent, row } = await drainedAfter(async (db, { trip }) => {
      // Moved under the drain's clock rather than the clock moved past it:
      // the departure left two hours before the retry comes due.
      const startsAt = new Date(afterNextDailyTick().getTime() - 2 * HOUR);
      await db
        .update(trips)
        .set({
          startsAt,
          endsAt: new Date(startsAt.getTime() + 4 * HOUR),
          revision: trip.revision + 1,
        })
        .where(eq(trips.id, trip.id));
    });
    expect(sent).toEqual([]);
    expect(row?.status).toBe("failed");
  });

  it("is not sent once its seat moves to another departure", async () => {
    const { sent, row, seat } = await drainedAfter(async (db, { trip, bookingId }) => {
      const other = await createTrip(db, {
        shopId: trip.shopId,
        title: "Hold Test Other Boat",
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        capacity: 8,
        plannedDives: 2,
      });
      if (!other) throw new Error("second trip could not be created");
      await db.update(trips).set({ conditionsHold: true }).where(eq(trips.id, other.id));
      await db.update(bookings).set({ tripId: other.id }).where(eq(bookings.id, bookingId));
    });
    expect(sent).toEqual([]);
    expect(row?.status).toBe("failed");
    expect(JSON.stringify(row)).not.toContain(seat.email);
  });
});
