import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import {
  drainNotificationRetries,
  sendAndRecordNotification,
  sendNotification,
} from "./notifications";
import {
  bookingCapabilities,
  bookings,
  notificationDeliveries,
  notificationSendQueue,
  people,
  shops,
  trips,
} from "./schema";

describePostgres("capability issuance and erasure serialization", () => {
  it("does not mint after an erasure already holds the subject lock", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Erasure race ${suffix}`, slug: `erasure-race-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Race test",
        startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Race Diver", email: `race-${suffix}@example.com` })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    const existing = await issueBookingCapability(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      purpose: "readiness",
      now,
    });
    if (!existing) throw new Error("initial capability insert returned no row");

    let releaseGate!: () => void;
    let signalUpdated!: () => void;
    const waitForRelease = new Promise<void>((resolve) => (releaseGate = resolve));
    const updated = new Promise<void>((resolve) => (signalUpdated = resolve));
    const gateDb = pg.connect();
    let mint: ReturnType<typeof issueBookingCapability> | undefined;
    const erasureAt = new Date(now.getTime() + 1);
    const gate = gateDb.transaction(async (tx) => {
      await tx
        .update(people)
        .set({ anonymizedAt: erasureAt, deletedAt: erasureAt })
        .where(eq(people.id, person.id));
      signalUpdated();
      await waitForRelease;
    });
    try {
      await updated;
      mint = issueBookingCapability(pg.db, {
        shopId: shop.id,
        bookingId: booking.id,
        purpose: "readiness",
        now,
      });
      await waitForLockWaiters(pg.db, 1);
      releaseGate();
      await gate;
      expect(await mint).toBeNull();
      expect(
        await verifyBookingCapability(pg.db, { token: existing.token, purpose: "readiness", now }),
      ).toBeNull();
      const capabilities = await pg.db
        .select()
        .from(bookingCapabilities)
        .where(eq(bookingCapabilities.bookingId, booking.id));
      expect(capabilities).toHaveLength(1);
    } finally {
      releaseGate();
      await gate;
      await mint?.catch(() => undefined);
    }
  });

  it("keeps a successful provider call and its normal tracking write inside the erasure fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Fenced send ${suffix}`, slug: `fenced-send-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Fenced send test",
        startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Fenced Diver", email: `fenced-${suffix}@example.com` })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");

    let releaseProvider!: () => void;
    let signalProvider!: () => void;
    let signalErasure!: () => void;
    const providerStarted = new Promise<void>((resolve) => (signalProvider = resolve));
    const erasureStarted = new Promise<void>((resolve) => (signalErasure = resolve));
    const providerGate = new Promise<void>((resolve) => (releaseProvider = resolve));
    const provider = {
      send: async () => {
        signalProvider();
        await providerGate;
        return { status: "sent" as const, providerMessageId: `message-${suffix}` };
      },
    };
    const send = withErasureCoordinatedBookingSend(
      pg.db,
      {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: person.id,
        expectedTripId: trip.id,
        expectedEmail: person.email,
      },
      (tx) =>
        sendAndRecordNotification(
          tx,
          {
            kind: "readiness_link",
            bookingId: booking.id,
            shopId: shop.id,
            to: person.email as string,
            locale: "en-US",
            diverName: person.fullName,
            shopName: shop.name,
            tripTitle: trip.title,
            readinessUrl: "https://example.com/ready/test-capability",
            expiresAt: trip.endsAt,
            timezone: "UTC",
          },
          { provider, signal: AbortSignal.timeout(3_000) },
        ),
    );
    const erasureDb = pg.connect();
    const erasure = erasureDb.transaction(async (tx) => {
      signalErasure();
      await tx
        .update(people)
        .set({ anonymizedAt: new Date(now.getTime() + 1), deletedAt: new Date(now.getTime() + 1) })
        .where(and(eq(people.id, person.id), eq(people.shopId, shop.id)));
    });
    try {
      await providerStarted;
      const erase = erasure;
      await erasureStarted;
      await waitForLockWaiters(pg.db, 1);
      releaseProvider();
      await send;
      await erase;
      const [delivery] = await pg.db
        .select()
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.shopId, shop.id),
            eq(notificationDeliveries.bookingId, booking.id),
          ),
        );
      expect(delivery).toMatchObject({ status: "sent", providerMessageId: `message-${suffix}` });
    } finally {
      releaseProvider();
      await send.catch(() => undefined);
      await erasure.catch(() => undefined);
    }
  });

  it("refuses a scanned reminder subject after the booking has been repointed", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Repoint ${suffix}`, slug: `repoint-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Repoint test",
        startsAt: new Date(now.getTime() + 86400000),
        endsAt: new Date(now.getTime() + 90000000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [oldPerson, newPerson] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Old Subject", email: `old-${suffix}@example.com` },
        { shopId: shop.id, fullName: "New Subject", email: `new-${suffix}@example.com` },
      ])
      .returning();
    if (!oldPerson || !newPerson) throw new Error("person insert returned no rows");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: newPerson.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    const send = vi.fn(async () => ({ status: "sent" as const }));
    const result = await withErasureCoordinatedBookingSend(
      pg.db,
      {
        shopId: shop.id,
        bookingId: booking.id,
        expectedPersonId: oldPerson.id,
        expectedTripId: trip.id,
        expectedEmail: oldPerson.email,
      },
      async () => send(),
    );
    expect(result).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not recreate retry tracking after erasure wins following a claimed send", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Retry erase ${suffix}`, slug: `retry-erase-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Retry erase test",
        startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Retry Diver", email: `retry-${suffix}@example.com` })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");

    const notification = {
      kind: "booking_confirmation" as const,
      bookingId: booking.id,
      shopId: shop.id,
      to: person.email as string,
      locale: "en-US" as const,
      diverName: person.fullName,
      shopName: shop.name,
      tripTitle: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      timezone: "UTC",
    };
    await sendNotification(pg.db, notification, {
      async send() {
        return { status: "failed", retryable: true, errorCode: "temporary" };
      },
    });
    const [queued] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.bookingId, booking.id));
    if (!queued) throw new Error("retry queue insert returned no row");
    expect(queued).toMatchObject({ recipientPersonId: person.id, recipientTripId: trip.id });

    let releaseProvider!: () => void;
    let signalProvider!: () => void;
    const providerStarted = new Promise<void>((resolve) => (signalProvider = resolve));
    const providerGate = new Promise<void>((resolve) => (releaseProvider = resolve));
    const retry = drainNotificationRetries(pg.db, {
      now: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      provider: {
        async send() {
          signalProvider();
          await providerGate;
          return { status: "sent" as const, providerMessageId: `retry-${suffix}` };
        },
      },
    });
    const eraseDb = pg.connect();
    let signalErase!: () => void;
    const erasureStarted = new Promise<void>((resolve) => (signalErase = resolve));
    let erasure: Promise<unknown> | undefined;
    try {
      await Promise.race([
        providerStarted,
        retry.then((summary) => {
          throw new Error(`retry drain finished before provider call: ${JSON.stringify(summary)}`);
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("retry provider did not start within 5s")), 5_000),
        ),
      ]);
      erasure = eraseDb.transaction(async (tx) => {
        signalErase();
        await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
        await tx
          .update(people)
          .set({
            anonymizedAt: new Date(now.getTime() + 1),
            deletedAt: new Date(now.getTime() + 1),
          })
          .where(eq(people.id, person.id));
        await tx.delete(notificationSendQueue).where(eq(notificationSendQueue.id, queued.id));
      });
      await erasureStarted;
      await waitForLockWaiters(pg.db, 1);
      releaseProvider();
      await retry;
      await erasure;
      expect(
        await pg.db
          .select()
          .from(notificationSendQueue)
          .where(eq(notificationSendQueue.id, queued.id)),
      ).toHaveLength(0);
      expect(
        await pg.db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.bookingId, booking.id)),
      ).toHaveLength(0);
    } finally {
      releaseProvider();
      await retry.catch(() => undefined);
      await erasure?.catch(() => undefined);
    }
  });

  it("suppresses a claimed retry when erasure wins before the provider fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: `Retry pre-fence ${suffix}`,
        slug: `retry-pre-fence-${suffix}`,
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Retry pre-fence test",
        startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Pre-fence Diver",
        email: `pre-fence-${suffix}@example.com`,
      })
      .returning();
    if (!person) throw new Error("person insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    await sendNotification(
      pg.db,
      {
        kind: "booking_confirmation",
        bookingId: booking.id,
        shopId: shop.id,
        to: person.email as string,
        locale: "en-US",
        diverName: person.fullName,
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        timezone: "UTC",
      },
      {
        async send() {
          return { status: "failed", retryable: true, errorCode: "temporary" };
        },
      },
    );
    const [queued] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.bookingId, booking.id));
    if (!queued) throw new Error("retry queue insert returned no row");

    let releaseErase!: () => void;
    let signalErase!: () => void;
    const holdErase = new Promise<void>((resolve) => (releaseErase = resolve));
    const eraseLocked = new Promise<void>((resolve) => (signalErase = resolve));
    const eraseDb = pg.connect();
    const erase = eraseDb.transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
      signalErase();
      await holdErase;
      await tx
        .update(people)
        .set({ anonymizedAt: new Date(now.getTime() + 1), deletedAt: new Date(now.getTime() + 1) })
        .where(eq(people.id, person.id));
      await tx.delete(notificationSendQueue).where(eq(notificationSendQueue.id, queued.id));
    });
    let drain: ReturnType<typeof drainNotificationRetries> | undefined;
    const provider = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "unexpected",
    }));
    try {
      await eraseLocked;
      drain = drainNotificationRetries(pg.db, {
        now: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
        provider: { send: provider },
      });
      await waitForLockWaiters(pg.db, 1);
      const [claimed] = await pg.db
        .select({ status: notificationSendQueue.status })
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.id, queued.id));
      expect(claimed?.status).toBe("processing");
      releaseErase();
      await erase;
      await expect(drain).resolves.toMatchObject({ scanned: 1, failed: 1 });
      expect(provider).not.toHaveBeenCalled();
      expect(
        await pg.db
          .select()
          .from(notificationSendQueue)
          .where(eq(notificationSendQueue.id, queued.id)),
      ).toHaveLength(0);
    } finally {
      releaseErase();
      await erase.catch(() => undefined);
      await drain?.catch(() => undefined);
    }
  });

  it("parks a claimed retry when its booking was repointed and keeps the sealed payload", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Retry move ${suffix}`, slug: `retry-move-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const now = nowDate();
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Retry move test",
        startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
        endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [oldPerson, newPerson] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Retry Old", email: `retry-old-${suffix}@example.com` },
        { shopId: shop.id, fullName: "Retry New", email: `retry-new-${suffix}@example.com` },
      ])
      .returning();
    if (!oldPerson || !newPerson) throw new Error("person insert returned no rows");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: oldPerson.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    await sendNotification(
      pg.db,
      {
        kind: "booking_confirmation",
        bookingId: booking.id,
        shopId: shop.id,
        to: oldPerson.email as string,
        locale: "en-US" as const,
        diverName: oldPerson.fullName,
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        timezone: "UTC",
      },
      {
        async send() {
          return { status: "failed", retryable: true, errorCode: "temporary" };
        },
      },
    );
    const [queued] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.bookingId, booking.id));
    if (!queued) throw new Error("retry queue insert returned no row");
    expect(queued?.recipientPersonId).toBe(oldPerson.id);
    await pg.db.update(bookings).set({ personId: newPerson.id }).where(eq(bookings.id, booking.id));

    const provider = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "unexpected",
    }));
    const summary = await drainNotificationRetries(pg.db, {
      now: new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000),
      provider: { send: provider },
    });
    expect(summary.failed).toBe(1);
    expect(provider).not.toHaveBeenCalled();
    const [parked] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.id, queued.id));
    expect(parked).toMatchObject({
      status: "failed",
      errorCode: "stale_recipient",
      recipientPersonId: oldPerson.id,
    });
    expect(parked?.payloadSealed).toBe(queued?.payloadSealed);
  });
});
