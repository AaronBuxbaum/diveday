import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import type { NotificationProvider } from "@/lib/notifications";
import {
  describePostgres,
  type PostgresTestDatabase,
  postgresTestDb,
  waitForLockWaiters,
} from "@/test/postgres";
import { offerBookingHandoffByEmail } from "./booking-handoff";
import { drainNotificationRetries } from "./notifications";
import {
  bookingCapabilities,
  bookings,
  notificationDeliveries,
  notificationSendQueue,
  people,
  shops,
  trips,
} from "./schema";
import { sendRescheduleNotices } from "./trip-rescheduled";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";
import { updateTrip, updateTripSection } from "./trips-record";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function fixture(existingPg?: PostgresTestDatabase) {
  const pg = existingPg ?? (await postgresTestDb());
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await pg.db
    .insert(shops)
    .values({
      name: `Reschedule race ${suffix}`,
      slug: `reschedule-race-${suffix}`,
      timezone: "UTC",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const startsAt = new Date("2035-03-12T12:00:00Z");
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Race trip",
      startsAt: new Date(startsAt.getTime() + 60_000),
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60_000),
      capacity: 2,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [handoffTrip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Public booking trip",
      startsAt: new Date(startsAt.getTime() + 7 * 24 * 60 * 60_000),
      endsAt: new Date(startsAt.getTime() + 7 * 24 * 60 * 60_000 + 4 * 60 * 60_000),
      capacity: 2,
      isPrivate: false,
    })
    .returning();
  if (!handoffTrip) throw new Error("handoff trip insert returned no row");
  const [person, replacement] = await pg.db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Old Diver", email: `old-${suffix}@example.com` },
      { shopId: shop.id, fullName: "New Diver", email: `new-${suffix}@example.com` },
    ])
    .returning();
  if (!person || !replacement) throw new Error("people insert returned no rows");
  const [booking] = await pg.db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking insert returned no row");
  const now = new Date(startsAt.getTime() - 24 * 60 * 60_000);
  const payload = {
    kind: "trip_rescheduled" as const,
    tripId: trip.id,
    previousStartsAt: startsAt.toISOString(),
    meetingPointMoved: false,
  };
  return { pg, shop, trip, handoffTrip, person, replacement, booking, now, payload };
}

function sendOptions(provider: NotificationProvider, now: Date) {
  return {
    now,
    emailProvider: provider,
    appOrigin: "https://diveday.example",
    whatsAppProviders: new Map(),
  };
}

describePostgres("reschedule and handoff notice fences", () => {
  it("makes full and section trip edits wait on the notice fence before locking the trip", async () => {
    const pg = await postgresTestDb();

    for (const scope of ["full", "section"] as const) {
      const { shop, trip } = await fixture(pg);
      const fenceHeld = barrier();
      const releaseFence = barrier();
      const holdDispatchFence = pg.connect().transaction(async (tx) => {
        await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "dispatch");
        fenceHeld.resolve();
        await releaseFence.promise;
      });
      let write: ReturnType<typeof updateTrip> | ReturnType<typeof updateTripSection> | undefined;
      try {
        await Promise.race([fenceHeld.promise, holdDispatchFence]);
        write =
          scope === "full"
            ? updateTrip(pg.connect(), shop.id, trip.id, {
                title: trip.title,
                startsAt: trip.startsAt,
                endsAt: trip.endsAt,
                capacity: trip.capacity,
                plannedDives: trip.plannedDives,
              })
            : updateTripSection(pg.connect(), shop.id, trip.id, { title: "Section edit" });
        await waitForLockWaiters(pg.db, 1);

        // The write must be parked on the advisory fence, before it owns the
        // trip row. If it took the row first, this NOWAIT probe would fail and
        // an in-flight notice could be stranded behind the waiting writer.
        await expect(
          pg.connect().execute(sql`select id from trips where id = ${trip.id} for update nowait`),
        ).resolves.toBeDefined();
      } finally {
        releaseFence.resolve();
        await holdDispatchFence;
        await write?.catch(() => undefined);
      }
      if (!write) throw new Error("trip write did not start");
      await expect(write).resolves.toMatchObject({ ok: true });
    }
  });

  it("keeps a readiness link alive only when the reschedule retry is durably queued", async () => {
    const { pg, shop, booking, now, payload } = await fixture();
    const provider: NotificationProvider = {
      async send() {
        return { status: "failed", retryable: true, errorCode: "temporary_failure" };
      },
    };
    await expect(
      sendRescheduleNotices(pg.db, shop.id, payload, sendOptions(provider, now)),
    ).resolves.toMatchObject({ told: 0, failed: 1 });
    const [queued] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.bookingId, booking.id));
    const [capability] = await pg.db
      .select({ revokedAt: bookingCapabilities.revokedAt })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, booking.id),
          eq(bookingCapabilities.purpose, "readiness"),
        ),
      );
    expect(queued).toMatchObject({ status: "queued" });
    expect(queued?.payloadSealed).toMatch(/^v1\./);
    expect(capability?.revokedAt).toBeNull();
  });

  it.each([
    ["permanent provider failure", false],
    ["retryable failure when queue sealing is unavailable", true],
  ])("revokes the readiness link on %s", async (_label, queueUnavailable) => {
    const { pg, shop, booking, now, payload } = await fixture();
    const provider: NotificationProvider = {
      async send() {
        return queueUnavailable
          ? { status: "failed", retryable: true, errorCode: "temporary_failure" }
          : { status: "failed", retryable: false, errorCode: "permanent_failure" };
      },
    };
    if (queueUnavailable) vi.stubEnv("SECRET_ENCRYPTION_KEY", "");
    try {
      await expect(
        sendRescheduleNotices(pg.db, shop.id, payload, sendOptions(provider, now)),
      ).resolves.toMatchObject({ told: 0, failed: 1 });
      expect(
        await pg.db
          .select()
          .from(notificationSendQueue)
          .where(eq(notificationSendQueue.bookingId, booking.id)),
      ).toEqual([]);
      const [capability] = await pg.db
        .select({ revokedAt: bookingCapabilities.revokedAt })
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, booking.id),
            eq(bookingCapabilities.purpose, "readiness"),
          ),
        );
      expect(capability?.revokedAt).not.toBeNull();
    } finally {
      if (queueUnavailable) vi.unstubAllEnvs();
    }
  });

  it("does not queue a ten-minute handoff link for a next-day retry", async () => {
    const { pg, shop, handoffTrip, booking, person, now } = await fixture();
    let providerCalls = 0;
    const transientFailure: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "failed", retryable: true, errorCode: "temporary_failure" };
      },
    };
    await expect(
      offerBookingHandoffByEmail(
        pg.db,
        {
          shopId: shop.id,
          tripId: handoffTrip.id,
          email: person.email as string,
          origin: "https://diveday.example",
          requestLocale: "en-US",
          now,
        },
        { provider: transientFailure },
      ),
    ).resolves.toBe("failed");

    const [capability] = await pg.db
      .select({ revokedAt: bookingCapabilities.revokedAt })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, booking.id),
          eq(bookingCapabilities.purpose, "handoff"),
        ),
      );
    expect(capability?.revokedAt).not.toBeNull();
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, booking.id)),
    ).toEqual([]);

    const nextDayProvider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send-dead-handoff" };
      },
    };
    await expect(
      drainNotificationRetries(pg.db, {
        now: new Date(now.getTime() + 24 * 60 * 60_000),
        provider: nextDayProvider,
      }),
    ).resolves.toMatchObject({ scanned: 0, sent: 0 });
    expect(providerCalls).toBe(1);
  });

  it("reports permanent handoff failure and revokes its undeliverable link", async () => {
    const { pg, shop, handoffTrip, booking, person, now } = await fixture();
    const provider: NotificationProvider = {
      async send() {
        return { status: "failed", retryable: false, errorCode: "permanent_failure" };
      },
    };
    await expect(
      offerBookingHandoffByEmail(
        pg.db,
        {
          shopId: shop.id,
          tripId: handoffTrip.id,
          email: person.email as string,
          origin: "https://diveday.example",
          requestLocale: "en-US",
          now,
        },
        { provider },
      ),
    ).resolves.toBe("failed");
    expect(
      await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, booking.id)),
    ).toEqual([]);
    const [capability] = await pg.db
      .select({ revokedAt: bookingCapabilities.revokedAt })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, booking.id),
          eq(bookingCapabilities.purpose, "handoff"),
        ),
      );
    expect(capability?.revokedAt).not.toBeNull();
  });

  it("drops a queued notice after two later trip moves", async () => {
    const { pg, shop, trip, booking, now, payload } = await fixture();
    const transientFailure: NotificationProvider = {
      async send() {
        return { status: "failed", retryable: true, errorCode: "temporary_failure" };
      },
    };
    await expect(
      sendRescheduleNotices(pg.db, shop.id, payload, sendOptions(transientFailure, now)),
    ).resolves.toMatchObject({ told: 0, failed: 1 });
    const [queued] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.bookingId, booking.id));
    expect(queued?.status).toBe("queued");
    if (!queued) throw new Error("retry queue insert returned no row");

    // The queued notice names the original move. Two later staff moves bump
    // the trip revision twice before the delayed retry is drained.
    for (const offset of [2, 3]) {
      await pg.db
        .update(trips)
        .set({
          startsAt: new Date(trip.startsAt.getTime() + offset * 60 * 60_000),
          endsAt: new Date(trip.endsAt.getTime() + offset * 60 * 60_000),
          revision: sql`${trips.revision} + 1`,
        })
        .where(and(eq(trips.id, trip.id), eq(trips.shopId, shop.id)));
    }

    let retryProviderCalls = 0;
    const retryProvider: NotificationProvider = {
      async send() {
        retryProviderCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send-obsolete-reschedule" };
      },
    };
    await expect(
      drainNotificationRetries(pg.db, {
        now: new Date(now.getTime() + 24 * 60 * 60_000),
        provider: retryProvider,
      }),
    ).resolves.toMatchObject({ scanned: 1, failed: 1, sent: 0 });
    expect(retryProviderCalls).toBe(0);
    const [finished] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.id, queued.id));
    expect(finished).toMatchObject({
      status: "failed",
      errorCode: "stale_reschedule",
      payloadSealed: null,
      bookingId: null,
    });
    const [delivery] = await pg.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.bookingId, booking.id),
          eq(notificationDeliveries.kind, "trip_rescheduled"),
        ),
      );
    expect(delivery).toMatchObject({ status: "failed", sendErrorCode: "stale_reschedule" });
  });

  it("finishes a normal provider call and tracking before erasure can commit", async () => {
    const { pg, shop, person, booking, now, payload } = await fixture();
    const started = barrier();
    const release = barrier();
    const provider: NotificationProvider = {
      async send(notification) {
        if (notification.to !== person.email)
          throw new Error("reschedule addressed a different person");
        started.resolve();
        await release.promise;
        return { status: "sent", providerMessageId: "reschedule-race-message" };
      },
    };
    const send = sendRescheduleNotices(pg.db, shop.id, payload, sendOptions(provider, now));
    let erase!: Promise<unknown>;
    try {
      await started.promise;
      erase = pg.connect().transaction((tx) =>
        tx
          .update(people)
          .set({
            anonymizedAt: new Date(now.getTime() + 1),
            deletedAt: new Date(now.getTime() + 1),
          })
          .where(and(eq(people.id, person.id), eq(people.shopId, shop.id))),
      );
      await waitForLockWaiters(pg.db, 1);
      release.resolve();
      await expect(send).resolves.toMatchObject({ told: 1, failed: 0 });
      await erase;
      const [delivery] = await pg.db
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.bookingId, booking.id),
            eq(notificationDeliveries.kind, "trip_rescheduled"),
          ),
        );
      expect(delivery).toMatchObject({
        status: "sent",
        providerMessageId: "reschedule-race-message",
      });
    } finally {
      release.resolve();
      await send.catch(() => undefined);
      await erase?.catch(() => undefined);
    }
  });

  it("drops a scanned recipient when reassignment commits before the send fence", async () => {
    const { pg, shop, replacement, booking, now, payload } = await fixture();
    let providerCalls = 0;
    const provider = {
      send: async () => {
        providerCalls += 1;
        return { status: "sent" as const, providerMessageId: "must-not-send" };
      },
    };
    const updateDb = pg.connect();
    const release = barrier();
    let updated!: () => void;
    const updateStarted = new Promise<void>((resolve) => (updated = resolve));
    const repoint = updateDb.transaction(async (tx) => {
      await tx
        .update(bookings)
        .set({ personId: replacement.id })
        .where(and(eq(bookings.id, booking.id), eq(bookings.shopId, shop.id)));
      updated();
      await release.promise;
    });
    let send: ReturnType<typeof sendRescheduleNotices> | undefined;
    try {
      await updateStarted;
      send = sendRescheduleNotices(pg.db, shop.id, payload, sendOptions(provider, now));
      await waitForLockWaiters(pg.db, 1);
      release.resolve();
      await repoint;
      await expect(send).resolves.toMatchObject({ told: 0, failed: 0 });
      expect(providerCalls).toBe(0);
      expect(
        await pg.db
          .select()
          .from(bookingCapabilities)
          .where(eq(bookingCapabilities.bookingId, booking.id)),
      ).toEqual([]);
      expect(
        await pg.db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.bookingId, booking.id)),
      ).toEqual([]);
    } finally {
      release.resolve();
      await repoint.catch(() => undefined);
      await send?.catch(() => undefined);
    }
  });

  it("drops a scanned handoff recipient when the source booking is reassigned before its send fence", async () => {
    const { pg, shop, handoffTrip, replacement, booking, person, now } = await fixture();
    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send" };
      },
    };
    const updateDb = pg.connect();
    const release = barrier();
    let updated!: () => void;
    const updateStarted = new Promise<void>((resolve) => (updated = resolve));
    const repoint = updateDb.transaction(async (tx) => {
      await tx
        .update(bookings)
        .set({ personId: replacement.id })
        .where(and(eq(bookings.id, booking.id), eq(bookings.shopId, shop.id)));
      updated();
      await release.promise;
    });
    let offer: ReturnType<typeof offerBookingHandoffByEmail> | undefined;
    try {
      await updateStarted;
      offer = offerBookingHandoffByEmail(
        pg.db,
        {
          shopId: shop.id,
          tripId: handoffTrip.id,
          email: person.email as string,
          origin: "https://diveday.example",
          requestLocale: "en-US",
          now,
        },
        { provider },
      );
      await waitForLockWaiters(pg.db, 1);
      release.resolve();
      await repoint;
      await expect(offer).resolves.toBe("skipped");
      expect(providerCalls).toBe(0);
      expect(
        await pg.db
          .select()
          .from(bookingCapabilities)
          .where(eq(bookingCapabilities.bookingId, booking.id)),
      ).toEqual([]);
      expect(
        await pg.db
          .select()
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.bookingId, booking.id),
              eq(notificationDeliveries.kind, "booking_handoff"),
            ),
          ),
      ).toEqual([]);
    } finally {
      release.resolve();
      await repoint.catch(() => undefined);
      await offer?.catch(() => undefined);
    }
  });
});
