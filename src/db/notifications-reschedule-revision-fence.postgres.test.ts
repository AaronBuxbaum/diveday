import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { meetingPointForMessage, meetingPointOfRows } from "@/lib/meeting-point";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { advanceClock } from "@/test/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { notificationSendQueue, shops, trips } from "./schema";
import { createTrip } from "./trips";
import { updateTrip } from "./trips-record";

afterEach(() => vi.unstubAllEnvs());

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture() {
  vi.stubEnv(
    "SECRET_ENCRYPTION_KEY",
    Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
  );
  const pg = await postgresTestDb();
  const [shop] = await pg.db
    .insert(shops)
    .values({ name: "Revision Fence", slug: "revision-fence", timezone: "UTC" })
    .returning();
  if (!shop) throw new Error("shop missing");
  const startsAt = new Date("2035-03-12T12:00:00Z");
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Revision fence trip",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 6,
    plannedDives: 2,
  });
  if (!trip) throw new Error("trip missing");
  const rescheduled = await updateTrip(pg.connect(), shop.id, trip.id, {
    title: trip.title,
    startsAt: new Date(trip.startsAt.getTime() + HOUR_MS),
    endsAt: new Date(trip.endsAt.getTime() + HOUR_MS),
    capacity: trip.capacity,
    plannedDives: trip.plannedDives,
  });
  if (!rescheduled.ok) throw new Error("fixture reschedule failed");
  const [liveTrip] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
  if (!liveTrip) throw new Error("live trip missing");
  const booking = await createBooking(pg.db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Revision Diver",
    email: "revision-diver@example.com",
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const notification: Notification = {
    kind: "trip_rescheduled",
    bookingId: booking.bookingId,
    shopId: shop.id,
    to: "revision-diver@example.com",
    locale: "en-US",
    diverName: "Revision Diver",
    shopName: shop.name,
    tripTitle: trip.title,
    previousStartsAt: trip.startsAt,
    startsAt: liveTrip.startsAt,
    endsAt: liveTrip.endsAt,
    timezone: shop.timezone,
    dockCallMinutes: shop.dockCallMinutes,
    revision: liveTrip.revision,
    meetingPointSnapshot: meetingPointForMessage(meetingPointOfRows(shop, liveTrip)),
  };
  await sendNotification(pg.db, notification, {
    async send() {
      return { status: "failed", retryable: true, errorCode: "temporary_failure" };
    },
  });
  const [queued] = await pg.db.select({ id: notificationSendQueue.id }).from(notificationSendQueue);
  if (!queued) throw new Error("retry not queued");
  await pg.db.update(notificationSendQueue).set({ nextAttemptAt: new Date(0) });
  return { pg, shop, trip: liveTrip, notification };
}

const updateStart = (date: Date, offset: number) => new Date(date.getTime() + offset * HOUR_MS);

describePostgres("queued reschedule revision fence", () => {
  it("keeps a checked revision current until the provider invocation finishes", async () => {
    const { pg, shop, trip } = await fixture();
    const entered = barrier();
    const release = barrier();
    let moveFinished = false;
    const provider: NotificationProvider = {
      async send() {
        entered.resolve();
        await release.promise;
        return { status: "sent", providerMessageId: "revision-fence" };
      },
    };
    const drain = drainNotificationRetries(pg.connect(), { provider });
    let move: Promise<unknown> | undefined;
    try {
      const race = await Promise.race([
        entered.promise.then(() => ({ entered: true as const })),
        drain.then((summary) => ({ entered: false as const, summary })),
      ]);
      if (!race.entered) {
        const rows = await pg.db
          .select({
            status: notificationSendQueue.status,
            errorCode: notificationSendQueue.errorCode,
            lastError: notificationSendQueue.lastError,
          })
          .from(notificationSendQueue);
        throw new Error(
          `Retry exited before provider: ${JSON.stringify({ summary: race.summary, rows })}`,
        );
      }
      move = updateTrip(pg.connect(), shop.id, trip.id, {
        title: trip.title,
        startsAt: updateStart(trip.startsAt, 2),
        endsAt: updateStart(trip.endsAt, 2),
        capacity: trip.capacity,
        plannedDives: trip.plannedDives,
      }).then((result) => {
        moveFinished = true;
        return result;
      });
      await waitForLockWaiters(pg.db, 1);
      expect(moveFinished).toBe(false);
    } finally {
      release.resolve();
    }
    await expect(drain).resolves.toMatchObject({ sent: 1, failed: 0 });
    await expect(move).resolves.toMatchObject({ ok: true });
    expect(moveFinished).toBe(true);
  });

  it("suppresses the retry when the newer trip revision commits first", async () => {
    const { pg, shop, trip } = await fixture();
    await expect(
      updateTrip(pg.connect(), shop.id, trip.id, {
        title: trip.title,
        startsAt: updateStart(trip.startsAt, 2),
        endsAt: updateStart(trip.endsAt, 2),
        capacity: trip.capacity,
        plannedDives: trip.plannedDives,
      }),
    ).resolves.toMatchObject({ ok: true });
    const send = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "must-not-send",
    }));

    await expect(
      drainNotificationRetries(pg.connect(), { provider: { send } }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
    });
    expect(send).not.toHaveBeenCalled();
    await expect(
      pg.db.select().from(notificationSendQueue).where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([
      { status: "failed", errorCode: "stale_reschedule", payloadSealed: null },
    ]);
    const [current] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    expect(current?.revision).toBe(trip.revision + 1);
  });

  it.each([
    ["end time", { endsAt: new Date("2035-03-12T18:00:00Z") }],
    ["meeting point", { meetingPointLabel: "South Pier" }],
  ])("suppresses a queued notice after a same-revision %s edit", async (_change, patch) => {
    const { pg, shop, trip } = await fixture();
    const edit = patch as { endsAt?: Date; meetingPointLabel?: string };
    await expect(
      updateTrip(pg.connect(), shop.id, trip.id, {
        title: trip.title,
        startsAt: trip.startsAt,
        endsAt: edit.endsAt ?? trip.endsAt,
        capacity: trip.capacity,
        plannedDives: trip.plannedDives,
        meetingPointLabel: edit.meetingPointLabel ?? trip.meetingPointLabel,
      }),
    ).resolves.toMatchObject({ ok: true });
    const send = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "must-not-send-stale-content",
    }));

    await expect(
      drainNotificationRetries(pg.connect(), { provider: { send } }),
    ).resolves.toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    const [current] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    expect(current?.revision).toBe(trip.revision);
    await expect(
      pg.db
        .select({
          status: notificationSendQueue.status,
          errorCode: notificationSendQueue.errorCode,
        })
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([{ status: "failed", errorCode: "stale_reschedule" }]);
  });

  it("parks an already-queued booking handoff after its link expires", async () => {
    const { pg, shop, trip } = await fixture();
    const booking = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.shopId, shop.id));
    const [bookingRow] = booking;
    if (!bookingRow?.bookingId) throw new Error("booking missing from retry fixture");
    await pg.db.delete(notificationSendQueue).where(eq(notificationSendQueue.shopId, shop.id));
    const handoff: Notification = {
      kind: "booking_handoff",
      bookingId: bookingRow.bookingId,
      shopId: shop.id,
      to: "revision-diver@example.com",
      locale: "en-US",
      diverName: "Revision Diver",
      shopName: shop.name,
      tripTitle: trip.title,
      bookingUrl: "https://dive.day/booking/test-only-token",
      expiresAt: new Date(nowDate().getTime() + 10 * 60_000),
      timezone: shop.timezone,
    };
    await sendNotification(pg.db, handoff, {
      async send() {
        return { status: "failed", retryable: true, errorCode: "temporary_failure" };
      },
    });
    await pg.db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.bookingId, bookingRow.bookingId));
    advanceClock(11 * 60_000);
    const send = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "must-not-send-expired-handoff",
    }));

    await expect(
      drainNotificationRetries(pg.connect(), { provider: { send } }),
    ).resolves.toMatchObject({
      sent: 0,
      failed: 1,
    });
    expect(send).not.toHaveBeenCalled();
    await expect(
      pg.db
        .select({
          status: notificationSendQueue.status,
          errorCode: notificationSendQueue.errorCode,
          payloadSealed: notificationSendQueue.payloadSealed,
        })
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([
      { status: "failed", errorCode: "expired_handoff", payloadSealed: null },
    ]);
  });
});
