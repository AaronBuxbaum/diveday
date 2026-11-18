import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { anonymizeDiver } from "@/features/anonymize";
import { setStaffAccountStatus } from "@/features/staff-accounts";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { canPersonErasePersonalData } from "./authz";
import type { AppDb } from "./client";
import { ensureDemoSailsToday } from "./demo-refresh";
import { withErasureCoordinatedBookingSend } from "./erasure-coordinated-send";
import { queueMediaDeletion } from "./media-deletions";
import {
  bookings,
  mediaDeletionAttempts,
  people,
  personRoles,
  shops,
  trips,
  userAccounts,
} from "./schema";
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
    expect(evidenceWasLocked).toBe(false);
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
  it("suppresses a dispatch when the real erasure commits first", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Erasure first", slug: "erasure-first", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner, diver] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner", email: "owner@first.example" },
        { shopId: shop.id, fullName: "Diver", email: "diver@first.example" },
      ])
      .returning();
    if (!owner || !diver) throw new Error("people missing");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
    await pg.db.insert(userAccounts).values({ personId: owner.id, email: "owner@first.example" });
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
      .values({ shopId: shop.id, tripId: trip.id, personId: diver.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking missing");

    let resume!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const erasureReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let transactionCount = 0;
    const connection = pg.connect();
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return (work: Parameters<AppDb["transaction"]>[0]) => {
            const number = ++transactionCount;
            return target.transaction(async (tx) => {
              const result = await work(tx);
              if (number === 1) {
                ready();
                await gate;
              }
              return result;
            });
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const erasure = anonymizeDiver(delayed, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    void erasure.catch(() => undefined);
    const provider = vi.fn(async () => "sent");
    let dispatch: ReturnType<typeof withErasureCoordinatedBookingSend> | undefined;
    let waiting: ReturnType<typeof waitForLockWaiters> | undefined;
    onTestFinished(async () => {
      resume();
      await Promise.allSettled([
        erasure,
        ...(dispatch ? [dispatch] : []),
        ...(waiting ? [waiting] : []),
      ]);
    });
    try {
      await Promise.race([
        erasureReady,
        erasure.then(() => {
          throw new Error("erasure ended before the commit barrier");
        }),
      ]);
      dispatch = withErasureCoordinatedBookingSend(
        pg.connect(),
        {
          shopId: shop.id,
          bookingId: booking.id,
          expectedPersonId: diver.id,
          expectedTripId: trip.id,
          shopMaterialFence: true,
        },
        provider,
      );
      void dispatch.catch(() => undefined);
      waiting = waitForLockWaiters(pg.db, 1);
      await Promise.race([
        waiting,
        dispatch.then(() => {
          throw new Error("dispatch ended before the erasure committed");
        }),
      ]);
      const waiters = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%"shops"%' and lower(query) like '%for share%'`);
      expect(Number((waiters.rows[0] as { count: number }).count)).toBeGreaterThan(0);
    } finally {
      resume();
    }
    expect(await erasure).toMatchObject({ ok: true });
    expect(await dispatch).toBeNull();
    expect(provider).not.toHaveBeenCalled();
    const [after] = await pg.db
      .select({ anonymizedAt: people.anonymizedAt })
      .from(people)
      .where(eq(people.id, diver.id));
    expect(after?.anonymizedAt).toBeInstanceOf(Date);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, booking.id))).toHaveLength(1);
  });

  it("rechecks owner authorization after waiting for the shop", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Erasure retry auth", slug: "erasure-retry-auth", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner, otherOwner, diver] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner", email: "owner@retry.example" },
        { shopId: shop.id, fullName: "Other owner", email: "other@retry.example" },
        { shopId: shop.id, fullName: "Diver", email: "diver@retry.example" },
      ])
      .returning();
    if (!owner || !otherOwner || !diver) throw new Error("people missing");
    await pg.db.insert(personRoles).values([
      { personId: owner.id, role: "owner" },
      { personId: otherOwner.id, role: "owner" },
    ]);
    const [account] = await pg.db
      .insert(userAccounts)
      .values({ personId: owner.id, email: "owner@retry.example" })
      .returning();
    await pg.db
      .insert(userAccounts)
      .values({ personId: otherOwner.id, email: "other@retry.example" });
    if (!account) throw new Error("account missing");
    expect(await canPersonErasePersonalData(pg.db, shop.id, owner.id)).toBe(true);
    const before = await pg.db.select().from(people).where(eq(people.id, diver.id));
    const beforeShop = await pg.db.select().from(shops).where(eq(shops.id, shop.id));
    const held = await holdRowLock(pg, sql`select id from shops where id = ${shop.id} for share`);
    let resume!: () => void;
    let waited!: () => void;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const waitCommitted = new Promise<void>((resolve) => {
      waited = resolve;
    });
    let transactionCount = 0;
    const connection = pg.connect();
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (work: Parameters<AppDb["transaction"]>[0]) => {
            const number = ++transactionCount;
            const result = await target.transaction(work);
            if (number === 2) {
              waited();
              await gate;
            }
            return result;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const erasure = anonymizeDiver(delayed, {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
    void erasure.catch(() => undefined);
    onTestFinished(async () => {
      resume();
      await held.release();
      await Promise.allSettled([erasure]);
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      const waiters = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%"shops"%' and lower(query) like '%for no key update%'`);
      expect(Number((waiters.rows[0] as { count: number }).count)).toBeGreaterThan(0);
      await held.release();
      await Promise.race([
        waitCommitted,
        erasure.then(() => {
          throw new Error("erasure finished before the retry barrier");
        }),
      ]);
      expect(
        await setStaffAccountStatus(pg.connect(), {
          shopId: shop.id,
          personId: owner.id,
          userAccountId: account.id,
          status: "disabled",
        }),
      ).toEqual({ ok: true });
      expect(await canPersonErasePersonalData(pg.db, shop.id, owner.id)).toBe(false);
    } finally {
      resume();
      await held.release();
    }
    expect(await erasure).toEqual({ ok: false, reason: "not_authorized" });
    expect(await pg.db.select().from(people).where(eq(people.id, diver.id))).toEqual(before);
    expect(await pg.db.select().from(shops).where(eq(shops.id, shop.id))).toEqual(beforeShop);
  });

  it("reports a held shop as busy without erasing or calling providers", async () => {
    const pg = await postgresTestDb();
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: "Busy erasure", slug: "busy-erasure", timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop missing");
    const [owner, diver] = await pg.db
      .insert(people)
      .values([
        { shopId: shop.id, fullName: "Owner", email: "owner@busy.example" },
        { shopId: shop.id, fullName: "Diver", email: "diver@busy.example" },
      ])
      .returning();
    if (!owner || !diver) throw new Error("people missing");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });
    await pg.db.insert(userAccounts).values({ personId: owner.id, email: "owner@busy.example" });
    const pending = await queueMediaDeletion(pg.db, {
      shopId: shop.id,
      personId: diver.id,
      kind: "recap_photo",
      url: "https://diveday-media.s3.us-east-1.amazonaws.com/recap/busy.jpg",
    });
    if (!pending) throw new Error("media deletion fixture missing");
    const beforeShop = await pg.db.select().from(shops).where(eq(shops.id, shop.id));
    const beforeDiver = await pg.db.select().from(people).where(eq(people.id, diver.id));
    const beforeMedia = await pg.db
      .select()
      .from(mediaDeletionAttempts)
      .where(eq(mediaDeletionAttempts.id, pending.id));
    const held = await holdRowLock(pg, sql`select id from shops where id = ${shop.id} for share`);
    const deleteCustomer = vi.fn(async () => ({ status: "deleted" as const }));
    const mediaDeleteFn = vi.fn(async () => ({ ok: true as const }));
    try {
      const result = await anonymizeDiver(
        pg.connect(),
        { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
        { customerProvider: { deleteCustomer }, mediaDeleteFn },
      );
      expect(result).toEqual({ ok: false, reason: "busy" });
    } finally {
      await held.release();
    }
    expect(await pg.db.select().from(shops).where(eq(shops.id, shop.id))).toEqual(beforeShop);
    expect(await pg.db.select().from(people).where(eq(people.id, diver.id))).toEqual(beforeDiver);
    expect(
      await pg.db
        .select()
        .from(mediaDeletionAttempts)
        .where(eq(mediaDeletionAttempts.id, pending.id)),
    ).toEqual(beforeMedia);
    expect(deleteCustomer).not.toHaveBeenCalled();
    expect(mediaDeleteFn).not.toHaveBeenCalled();
    const retried = await anonymizeDiver(
      pg.connect(),
      { shopId: shop.id, personId: diver.id, actorPersonId: owner.id },
      { customerProvider: { deleteCustomer }, mediaDeleteFn },
    );
    expect(retried).toMatchObject({ ok: true, alreadyAnonymized: false });
    expect(mediaDeleteFn).toHaveBeenCalledTimes(1);
  });

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

    await pg.db.transaction(async (tx) => {
      await expect(
        anonymizeDiver(tx as unknown as AppDb, {
          shopId: shop.id,
          personId: diver.id,
          actorPersonId: owner.id,
        }),
      ).rejects.toThrow("Erasure requires a root transaction");
      const [unchanged] = await tx
        .select({ anonymizedAt: people.anonymizedAt })
        .from(people)
        .where(eq(people.id, diver.id));
      expect(unchanged?.anonymizedAt).toBeNull();
    });

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
    let evidenceWasLocked: boolean | undefined;
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
      evidenceWasLocked = !(await pg.connect().transaction(async (tx) => {
        const result = await tx.execute(sql`select pg_try_advisory_xact_lock_shared(
          hashtext('boarding_certification_evidence'), hashtext(${shop.id})) as acquired`);
        return (result.rows[0] as { acquired: boolean }).acquired;
      }));
    } finally {
      release();
      if (waiting) await waiting.catch(() => undefined);
    }
    expect(evidenceWasLocked).toBe(false);
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
