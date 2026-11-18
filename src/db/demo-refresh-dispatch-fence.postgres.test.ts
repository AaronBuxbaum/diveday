import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { anonymizeDiver } from "@/features/anonymize";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { ensureDemoSailsToday } from "./demo-refresh";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { bookings, people, personRoles, shops, trips, userAccounts } from "./schema";
import { lockTripRevisionNotificationFence } from "./trip-revision-notification-fence";

describePostgres("demo refresh and coordinated dispatch lock order", () => {
  it("lets a dispatch and the today nudge finish without a lock cycle", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: "Demo lock order",
        slug: "demo-refresh-lock-order",
        timezone: "UTC",
        isDemo: true,
      })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Demo owner",
        email: "owner@lock-order.demo.invalid",
      })
      .returning();
    if (!owner) throw new Error("owner missing");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
    await pg.db
      .insert(userAccounts)
      .values({ personId: owner.id, email: "owner@lock-order.demo.invalid" });
    const now = new Date("2026-03-01T12:00:00Z");
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Future boat",
        startsAt: new Date("2026-03-02T12:00:00Z"),
        endsAt: new Date("2026-03-02T16:00:00Z"),
        capacity: 10,
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    const [booking] = await pg.db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: owner.id,
        bookedAs: "diver",
      })
      .returning();
    if (!booking) throw new Error("booking missing");

    let release!: () => void;
    let ready!: () => void;
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatchLocked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const dispatch = pg.connect().transaction(async (tx) => {
      await lockTripRevisionNotificationFence(tx, shop.id, trip.id, "dispatch");
      ready();
      await resume;
      return withErasureCoordinatedBookingSend(
        tx,
        {
          shopId: shop.id,
          bookingId: booking.id,
          expectedPersonId: owner.id,
          expectedTripId: trip.id,
          tripRevisionFence: true,
        },
        async () => "sent",
      );
    });
    void dispatch.catch(() => undefined);
    let nudge: ReturnType<typeof ensureDemoSailsToday> | undefined;
    let waiting: Promise<unknown> | undefined;
    let evidenceWasLocked: boolean | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([
        dispatch,
        ...(nudge ? [nudge] : []),
        ...(waiting ? [waiting] : []),
      ]);
    });
    try {
      await Promise.race([
        dispatchLocked,
        dispatch.then(() => {
          throw new Error("dispatch ended before barrier");
        }),
      ]);
      nudge = ensureDemoSailsToday(pg.connect(), shop.id, "UTC", now);
      void nudge.catch(() => undefined);
      waiting = waitForLockWaiters(pg.db, 1);
      await Promise.race([
        waiting,
        nudge.then(() => {
          throw new Error("nudge did not wait on dispatch");
        }),
      ]);
      const waiters = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%pg_advisory_xact_lock(%trip_revision_notification%'`);
      expect(Number((waiters.rows[0] as { count: number }).count)).toBeGreaterThan(0);
      const probe = await pg.connect().transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '1s'`);
        const result = await tx.execute(sql`select pg_try_advisory_xact_lock_shared(
          hashtext('boarding_certification_evidence'), hashtext(${shop.id})) as acquired`);
        return (result.rows[0] as { acquired: boolean }).acquired;
      });
      evidenceWasLocked = !probe;
    } finally {
      release();
      if (waiting) await waiting.catch(() => undefined);
    }
    expect(await dispatch, `evidence locked while nudge waited: ${String(evidenceWasLocked)}`).toBe(
      "sent",
    );
    expect(await nudge).toBe("moved");
    const [afterTrip] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
    expect(afterTrip?.startsAt).not.toEqual(trip.startsAt);
    expect(afterTrip?.revision).toBe(trip.revision + 1);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, booking.id))).toEqual([
      booking,
    ]);
  });
});

describePostgres("erasure and an older shop-first dispatch", () => {
  it("finishes without a lock cycle or a send after erasure commits", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({
        name: "Erasure lock order",
        slug: "erasure-material-order",
        timezone: "UTC",
      })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner, diver] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner", email: "owner@order.example" },
        { shopId: shop.id, fullName: "Diver", email: "diver@order.example" },
      ])
      .returning();
    if (!owner || !diver) throw new Error("people missing");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
    await pg.db.insert(userAccounts).values({ personId: owner.id, email: "owner@order.example" });
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Future boat",
        startsAt: new Date("2026-03-02T12:00:00Z"),
        endsAt: new Date("2026-03-02T16:00:00Z"),
        capacity: 10,
      })
      .returning();
    if (!trip) throw new Error("trip missing");
    const [booking] = await pg.db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        personId: diver.id,
        bookedAs: "diver",
      })
      .returning();
    if (!booking) throw new Error("booking missing");

    let release!: () => void;
    let ready!: () => void;
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const shopLocked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const events: string[] = [];
    // Models a still-running older caller which acquired the shop material lock
    // before entering the coordinator. Do not remove until old writers drain.
    const dispatch = pg.connect().transaction(async (tx) => {
      await tx.select({ id: shops.id }).from(shops).where(eq(shops.id, shop.id)).for("share");
      ready();
      await resume;
      return withErasureCoordinatedBookingSend(
        tx,
        {
          shopId: shop.id,
          bookingId: booking.id,
          expectedPersonId: diver.id,
          expectedTripId: trip.id,
          shopMaterialFence: true,
        },
        async (tx) => {
          const [subject] = await tx
            .select({ shopId: people.shopId, anonymizedAt: people.anonymizedAt })
            .from(people)
            .where(eq(people.id, diver.id));
          expect(subject).toEqual({ shopId: shop.id, anonymizedAt: null });
          events.push("sent");
          return "sent";
        },
      );
    });
    void dispatch.catch(() => undefined);
    let erasure: ReturnType<typeof anonymizeDiver> | undefined;
    let waiting: Promise<unknown> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([
        dispatch,
        ...(erasure ? [erasure] : []),
        ...(waiting ? [waiting] : []),
      ]);
    });
    try {
      await Promise.race([
        shopLocked,
        dispatch.then(() => {
          throw new Error("dispatch ended before barrier");
        }),
      ]);
      erasure = anonymizeDiver(pg.connect(), {
        shopId: shop.id,
        personId: diver.id,
        actorPersonId: owner.id,
      }).then((outcome) => {
        if (outcome.ok) events.push("erased");
        return outcome;
      });
      void erasure.catch(() => undefined);
      waiting = waitForLockWaiters(pg.db, 1);
      await Promise.race([
        waiting,
        erasure.then(() => {
          throw new Error("erasure ended before waiting on shop");
        }),
      ]);
      const waiters = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%"shops"%'`);
      expect(Number((waiters.rows[0] as { count: number }).count)).toBeGreaterThan(0);
    } finally {
      release();
      if (waiting) await waiting.catch(() => undefined);
    }
    const delivery = await dispatch;
    expect(await erasure).toMatchObject({ ok: true });
    if (delivery === "sent") expect(events).toEqual(["sent", "erased"]);
    else {
      expect(delivery).toBeNull();
      expect(events).toEqual(["erased"]);
    }
    const [after] = await pg.db
      .select({ id: people.id, shopId: people.shopId, anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, diver.id));
    expect(after).toMatchObject({ id: diver.id, shopId: shop.id });
    expect(after?.anonymizedAt).toBeInstanceOf(Date);
    expect(
      await pg.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, booking.id)),
    ).toEqual([{ id: booking.id }]);
  });
});
