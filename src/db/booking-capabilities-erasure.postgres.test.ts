import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import {
  drainNotificationRetries,
  sendAndRecordNotification,
  sendClaimedSeatConfirmation,
  sendNotification,
} from "./notifications";
import {
  bookingCapabilities,
  bookings,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  people,
  shops,
  trips,
  waiverDeliveries,
  waiverRecords,
  waiverTemplates,
} from "./schema";
import { issueAndDeliverWaiver } from "./waiver-issue";

async function waitForStage<T>(promise: Promise<T>, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${stage}`)), 8_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function confirmationFixture(pg: Awaited<ReturnType<typeof postgresTestDb>>, suffix: string) {
  const [shop] = await pg.db
    .insert(shops)
    .values({
      name: `Confirmation race ${suffix}`,
      slug: `confirmation-race-${suffix}`,
      timezone: "UTC",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const now = nowDate();
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Confirmation test",
      startsAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 52 * 60 * 60 * 1000),
      capacity: 2,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [person] = await pg.db
    .insert(people)
    .values({
      shopId: shop.id,
      fullName: "Confirmation Diver",
      email: `confirm-${suffix}@example.org`,
    })
    .returning();
  if (!person) throw new Error("person insert returned no row");
  const [booking] = await pg.db
    .insert(bookings)
    .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
    .returning();
  if (!booking) throw new Error("booking insert returned no row");
  return { shop, trip, person, booking, now };
}

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
    let erasure: Promise<void> | undefined;
    try {
      // Let the send acquire the evidence and person fences before erasure
      // attempts its update; otherwise a slow runner can schedule erasure first.
      await waitForStage(providerStarted, "provider callback start");
      erasure = pg.connect().transaction(async (tx) => {
        signalErasure();
        await tx
          .update(people)
          .set({ anonymizedAt: new Date(now.getTime() + 1), deletedAt: new Date(now.getTime() + 1) })
          .where(and(eq(people.id, person.id), eq(people.shopId, shop.id)));
      });
      await waitForStage(erasureStarted, "erasure transaction start");
      await waitForStage(waitForLockWaiters(pg.db, 1), "erasure waiting on send fence");
      releaseProvider();
      await waitForStage(send, "provider result and normal tracking commit");
      await waitForStage(erasure, "erasure commit");
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
      await erasure?.catch(() => undefined);
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

  it("parks a claimed retry when its booking was repointed and clears the sealed payload", async () => {
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
      recipientPersonId: null,
      payloadSealed: null,
    });
  });

  it("sends and tracks a normal stored booking confirmation inside the subject fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, booking } = await confirmationFixture(pg, suffix);
    const provider = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: `confirmation-${suffix}`,
    }));

    const delivery = await sendClaimedSeatConfirmation(pg.db, shop.id, booking.id, {
      send: provider,
    });

    expect(delivery).toEqual({ status: "sent", providerMessageId: `confirmation-${suffix}` });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      kind: "booking_confirmation",
      to: person.email,
      readinessUrl: expect.stringContaining("/ready/"),
    });
    expect(
      await pg.db
        .select()
        .from(bookingCapabilities)
        .where(
          and(
            eq(bookingCapabilities.bookingId, booking.id),
            eq(bookingCapabilities.delivered, true),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(notificationDeliveries)
        .where(eq(notificationDeliveries.bookingId, booking.id)),
    ).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(notificationDeliveryAttempts)
        .where(eq(notificationDeliveryAttempts.bookingId, booking.id)),
    ).toHaveLength(1);
  });

  it("suppresses a stored confirmation when a repoint wins after its initial snapshot", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, booking } = await confirmationFixture(pg, suffix);
    const [replacement] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Replacement Diver",
        email: `replacement-${suffix}@example.org`,
      })
      .returning();
    if (!replacement) throw new Error("replacement insert returned no row");

    let releaseRepoint!: () => void;
    let signalRepoint!: () => void;
    const repointGate = new Promise<void>((resolve) => (releaseRepoint = resolve));
    const repointStarted = new Promise<void>((resolve) => (signalRepoint = resolve));
    const repointDb = pg.connect();
    const repoint = repointDb.transaction(async (tx) => {
      await tx
        .update(bookings)
        .set({ personId: replacement.id })
        .where(eq(bookings.id, booking.id));
      signalRepoint();
      await repointGate;
    });
    const provider = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "unexpected",
    }));
    let send: ReturnType<typeof sendClaimedSeatConfirmation> | undefined;
    try {
      await repointStarted;
      send = sendClaimedSeatConfirmation(pg.db, shop.id, booking.id, { send: provider });
      await waitForLockWaiters(pg.db, 1);
      releaseRepoint();
      await repoint;
      await expect(send).resolves.toBeNull();
      expect(provider).not.toHaveBeenCalled();
      expect(
        await pg.db
          .select()
          .from(bookingCapabilities)
          .where(eq(bookingCapabilities.bookingId, booking.id)),
      ).toHaveLength(0);
      expect(
        await pg.db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.bookingId, booking.id)),
      ).toHaveLength(0);
      expect(person.email).not.toBe(replacement.email);
    } finally {
      releaseRepoint();
      await repoint.catch(() => undefined);
      await send?.catch(() => undefined);
    }
  });

  it("suppresses a stored confirmation when erasure wins before the send fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, booking, now } = await confirmationFixture(pg, suffix);
    let releaseErasure!: () => void;
    let signalErasure!: () => void;
    const erasureGate = new Promise<void>((resolve) => (releaseErasure = resolve));
    const erasureStarted = new Promise<void>((resolve) => (signalErasure = resolve));
    const erasureDb = pg.connect();
    const erasure = erasureDb.transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
      signalErasure();
      await erasureGate;
      const erasedAt = new Date(now.getTime() + 1);
      await tx
        .update(people)
        .set({ anonymizedAt: erasedAt, deletedAt: erasedAt })
        .where(eq(people.id, person.id));
    });
    const provider = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "unexpected",
    }));
    let send: ReturnType<typeof sendClaimedSeatConfirmation> | undefined;
    try {
      await erasureStarted;
      send = sendClaimedSeatConfirmation(pg.db, shop.id, booking.id, { send: provider });
      await waitForLockWaiters(pg.db, 1);
      releaseErasure();
      await erasure;
      await expect(send).resolves.toBeNull();
      expect(provider).not.toHaveBeenCalled();
      expect(
        await pg.db
          .select()
          .from(bookingCapabilities)
          .where(eq(bookingCapabilities.bookingId, booking.id)),
      ).toHaveLength(0);
      expect(
        await pg.db
          .select()
          .from(notificationDeliveries)
          .where(eq(notificationDeliveries.bookingId, booking.id)),
      ).toHaveLength(0);
    } finally {
      releaseErasure();
      await erasure.catch(() => undefined);
      await send?.catch(() => undefined);
    }
  });

  it("sends a booking waiver and records its delivery inside the subject fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, booking } = await confirmationFixture(pg, suffix);
    const [template] = await pg.db
      .insert(waiverTemplates)
      .values({ shopId: shop.id, title: "Release", version: 1, body: "Release terms." })
      .returning();
    if (!template) throw new Error("waiver template insert returned no row");
    const provider = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: `waiver-${suffix}`,
    }));

    const result = await issueAndDeliverWaiver(pg.db, shop.id, booking.id, {
      provider: { send: provider },
    });

    expect(result).toMatchObject({ ok: true, bookingId: booking.id, delivery: "sent" });
    expect(provider).toHaveBeenCalledTimes(1);
    expect(provider.mock.calls[0]?.[0]).toMatchObject({
      kind: "waiver_request",
      to: person.email,
      completionUrl: expect.stringContaining("/waivers/"),
    });
    expect(
      await pg.db
        .select()
        .from(waiverRecords)
        .where(and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.personId, person.id))),
    ).toHaveLength(1);
    expect(
      await pg.db.select().from(waiverDeliveries).where(eq(waiverDeliveries.shopId, shop.id)),
    ).toHaveLength(1);
  });

  it("does not issue or send a booking waiver when erasure wins the fence", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const { shop, person, booking, now } = await confirmationFixture(pg, suffix);
    const [template] = await pg.db
      .insert(waiverTemplates)
      .values({ shopId: shop.id, title: "Release", version: 1, body: "Release terms." })
      .returning();
    if (!template) throw new Error("waiver template insert returned no row");
    let releaseErasure!: () => void;
    let signalErasure!: () => void;
    const erasureGate = new Promise<void>((resolve) => (releaseErasure = resolve));
    const erasureStarted = new Promise<void>((resolve) => (signalErasure = resolve));
    const erasureDb = pg.connect();
    const erasure = erasureDb.transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shop.id, "rewrite");
      signalErasure();
      await erasureGate;
      const erasedAt = new Date(now.getTime() + 1);
      await tx
        .update(people)
        .set({ anonymizedAt: erasedAt, deletedAt: erasedAt })
        .where(eq(people.id, person.id));
    });
    const provider = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "sent",
      providerMessageId: "unexpected",
    }));
    let issue: ReturnType<typeof issueAndDeliverWaiver> | undefined;
    try {
      await erasureStarted;
      issue = issueAndDeliverWaiver(pg.db, shop.id, booking.id, {
        provider: { send: provider },
      });
      await waitForLockWaiters(pg.db, 1);
      releaseErasure();
      await erasure;
      await expect(issue).resolves.toMatchObject({ ok: false, reason: "error" });
      expect(provider).not.toHaveBeenCalled();
      expect(await pg.db.select().from(waiverRecords)).toHaveLength(0);
      expect(await pg.db.select().from(waiverDeliveries)).toHaveLength(0);
    } finally {
      releaseErasure();
      await erasure.catch(() => undefined);
      await issue?.catch(() => undefined);
    }
  });
});
