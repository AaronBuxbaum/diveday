import { sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import {
  createScratchLedger,
  recordScratchReceipt,
  type ScratchIntent,
} from "@/test/boarding-receipt-prototype/ledger";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";

// Scratch-only experiment. These tables, synthetic identities and hooks do not
// implement authenticated intake, a production receipt, or a reset fix.
const original: ScratchIntent = {
  shopId: "shop-a",
  generationId: "generation-a",
  tripId: "trip-a",
  bookingId: "booking-a",
  actorId: "staff-a",
  eventId: "event-a",
  meeting: { kind: "known", id: "day-a" },
  occurredAt: "2026-11-18T10:00:00.000Z",
};

describePostgres("scratch receipt key reservation", () => {
  it("does not create an orphan when a retry resumes after its winner settled", async () => {
    const pg = await postgresTestDb();
    await createScratchLedger(pg.db);
    let release!: () => void;
    let signal!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lookedUp = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const loser = recordScratchReceipt(pg.connect(), original, {
      afterFirstLookup: async () => {
        signal();
        await held;
      },
    });
    onTestFinished(async () => {
      release();
      await Promise.allSettled([loser]);
    });
    try {
      await Promise.race([
        lookedUp,
        loser.then(() => {
          throw new Error("retry finished before its barrier");
        }),
      ]);
      const winner = await recordScratchReceipt(pg.connect(), original);
      if (!winner.ok) throw new Error("winner not recorded");
      await pg.db.execute(
        sql`update scratch_observation set state = 'applied' where id = ${winner.observationId}`,
      );
      release();
      expect(await loser).toEqual({ ok: true, replay: true, observationId: winner.observationId });
      expect((await pg.db.execute(sql`select id, state from scratch_observation`)).rows).toEqual([
        { id: winner.observationId, state: "applied" },
      ]);
      expect(
        (await pg.db.execute(sql`select event_id, observation_id from scratch_receipt`)).rows,
      ).toEqual([{ event_id: original.eventId, observation_id: winner.observationId }]);
    } finally {
      release();
    }
  });

  it.each(["identical", "different"] as const)(
    "waits for a reserved key and resolves a concurrent %s intent",
    async (kind) => {
      const pg = await postgresTestDb();
      await createScratchLedger(pg.db);
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reserved = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const winner = recordScratchReceipt(pg.connect(), original, {
        afterReservation: async () => {
          ready();
          await gate;
        },
      });
      let contender: ReturnType<typeof recordScratchReceipt> | undefined;
      onTestFinished(async () => {
        release();
        await Promise.allSettled([winner, ...(contender ? [contender] : [])]);
      });
      try {
        await Promise.race([
          reserved,
          winner.then(() => {
            throw new Error("winner finished before its reservation barrier");
          }),
        ]);
        contender = recordScratchReceipt(
          pg.connect(),
          kind === "identical" ? original : { ...original, bookingId: "booking-b" },
        );
        const waiting = waitForLockWaiters(pg.db, 1);
        try {
          await Promise.race([
            waiting,
            contender.then(() => {
              throw new Error("contender finished without waiting for the key");
            }),
          ]);
        } finally {
          await waiting.catch(() => undefined);
        }
        const waiters = await pg.db.execute(sql`
        select count(*)::int as count from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
          and query like '%insert into scratch_receipt%'
      `);
        expect(Number((waiters.rows[0] as { count: number }).count)).toBeGreaterThan(0);
        release();
        const [first, second] = await Promise.all([winner, contender]);
        if (!first.ok) throw new Error("winner not recorded");
        expect(second).toEqual(
          kind === "identical"
            ? { ok: true, replay: true, observationId: first.observationId }
            : { ok: false, reason: "key_reused" },
        );
        const receipts = await pg.db.execute(
          sql`select booking_id, observation_id from scratch_receipt`,
        );
        const observations = await pg.db.execute(
          sql`select id, booking_id from scratch_observation`,
        );
        expect(receipts.rows).toHaveLength(1);
        expect(observations.rows).toHaveLength(1);
        expect(receipts.rows[0]).toMatchObject({
          booking_id: observations.rows[0]?.booking_id,
          observation_id: observations.rows[0]?.id,
        });
      } finally {
        release();
      }
    },
  );

  it("retains two different keys when a later tap commits while the first is reserved", async () => {
    const pg = await postgresTestDb();
    await createScratchLedger(pg.db);
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserved = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const first = recordScratchReceipt(pg.connect(), original, {
      afterReservation: async () => {
        signal();
        await gate;
      },
    });
    onTestFinished(async () => {
      release();
      await Promise.allSettled([first]);
    });
    try {
      await Promise.race([
        reserved,
        first.then(() => {
          throw new Error("first tap finished before its reservation barrier");
        }),
      ]);
      const second = await recordScratchReceipt(pg.connect(), {
        ...original,
        eventId: "event-b",
        actorId: "staff-b",
      });
      release();
      const firstResult = await first;
      if (!firstResult.ok || !second.ok) throw new Error("prototype refused a tap");
      expect(firstResult.observationId).toBe(second.observationId);
      const receipts = await pg.db.execute(
        sql`select event_id, actor_id, observation_id from scratch_receipt order by event_id`,
      );
      expect(receipts.rows).toEqual([
        { event_id: "event-a", actor_id: "staff-a", observation_id: firstResult.observationId },
        { event_id: "event-b", actor_id: "staff-b", observation_id: firstResult.observationId },
      ]);
      expect((await pg.db.execute(sql`select id from scratch_observation`)).rows).toEqual([
        { id: firstResult.observationId },
      ]);
    } finally {
      release();
    }
  });

  it("does not acknowledge a contender whose key lock times out", async () => {
    const pg = await postgresTestDb();
    await createScratchLedger(pg.db);
    let release!: () => void;
    let signal!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserved = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const winner = recordScratchReceipt(pg.connect(), original, {
      afterReservation: async () => {
        signal();
        await gate;
      },
    });
    let contender: ReturnType<typeof recordScratchReceipt> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([winner, ...(contender ? [contender] : [])]);
    });
    try {
      await Promise.race([
        reserved,
        winner.then(() => {
          throw new Error("winner finished before its reservation barrier");
        }),
      ]);
      contender = recordScratchReceipt(pg.connect(), original);
      await expect(contender).rejects.toMatchObject({ cause: { code: "55P03" } });
      release();
      const first = await winner;
      expect(first).toMatchObject({ ok: true, replay: false });
      expect((await pg.db.execute(sql`select event_id from scratch_receipt`)).rows).toEqual([
        { event_id: original.eventId },
      ]);
      expect((await pg.db.execute(sql`select id from scratch_observation`)).rows).toHaveLength(1);
    } finally {
      release();
    }
  });

  it.each(["afterReservation", "afterLink"] as const)(
    "rolls back failure at %s and permits a later retry",
    async (hook) => {
      const pg = await postgresTestDb();
      await createScratchLedger(pg.db);
      await expect(
        recordScratchReceipt(pg.connect(), original, {
          [hook]: async () => {
            throw new Error("injected failure");
          },
        }),
      ).rejects.toThrow("injected failure");
      expect((await pg.db.execute(sql`select * from scratch_receipt`)).rows).toEqual([]);
      expect((await pg.db.execute(sql`select * from scratch_observation`)).rows).toEqual([]);
      expect(await recordScratchReceipt(pg.connect(), original)).toMatchObject({
        ok: true,
        replay: false,
      });
    },
  );

  it("preserves the original receipt when a joined receipt fails after linking", async () => {
    const pg = await postgresTestDb();
    await createScratchLedger(pg.db);
    const first = await recordScratchReceipt(pg.connect(), original);
    if (!first.ok) throw new Error("first tap not recorded");
    const second = { ...original, eventId: "event-b", actorId: "staff-b" };
    await expect(
      recordScratchReceipt(pg.connect(), second, {
        afterLink: async () => {
          throw new Error("injected failure");
        },
      }),
    ).rejects.toThrow("injected failure");
    expect(
      (await pg.db.execute(sql`select event_id, observation_id from scratch_receipt`)).rows,
    ).toEqual([{ event_id: original.eventId, observation_id: first.observationId }]);
    expect((await pg.db.execute(sql`select id from scratch_observation`)).rows).toEqual([
      { id: first.observationId },
    ]);
    expect(await recordScratchReceipt(pg.connect(), second)).toEqual({
      ok: true,
      replay: false,
      observationId: first.observationId,
    });
  });
});
