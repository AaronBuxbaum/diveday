import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import { recordBoardingObservation } from "@/db/boarding-observations";
import { createBookingParty } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { boardingObservations, bookings, people, shops } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { createTrip, listStaff } from "@/db/trips";
import { HOUR_MS } from "@/lib/clock";
import {
  claimDraftReceipt,
  type DraftReceiptIntent,
} from "@/test/boarding-receipt-prototype/claim";
import { installDraftTable } from "@/test/boarding-receipt-prototype/table";
import { describePostgres, postgresTestDb } from "@/test/postgres";

async function fixture() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "history");
  await installDraftTable(pg.db);
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const [staff] = await listStaff(pg.db, shop.id);
  if (!staff) throw new Error("staff missing");
  const start = new Date(Date.UTC(2031, 4, 12, 13));
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Receipt test",
    startsAt: start,
    endsAt: new Date(start.getTime() + 4 * HOUR_MS),
    capacity: 2,
  });
  if (!trip) throw new Error("trip missing");
  const seats = await createBookingParty(
    pg.db,
    ["One", "Two"].map((fullName) => ({
      actor: "staff" as const,
      shopId: shop.id,
      tripId: trip.id,
      fullName,
    })),
  );
  if (!seats.ok) throw new Error(`seat creation refused: ${seats.reason}`);
  const intents: DraftReceiptIntent[] = [];
  const legacyKeys: string[] = [];
  for (const seat of seats.bookings) {
    await pg.db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.bookingId));
    const legacyKey = randomUUID();
    const observed = await recordBoardingObservation(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: seat.bookingId,
      recordedByPersonId: staff.person.id,
      clientKey: legacyKey,
    });
    if (!observed.ok) throw new Error(`observation refused: ${observed.reason}`);
    legacyKeys.push(legacyKey);
    intents.push({
      shopId: shop.id,
      clientKey: randomUUID(),
      bookingId: seat.bookingId,
      tripId: trip.id,
      observationId: observed.observationId,
      originalActorId: staff.person.id,
      occurredAt: "device-claimed-instant",
      context: { kind: "asserted", generationId: randomUUID(), meetingId: randomUUID() },
    });
  }
  const [first, second] = intents;
  if (!first || !second) throw new Error("two intents required");
  const [firstLegacy] = legacyKeys;
  if (!firstLegacy) throw new Error("legacy key missing");
  return { pg, first, second, firstLegacy };
}

describePostgres("unrouted draft receipt claims", () => {
  it.each([
    { reverse: false, same: false },
    { reverse: true, same: false },
    { reverse: false, same: true },
  ])("serializes a held key (reverse=$reverse, same=$same)", async ({ reverse, same }) => {
    const { pg, first, second } = await fixture();
    const winner = reverse ? second : first;
    const loser = same ? winner : { ...(reverse ? first : second), clientKey: winner.clientKey };
    const beforeWinner = await pg.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.id, winner.observationId));
    const beforeLoser = await pg.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.id, loser.observationId));
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let heldPid = 0;
    const connection = pg.connect();
    const delayed = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              heldPid = Number((pid.rows[0] as { pid: number }).pid);
              const result = await work(tx);
              ready();
              await gate;
              return result;
            });
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let identify!: (pid: number) => void;
    const contenderPid = new Promise<number>((resolve) => {
      identify = resolve;
    });
    const contenderConnection = pg.connect();
    const contender = new Proxy(contenderConnection, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              identify(Number((pid.rows[0] as { pid: number }).pid));
              return work(tx);
            });
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const accepted = claimDraftReceipt(delayed, winner);
    void accepted.catch(() => undefined);
    let competing: ReturnType<typeof claimDraftReceipt> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([accepted, ...(competing ? [competing] : [])]);
    });
    try {
      const reachedGate = await Promise.race([held.then(() => true), accepted.then(() => false)]);
      if (!reachedGate) throw new Error("first claim finished before commit gate");
      competing = claimDraftReceipt(contender, loser);
      void competing.catch(() => undefined);
      const pid = await Promise.race([
        contenderPid,
        competing.then(() => {
          throw new Error("contender not identified");
        }),
      ]);
      let finished = false;
      void competing.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        },
      );
      let blocked = false;
      const deadline = performance.now() + 4_000;
      while (performance.now() < deadline && !finished) {
        const waiting = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and pid = ${pid} and wait_event_type = 'Lock'
          and ${heldPid} = any(pg_blocking_pids(pid)) and query like '%draft_boarding_receipt_claims%'`);
        if (Number((waiting.rows[0] as { count: number }).count) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked, "contender did not wait on the uncommitted claim").toBe(true);
    } finally {
      release();
    }
    expect(await accepted).toEqual({ kind: "inserted", observationId: winner.observationId });
    if (!competing) throw new Error("contender missing");
    expect(await competing).toEqual(
      same ? { kind: "replayed", observationId: winner.observationId } : { kind: "key_reused" },
    );
    expect(await claimDraftReceipt(pg.connect(), winner)).toEqual({
      kind: "replayed",
      observationId: winner.observationId,
    });
    const rows = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${winner.shopId} and client_key = ${winner.clientKey}`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      booking_id: winner.bookingId,
      trip_id: winner.tripId,
      observation_id: winner.observationId,
      original_actor_id: winner.originalActorId,
    });
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, winner.observationId)),
    ).toEqual(beforeWinner);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, loser.observationId)),
    ).toEqual(beforeLoser);
  });

  it("rolls back a claim when the original observation cannot be linked", async () => {
    const { pg, first } = await fixture();
    const invalid = { ...first, observationId: randomUUID() };
    expect(await claimDraftReceipt(pg.connect(), invalid)).toEqual({ kind: "unavailable" });
    const rows = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId} and client_key = ${first.clientKey}`,
    );
    expect(rows.rows).toEqual([]);
    expect(await claimDraftReceipt(pg.connect(), first)).toEqual({
      kind: "inserted",
      observationId: first.observationId,
    });
  });

  it("lets a waiting claimant acquire the key after the first transaction rolls back", async () => {
    const { pg, first } = await fixture();
    const before = await pg.db
      .select()
      .from(boardingObservations)
      .where(eq(boardingObservations.id, first.observationId));
    const beforeBooking = await pg.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, first.bookingId));
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let heldPid = 0;
    const connection = pg.connect();
    const aborting = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              heldPid = Number((pid.rows[0] as { pid: number }).pid);
              await work(tx);
              ready();
              await gate;
              throw new Error("abort the first draft claim");
            });
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    let identify!: (pid: number) => void;
    const contenderPid = new Promise<number>((resolve) => {
      identify = resolve;
    });
    const contenderConnection = pg.connect();
    const contender = new Proxy(contenderConnection, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              const pid = await tx.execute(sql`select pg_backend_pid() as pid`);
              identify(Number((pid.rows[0] as { pid: number }).pid));
              return work(tx);
            });
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const aborted = claimDraftReceipt(aborting, first);
    void aborted.catch(() => undefined);
    let waiting: ReturnType<typeof claimDraftReceipt> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([aborted, ...(waiting ? [waiting] : [])]);
    });
    try {
      const reachedGate = await Promise.race([held.then(() => true), aborted.then(() => false)]);
      if (!reachedGate) throw new Error("first claim finished before rollback gate");
      waiting = claimDraftReceipt(contender, first);
      void waiting.catch(() => undefined);
      const pid = await Promise.race([
        contenderPid,
        waiting.then(() => {
          throw new Error("contender not identified");
        }),
      ]);
      let finished = false;
      void waiting.then(
        () => {
          finished = true;
        },
        () => {
          finished = true;
        },
      );
      const deadline = performance.now() + 4_000;
      let blocked = false;
      while (performance.now() < deadline && !finished) {
        const active = await pg.db.execute(sql`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and pid = ${pid} and wait_event_type = 'Lock'
            and ${heldPid} = any(pg_blocking_pids(pid)) and query like '%draft_boarding_receipt_claims%'`);
        if (Number((active.rows[0] as { count: number }).count) > 0) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked, "contender did not wait for the aborting claim").toBe(true);
    } finally {
      release();
    }
    await expect(aborted).rejects.toThrow("abort the first draft claim");
    if (!waiting) throw new Error("contender missing");
    expect(await waiting).toEqual({ kind: "inserted", observationId: first.observationId });
    const rows = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId} and client_key = ${first.clientKey}`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(
      await pg.db
        .select()
        .from(boardingObservations)
        .where(eq(boardingObservations.id, first.observationId)),
    ).toEqual(before);
    expect(await pg.db.select().from(bookings).where(eq(bookings.id, first.bookingId))).toEqual(
      beforeBooking,
    );
  });

  it("refuses unknown context and keys already present in the legacy namespace", async () => {
    const { pg, first, second, firstLegacy } = await fixture();
    expect(
      await claimDraftReceipt(pg.connect(), { ...first, context: { kind: "legacy_unknown" } }),
    ).toEqual({ kind: "unverifiable" });
    expect(await claimDraftReceipt(pg.connect(), { ...first, clientKey: firstLegacy })).toEqual({
      kind: "unverifiable",
    });
    expect(await claimDraftReceipt(pg.connect(), { ...second, clientKey: firstLegacy })).toEqual({
      kind: "key_reused",
    });
    const rows = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId}`,
    );
    expect(rows.rows).toEqual([]);
  });

  it("does not retarget a committed draft key to altered asserted context", async () => {
    const { pg, first } = await fixture();
    if (first.context.kind !== "asserted") throw new Error("asserted context required");
    expect(await claimDraftReceipt(pg.connect(), first)).toEqual({
      kind: "inserted",
      observationId: first.observationId,
    });
    const before = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId} and client_key = ${first.clientKey}`,
    );
    expect(before.rows).toHaveLength(1);
    for (const changed of [
      { ...first, tripId: randomUUID() },
      { ...first, bookingId: randomUUID() },
      { ...first, observationId: randomUUID() },
      { ...first, originalActorId: randomUUID() },
      { ...first, occurredAt: "other-untrusted-time" },
      { ...first, context: { ...first.context, generationId: randomUUID() } },
      { ...first, context: { ...first.context, meetingId: randomUUID() } },
    ]) {
      expect(await claimDraftReceipt(pg.connect(), changed)).toEqual({ kind: "key_reused" });
    }
    const after = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId} and client_key = ${first.clientKey}`,
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("does not claim a key under a non-READ-COMMITTED transaction", async () => {
    const { pg, first } = await fixture();
    const connection = pg.connect();
    const repeatable = new Proxy(connection, {
      get(target, property, receiver) {
        if (property === "transaction")
          return (work: Parameters<AppDb["transaction"]>[0]) =>
            target.transaction(async (tx) => {
              await tx.execute(sql`set transaction isolation level repeatable read`);
              return work(tx);
            });
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect(await claimDraftReceipt(repeatable, first)).toEqual({ kind: "unavailable" });
    const rows = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId} and client_key = ${first.clientKey}`,
    );
    expect(rows.rows).toEqual([]);
    expect(await claimDraftReceipt(pg.connect(), first)).toEqual({
      kind: "inserted",
      observationId: first.observationId,
    });
  });

  it("replays an existing draft claim after settlement but refuses a new one", async () => {
    const { pg, first } = await fixture();
    expect(await claimDraftReceipt(pg.connect(), first)).toEqual({
      kind: "inserted",
      observationId: first.observationId,
    });
    await pg.db
      .update(boardingObservations)
      .set({ state: "applied", settledAt: new Date("2031-05-12T13:00:00Z") })
      .where(eq(boardingObservations.id, first.observationId));
    expect(await claimDraftReceipt(pg.connect(), first)).toEqual({
      kind: "replayed",
      observationId: first.observationId,
    });
    const later = { ...first, clientKey: randomUUID() };
    expect(await claimDraftReceipt(pg.connect(), later)).toEqual({ kind: "unavailable" });
    const rows = await pg.db.execute(
      sql`select * from draft_boarding_receipt_claims where shop_id = ${first.shopId} and client_key = ${later.clientKey}`,
    );
    expect(rows.rows).toEqual([]);
  });

  it("scopes draft-key uniqueness to the tenant", async () => {
    const { pg, first } = await fixture();
    const [other] = await pg.db
      .insert(shops)
      .values({ name: "Other", slug: `receipt-${randomUUID()}`, timezone: "UTC" })
      .returning();
    if (!other) throw new Error("other shop missing");
    const [actor] = await pg.db
      .insert(people)
      .values({ shopId: other.id, fullName: "Other staff" })
      .returning();
    if (!actor) throw new Error("other actor missing");
    const [observation] = await pg.db
      .insert(boardingObservations)
      .values({
        shopId: other.id,
        bookingId: randomUUID(),
        tripId: randomUUID(),
        clientKey: randomUUID(),
        recordedByPersonId: actor.id,
      })
      .returning();
    if (!observation) throw new Error("other observation missing");
    const otherIntent: DraftReceiptIntent = {
      ...first,
      shopId: other.id,
      bookingId: observation.bookingId,
      tripId: observation.tripId,
      observationId: observation.id,
      originalActorId: actor.id,
    };
    expect(await claimDraftReceipt(pg.connect(), first)).toEqual({
      kind: "inserted",
      observationId: first.observationId,
    });
    expect(await claimDraftReceipt(pg.connect(), otherIntent)).toEqual({
      kind: "inserted",
      observationId: observation.id,
    });
    const rows = await pg.db.execute(
      sql`select shop_id, observation_id from draft_boarding_receipt_claims where client_key = ${first.clientKey}`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shop_id: first.shopId, observation_id: first.observationId }),
        expect.objectContaining({ shop_id: other.id, observation_id: observation.id }),
      ]),
    );
  });
});
