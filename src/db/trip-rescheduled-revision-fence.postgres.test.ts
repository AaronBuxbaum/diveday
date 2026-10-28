import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { HOUR_MS, nowDate } from "@/lib/clock";
import type { NotificationProvider } from "@/lib/notifications";
import { fakeEmail } from "@/test/fakes";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { cancelDeparture } from "./aboard-at-sea";
import { confirmBookingIdentity, createBooking } from "./bookings";
import { claimDueHeldSends } from "./held-sends";
import { bookings, heldSends, people, shops, tripScheduleDays, trips } from "./schema";
import { holdRescheduleNotice, sendRescheduleNotices } from "./trip-rescheduled";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";
import { createTrip, moveTrip } from "./trips";
import { cancelDeparturesBelowMinimum } from "./trips-minimum";
import { setTripStatus, updateTrip } from "./trips-record";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function fixture() {
  const pg = await postgresTestDb();
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await pg.db
    .insert(shops)
    .values({
      name: `Held reschedule ${suffix}`,
      slug: `held-reschedule-${suffix}`,
      timezone: "UTC",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");

  const now = nowDate();
  const previousStartsAt = new Date(now.getTime() + 8 * 24 * HOUR_MS);
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Held reschedule race",
    startsAt: new Date(previousStartsAt.getTime() + HOUR_MS),
    endsAt: new Date(previousStartsAt.getTime() + 5 * HOUR_MS),
    capacity: 2,
  });
  if (!trip) throw new Error("trip insert returned no row");
  const booking = await createBooking(pg.db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Race Diver",
    email: `race-${suffix}@example.com`,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return { pg, shop, trip, booking, now, previousStartsAt };
}

async function claimRescheduleFixture(input: Awaited<ReturnType<typeof fixture>>) {
  await input.pg.db.insert(heldSends).values({
    shopId: input.shop.id,
    kind: "trip_rescheduled",
    payload: {
      kind: "trip_rescheduled",
      tripId: input.trip.id,
      previousStartsAt: input.previousStartsAt.toISOString(),
      meetingPointMoved: false,
    },
    actorPersonId: null,
    runAt: new Date(input.now.getTime() - 1),
  });
  const [claimed] = await claimDueHeldSends(input.pg.db, input.now);
  if (claimed?.kind !== "trip_rescheduled") throw new Error("held row was not claimed");
  const payload = claimed.payload;
  if (payload.kind !== "trip_rescheduled") throw new Error("claimed payload was not a reschedule");
  return payload;
}

describePostgres("initial held reschedule revision fence", () => {
  it("records an identity-held-only obligation and sends it to the resolved booking person", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    await pg.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.bookingId));
    const held = await holdRescheduleNotice(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      movedFrom: previousStartsAt,
      actorPersonId: null,
      now,
    });
    expect(held).toBeNull();
    const [missed] = await pg.db
      .select({ from: bookings.rescheduleMissedFrom })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    expect(missed?.from).toEqual(previousStartsAt);
    const [currentTrip] = await pg.db
      .select({ toldStartsAt: trips.diversToldStartsAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    expect(currentTrip?.toldStartsAt).toBeNull();
    expect(
      await pg.db
        .select({ id: heldSends.id })
        .from(heldSends)
        .where(eq(heldSends.kind, "trip_rescheduled")),
    ).toEqual([]);

    const { provider, sent } = fakeEmail();
    const [resolvedPerson] = await pg.db
      .select({ email: people.email })
      .from(people)
      .where(eq(people.id, booking.personId));
    await confirmBookingIdentity(
      pg.db,
      {
        shopId: shop.id,
        bookingId: booking.bookingId,
        actorPersonId: booking.personId,
      },
      {
        now,
        emailProvider: provider,
        appOrigin: "https://diveday.example",
        whatsAppProviders: new Map(),
      },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: resolvedPerson?.email });
    const [after] = await pg.db
      .select({ from: bookings.rescheduleMissedFrom })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    expect(after?.from).toBeNull();
  });

  it("does not create identity-held obligations for an empty, past, or rehearsal departure", async () => {
    for (const kind of ["empty", "past", "rehearsal"] as const) {
      const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
      await pg.db
        .update(bookings)
        .set({
          identityUnconfirmedAt: now,
          ...(kind === "empty" ? { status: "cancelled" as const } : {}),
        })
        .where(eq(bookings.id, booking.bookingId));
      if (kind === "past") {
        const pastStartsAt = new Date(now.getTime() - HOUR_MS);
        await pg.db
          .update(trips)
          .set({ startsAt: pastStartsAt, endsAt: now })
          .where(eq(trips.id, trip.id));
        await pg.db
          .update(tripScheduleDays)
          .set({ startsAt: pastStartsAt, endsAt: now })
          .where(eq(tripScheduleDays.tripId, trip.id));
      }
      if (kind === "rehearsal") {
        await pg.db
          .update(trips)
          .set({ isRehearsal: true, isPrivate: true })
          .where(eq(trips.id, trip.id));
      }
      await holdRescheduleNotice(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: previousStartsAt,
        actorPersonId: null,
        now,
      });
      const [current] = await pg.db
        .select({ from: bookings.rescheduleMissedFrom })
        .from(bookings)
        .where(eq(bookings.id, booking.bookingId));
      expect(current?.from, kind).toBeNull();
    }
  });

  it("waits behind a booking identity lock, then queues the now-settled diver", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    await pg.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.bookingId));
    const lockHeld = barrier();
    const releaseBooking = barrier();
    const confirmationLock = pg.connect().transaction(async (tx) => {
      await tx
        .select({ id: bookings.id })
        .from(bookings)
        .where(eq(bookings.id, booking.bookingId))
        .for("update");
      await tx
        .update(bookings)
        .set({ identityUnconfirmedAt: null })
        .where(eq(bookings.id, booking.bookingId));
      lockHeld.resolve();
      await releaseBooking.promise;
    });
    let hold: ReturnType<typeof holdRescheduleNotice> | undefined;
    try {
      await lockHeld.promise;
      hold = holdRescheduleNotice(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: previousStartsAt,
        actorPersonId: null,
        now,
      });
      await waitForLockWaiters(pg.db, 1, 2_000);
    } finally {
      releaseBooking.resolve();
      await confirmationLock;
    }
    await expect(hold).resolves.toMatchObject({ told: 1 });
    const [current] = await pg.db
      .select({ from: bookings.rescheduleMissedFrom })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    expect(current?.from).toBeNull();
    expect(
      await pg.db
        .select({ id: heldSends.id })
        .from(heldSends)
        .where(eq(heldSends.kind, "trip_rescheduled")),
    ).toHaveLength(1);
  });

  it("does not mark an identity-held seat after cancellation wins the hold fence", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    await pg.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.bookingId));
    const writerReady = barrier();
    const releaseWriter = barrier();
    const cancel = pg.connect().transaction(async (tx) => {
      await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "revision-write");
      await setTripStatus(tx, shop.id, trip.id, "cancelled", now);
      writerReady.resolve();
      await releaseWriter.promise;
    });
    let hold: ReturnType<typeof holdRescheduleNotice> | undefined;
    try {
      await writerReady.promise;
      hold = holdRescheduleNotice(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: previousStartsAt,
        actorPersonId: null,
        now,
      });
      await waitForLockWaiters(pg.db, 1, 2_000);
    } finally {
      releaseWriter.resolve();
      await cancel;
    }
    await expect(hold).resolves.toBeNull();
    const [current] = await pg.db
      .select({ from: bookings.rescheduleMissedFrom })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    expect(current?.from).toBeNull();
  });

  it("makes the minimum sweep wait for an in-flight reschedule send", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });
    const startsAt = new Date(now.getTime() + 12 * HOUR_MS);
    await pg.db
      .update(trips)
      .set({
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
        minimumBookings: 2,
        minimumDecisionHours: 24,
        revision: sql`${trips.revision} + 1`,
      })
      .where(eq(trips.id, trip.id));
    const providerEntered = barrier();
    const releaseProvider = barrier();
    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        providerEntered.resolve();
        await releaseProvider.promise;
        return { status: "sent", providerMessageId: "sent-before-minimum-cancel" };
      },
    };
    const send = sendRescheduleNotices(pg.connect(), shop.id, payload, {
      now,
      emailProvider: provider,
      appOrigin: "https://diveday.example",
      whatsAppProviders: new Map(),
    });
    await providerEntered.promise;
    let sweepFinished = false;
    const sweep = cancelDeparturesBelowMinimum(pg.connect(), { now }).then((result) => {
      sweepFinished = true;
      return result;
    });
    try {
      await waitForLockWaiters(pg.db, 1, 2_000);
      expect(sweepFinished).toBe(false);
    } finally {
      releaseProvider.resolve();
    }
    await expect(send).resolves.toMatchObject({ told: 1, failed: 0 });
    const result = await sweep;
    expect(result.cancelled.map((row) => row.tripId)).toContain(trip.id);
    expect(providerCalls).toBe(1);
  });

  it("does not record an identity-held miss after cancellation wins the revision fence", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    await pg.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.bookingId));
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });
    const writerReady = barrier();
    const releaseWriter = barrier();
    const cancel = pg.connect().transaction(async (tx) => {
      await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "revision-write");
      await setTripStatus(tx, shop.id, trip.id, "cancelled", now);
      writerReady.resolve();
      await releaseWriter.promise;
    });
    let send: ReturnType<typeof sendRescheduleNotices> | undefined;
    try {
      await writerReady.promise;
      send = sendRescheduleNotices(pg.connect(), shop.id, payload, { now });
      await waitForLockWaiters(pg.db, 1, 2_000);
    } finally {
      releaseWriter.resolve();
      await cancel;
    }
    await expect(send).resolves.toMatchObject({ told: 0, failed: 0, identityHeld: 0 });
    const [current] = await pg.db
      .select({ rescheduleMissedFrom: bookings.rescheduleMissedFrom })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    expect(current?.rescheduleMissedFrom).toBeNull();
  });

  it("suppresses a reschedule when a fenced cancellation commits before dispatch", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });
    const writerReady = barrier();
    const releaseWriter = barrier();
    const cancel = pg.connect().transaction(async (tx) => {
      await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "revision-write");
      await tx.update(trips).set({ status: "cancelled" }).where(eq(trips.id, trip.id));
      writerReady.resolve();
      await releaseWriter.promise;
    });
    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send-cancelled-trip" };
      },
    };
    let send: ReturnType<typeof sendRescheduleNotices> | undefined;
    try {
      await writerReady.promise;
      send = sendRescheduleNotices(pg.connect(), shop.id, payload, {
        now,
        emailProvider: provider,
        appOrigin: "https://diveday.example",
        whatsAppProviders: new Map(),
      });
      await waitForLockWaiters(pg.db, 1, 2_000);
    } finally {
      releaseWriter.resolve();
      await cancel;
    }
    await expect(send).resolves.toMatchObject({ told: 0, failed: 0 });
    expect(providerCalls).toBe(0);
  });

  it("makes cancellation wait for an in-flight current-revision reschedule send", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });
    const providerEntered = barrier();
    const releaseProvider = barrier();
    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        providerEntered.resolve();
        await releaseProvider.promise;
        return { status: "sent", providerMessageId: "sent-before-cancellation" };
      },
    };
    const send = sendRescheduleNotices(pg.connect(), shop.id, payload, {
      now,
      emailProvider: provider,
      appOrigin: "https://diveday.example",
      whatsAppProviders: new Map(),
    });
    await providerEntered.promise;
    let cancelFinished = false;
    const cancel = cancelDeparture(pg.connect(), shop.id, trip.id, now).then((result) => {
      cancelFinished = true;
      return result;
    });
    try {
      await waitForLockWaiters(pg.db, 1, 2_000);
      expect(cancelFinished).toBe(false);
    } finally {
      releaseProvider.resolve();
    }
    await expect(send).resolves.toMatchObject({ told: 1, failed: 0 });
    await expect(cancel).resolves.toEqual({ ok: true });
    expect(providerCalls).toBe(1);
  });

  it("requeues rather than sending a pre-fence trip snapshot after a newer move", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    // This is the held row the cron has claimed before starting its dispatch.
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });

    const writerReady = barrier();
    const releaseWriter = barrier();
    const move = pg.connect().transaction(async (tx) => {
      await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "revision-write");
      await tx
        .update(trips)
        .set({
          startsAt: new Date(trip.startsAt.getTime() + HOUR_MS),
          endsAt: new Date(trip.endsAt.getTime() + HOUR_MS),
          revision: sql`${trips.revision} + 1`,
        })
        .where(and(eq(trips.id, trip.id), eq(trips.shopId, shop.id)));
      writerReady.resolve();
      await releaseWriter.promise;
    });

    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send-old-held-snapshot" };
      },
    };
    let send: ReturnType<typeof sendRescheduleNotices> | undefined;
    try {
      await writerReady.promise;
      send = sendRescheduleNotices(pg.connect(), shop.id, payload, {
        now,
        emailProvider: provider,
        appOrigin: "https://diveday.example",
        whatsAppProviders: new Map(),
      });
      // The sender reads the old committed row while the newer move is
      // uncommitted, then must wait on the shared advisory fence before send.
      await waitForLockWaiters(pg.db, 1, 2_000);
    } finally {
      releaseWriter.resolve();
      await move;
    }

    await expect(send).resolves.toMatchObject({ told: 0, failed: 0 });
    expect(providerCalls).toBe(0);
    const [current] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    expect(current?.revision).toBe(trip.revision + 1);
    // The stale claimed row is replaced with a fresh hold carrying the same
    // last-told start, so a later dispatch can tell divers the current time.
    const [reheld] = await pg.db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(reheld?.payload).toMatchObject({
      kind: "trip_rescheduled",
      tripId: trip.id,
      previousStartsAt: previousStartsAt.toISOString(),
    });
  });

  it("requeues when the shop fallback locale changes before dispatch takes its fence", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });
    const localeUpdateReady = barrier();
    const releaseLocaleUpdate = barrier();
    const updateLocale = pg.connect().transaction(async (tx) => {
      await tx.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
      localeUpdateReady.resolve();
      await releaseLocaleUpdate.promise;
    });

    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send-old-locale" };
      },
    };
    let send: ReturnType<typeof sendRescheduleNotices> | undefined;
    try {
      await localeUpdateReady.promise;
      send = sendRescheduleNotices(pg.connect(), shop.id, payload, {
        now,
        emailProvider: provider,
        appOrigin: "https://diveday.example",
        whatsAppProviders: new Map(),
      });
      // Initial reads see the old committed locale; the shop material fence
      // must wait for the update before deciding which fallback to use.
      await waitForLockWaiters(pg.db, 1, 2_000);
    } finally {
      releaseLocaleUpdate.resolve();
      await updateLocale;
    }

    await expect(send).resolves.toMatchObject({ told: 0, failed: 0 });
    expect(providerCalls).toBe(0);
    const [reheld] = await pg.db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(reheld?.payload).toMatchObject({
      kind: "trip_rescheduled",
      tripId: trip.id,
      previousStartsAt: previousStartsAt.toISOString(),
    });
  });

  it("serializes concurrent staff holds into one per-trip pending send", async () => {
    const { pg, shop, trip, previousStartsAt, now } = await fixture();
    const fenceHeld = barrier();
    const releaseFence = barrier();
    const holdFence = pg.connect().transaction(async (tx) => {
      await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "revision-write");
      fenceHeld.resolve();
      await releaseFence.promise;
    });
    let first: ReturnType<typeof holdRescheduleNotice> | undefined;
    let second: ReturnType<typeof holdRescheduleNotice> | undefined;
    try {
      await fenceHeld.promise;
      first = holdRescheduleNotice(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: previousStartsAt,
        actorPersonId: null,
        now,
      });
      second = holdRescheduleNotice(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: previousStartsAt,
        actorPersonId: null,
        now,
      });
      await waitForLockWaiters(pg.db, 2, 2_000);
    } finally {
      releaseFence.resolve();
      await holdFence;
    }
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ told: 1 }),
      expect.objectContaining({ told: 1 }),
    ]);
    const pending = await pg.db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toMatchObject({
      kind: "trip_rescheduled",
      tripId: trip.id,
      previousStartsAt: previousStartsAt.toISOString(),
    });
  });

  it("preserves the earliest start when O-to-A and A-to-B holds arrive in reverse order", async () => {
    const { pg, shop, trip, now } = await fixture();
    const original = trip.startsAt;
    const atA = new Date(original.getTime() + HOUR_MS);
    const atB = new Date(original.getTime() + 2 * HOUR_MS);

    const firstMove = await updateTrip(
      pg.connect(),
      shop.id,
      trip.id,
      {
        title: trip.title,
        startsAt: atA,
        endsAt: new Date(trip.endsAt.getTime() + HOUR_MS),
        capacity: trip.capacity,
        plannedDives: trip.plannedDives,
      },
      { captureRescheduleStart: true },
    );
    expect(firstMove).toMatchObject({ ok: true, startMoved: true });
    const secondMove = await moveTrip(pg.connect(), shop.id, trip.id, atB, {
      now,
      captureRescheduleStart: true,
    });
    expect(secondMove).toMatchObject({ ok: true, previousStartsAt: atA });

    // The second action reaches hold creation first. The in-transaction marker
    // still names O, so this cannot collapse O→A→B into A→B.
    await holdRescheduleNotice(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      movedFrom: atA,
      actorPersonId: null,
      now,
    });
    await holdRescheduleNotice(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      movedFrom: original,
      actorPersonId: null,
      now,
    });

    const [current] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    expect(current?.diversToldStartsAt).toEqual(original);
    const pending = await pg.db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.payload).toMatchObject({
      kind: "trip_rescheduled",
      tripId: trip.id,
      previousStartsAt: original.toISOString(),
    });
  });

  it("preserves O for an identity-held-only seat when O-to-A and A-to-B holds arrive in reverse order", async () => {
    const { pg, shop, trip, booking, now } = await fixture();
    const original = trip.startsAt;
    const atA = new Date(original.getTime() + HOUR_MS);
    const atB = new Date(original.getTime() + 2 * HOUR_MS);
    await pg.db
      .update(bookings)
      .set({ identityUnconfirmedAt: now })
      .where(eq(bookings.id, booking.bookingId));

    const firstMove = await updateTrip(
      pg.connect(),
      shop.id,
      trip.id,
      {
        title: trip.title,
        startsAt: atA,
        endsAt: new Date(trip.endsAt.getTime() + HOUR_MS),
        capacity: trip.capacity,
        plannedDives: trip.plannedDives,
      },
      { captureRescheduleStart: true },
    );
    expect(firstMove).toMatchObject({ ok: true, startMoved: true });
    const secondMove = await moveTrip(pg.connect(), shop.id, trip.id, atB, {
      now,
      captureRescheduleStart: true,
    });
    expect(secondMove).toMatchObject({ ok: true, previousStartsAt: atA });

    // The B hold arrives first. Identity-held seats are not in the send
    // audience, but the transaction captured O so their per-seat obligation
    // must still name O after both holds reconcile.
    expect(
      await holdRescheduleNotice(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: atA,
        actorPersonId: null,
        now,
      }),
    ).toBeNull();
    expect(
      await holdRescheduleNotice(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        movedFrom: original,
        actorPersonId: null,
        now,
      }),
    ).toBeNull();

    const [currentTrip] = await pg.db
      .select({ toldStartsAt: trips.diversToldStartsAt })
      .from(trips)
      .where(eq(trips.id, trip.id));
    const [currentBooking] = await pg.db
      .select({ missedFrom: bookings.rescheduleMissedFrom })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    expect(currentTrip?.toldStartsAt).toBeNull();
    expect(currentBooking?.missedFrom).toEqual(original);
    expect(await pg.db.select().from(heldSends).where(eq(heldSends.shopId, shop.id))).toHaveLength(
      0,
    );
  });

  it.each(["empty", "rehearsal", "past"] as const)(
    "does not create a new marker for an %s departure",
    async (kind) => {
      const { pg, shop, trip, booking, now } = await fixture();
      if (kind === "empty") {
        await pg.db
          .update(bookings)
          .set({ status: "cancelled" })
          .where(eq(bookings.id, booking.bookingId));
      } else if (kind === "rehearsal") {
        await pg.db
          .update(trips)
          .set({ isRehearsal: true, isPrivate: true })
          .where(eq(trips.id, trip.id));
      }
      const nextStart =
        kind === "past"
          ? new Date(now.getTime() - HOUR_MS)
          : new Date(trip.startsAt.getTime() + HOUR_MS);
      await expect(
        moveTrip(pg.connect(), shop.id, trip.id, nextStart, {
          now,
          captureRescheduleStart: true,
        }),
      ).resolves.toMatchObject({ ok: true });
      const [current] = await pg.db
        .select({ diversToldStartsAt: trips.diversToldStartsAt })
        .from(trips)
        .where(eq(trips.id, trip.id));
      expect(current?.diversToldStartsAt).toBeNull();
    },
  );

  it("re-holds when a live diver's contact changes after the seat scan", async () => {
    const { pg, shop, trip, booking, now, previousStartsAt } = await fixture();
    const payload = await claimRescheduleFixture({
      pg,
      shop,
      trip,
      booking,
      now,
      previousStartsAt,
    });
    const shopUpdateReady = barrier();
    const releaseShopUpdate = barrier();
    const updateShop = pg.connect().transaction(async (tx) => {
      await tx.update(shops).set({ name: shop.name }).where(eq(shops.id, shop.id));
      shopUpdateReady.resolve();
      await releaseShopUpdate.promise;
    });
    let providerCalls = 0;
    const provider: NotificationProvider = {
      async send() {
        providerCalls += 1;
        return { status: "sent", providerMessageId: "must-not-send-scanned-contact" };
      },
    };
    let send: ReturnType<typeof sendRescheduleNotices> | undefined;
    try {
      await shopUpdateReady.promise;
      send = sendRescheduleNotices(pg.connect(), shop.id, payload, {
        now,
        emailProvider: provider,
        appOrigin: "https://diveday.example",
        whatsAppProviders: new Map(),
      });
      // The sender has completed its initial trip/seat scans and is parked
      // before person/booking locks at the shop material fence.
      await waitForLockWaiters(pg.db, 1, 2_000);
      await pg.db
        .update(people)
        .set({ email: `changed-${booking.personId}@example.com` })
        .where(eq(people.id, booking.personId));
    } finally {
      releaseShopUpdate.resolve();
      await updateShop;
    }

    await expect(send).resolves.toMatchObject({ told: 0, failed: 0 });
    expect(providerCalls).toBe(0);
    const [reheld] = await pg.db.select().from(heldSends).where(eq(heldSends.shopId, shop.id));
    expect(reheld?.payload).toMatchObject({
      kind: "trip_rescheduled",
      tripId: trip.id,
      previousStartsAt: previousStartsAt.toISOString(),
    });
  });
});
