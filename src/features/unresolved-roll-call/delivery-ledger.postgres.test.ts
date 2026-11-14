import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished } from "vitest";
import {
  people,
  rollCallEventClaims,
  unresolvedSafetyAlertDeliveries,
  unresolvedSafetyAlertOutbox,
} from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { anonymizeDiver } from "@/features/anonymize/store";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  ensureSafetyReviewDelivery,
  finishSafetyReviewDelivery,
  markInterruptedSafetyReviewDelivery,
  startSafetyReviewDelivery,
} from "./delivery-ledger";

describePostgres("unresolved safety delivery attempt fences", () => {
  it("does not create a new delivery for an erased recipient", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop fixture missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!trip || !owner) throw new Error("trip or owner fixture missing");
    const [recipient] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Erased recipient",
      })
      .returning();
    const [claim] = await pg.db
      .insert(rollCallEventClaims)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        clientEventId: crypto.randomUUID(),
        state: "erased",
      })
      .returning();
    const [outbox] = await pg.db
      .insert(unresolvedSafetyAlertOutbox)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        claimId: claim.id,
        generationId: crypto.randomUUID(),
      })
      .returning();
    expect(
      await anonymizeDiver(pg.db, {
        shopId: shop.id,
        personId: recipient.id,
        actorPersonId: owner.person.id,
      }),
    ).toMatchObject({ ok: true });
    await expect(
      ensureSafetyReviewDelivery(pg.db, {
        outboxId: outbox.id,
        personId: recipient.id,
      }),
    ).rejects.toThrow("Safety review delivery could not be recorded");
    expect(
      await pg.db
        .select()
        .from(unresolvedSafetyAlertDeliveries)
        .where(eq(unresolvedSafetyAlertDeliveries.outboxId, outbox.id)),
    ).toEqual([]);
    const [eraseFirstRecipient] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Recipient being erased",
      })
      .returning();
    const eraseGate = await holdRowLock(
      pg,
      sql`select id from people where id = ${eraseFirstRecipient.id} for update`,
    );
    const eraseFirst = anonymizeDiver(pg.connect(), {
      shopId: shop.id,
      personId: eraseFirstRecipient.id,
      actorPersonId: owner.person.id,
    });
    void eraseFirst.catch(() => undefined);
    onTestFinished(async () => {
      await eraseGate.release();
      await Promise.allSettled([eraseFirst]);
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      await expect(
        pg.connect().transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          return ensureSafetyReviewDelivery(tx, {
            outboxId: outbox.id,
            personId: eraseFirstRecipient.id,
          });
        }),
      ).rejects.toThrow("Safety review delivery could not be recorded");
    } finally {
      await eraseGate.release();
    }
    expect(await eraseFirst).toMatchObject({ ok: true });
    expect(
      await pg.db
        .select()
        .from(unresolvedSafetyAlertDeliveries)
        .where(eq(unresolvedSafetyAlertDeliveries.outboxId, outbox.id)),
    ).toEqual([]);
    const [lockedRecipient] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Temporarily locked recipient",
      })
      .returning();
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${lockedRecipient.id} for update`,
    );
    try {
      await expect(
        pg.connect().transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          return ensureSafetyReviewDelivery(tx, {
            outboxId: outbox.id,
            personId: lockedRecipient.id,
          });
        }),
      ).rejects.toThrow("Safety review delivery could not be recorded");
    } finally {
      await gate.release();
    }
    expect(
      await pg.db
        .select()
        .from(unresolvedSafetyAlertDeliveries)
        .where(eq(unresolvedSafetyAlertDeliveries.outboxId, outbox.id)),
    ).toEqual([]);
    // Once the row is available, the same active recipient can be reserved.
    const id = await ensureSafetyReviewDelivery(pg.db, {
      outboxId: outbox.id,
      personId: lockedRecipient.id,
    });
    expect(
      await ensureSafetyReviewDelivery(pg.db, {
        outboxId: outbox.id,
        personId: lockedRecipient.id,
      }),
    ).toBe(id);
    const [historical] = await pg.db
      .select()
      .from(unresolvedSafetyAlertDeliveries)
      .where(eq(unresolvedSafetyAlertDeliveries.id, id));
    const existingGate = await holdRowLock(
      pg,
      sql`select id from people where id = ${lockedRecipient.id} for update`,
    );
    try {
      await expect(
        pg.connect().transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout = '2s'`);
          return ensureSafetyReviewDelivery(tx, {
            outboxId: outbox.id,
            personId: lockedRecipient.id,
          });
        }),
      ).rejects.toThrow("Safety review delivery could not be recorded");
    } finally {
      await existingGate.release();
    }
    expect(
      await anonymizeDiver(pg.db, {
        shopId: shop.id,
        personId: lockedRecipient.id,
        actorPersonId: owner.person.id,
      }),
    ).toMatchObject({ ok: true });
    await expect(
      ensureSafetyReviewDelivery(pg.db, {
        outboxId: outbox.id,
        personId: lockedRecipient.id,
      }),
    ).rejects.toThrow("Safety review delivery could not be recorded");
    expect(
      await pg.db
        .select()
        .from(unresolvedSafetyAlertDeliveries)
        .where(eq(unresolvedSafetyAlertDeliveries.id, id)),
    ).toEqual([historical]);

    const [racingRecipient] = await pg.db
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: "Recipient reserved before erasure",
      })
      .returning();
    let release!: () => void;
    let reserved!: () => void;
    const gateReservation = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reservationReady = new Promise<void>((resolve) => {
      reserved = resolve;
    });
    const reservation = pg.connect().transaction(async (tx) => {
      const reservationId = await ensureSafetyReviewDelivery(tx, {
        outboxId: outbox.id,
        personId: racingRecipient.id,
      });
      reserved();
      await gateReservation;
      return reservationId;
    });
    void reservation.catch(() => undefined);
    let erasure: ReturnType<typeof anonymizeDiver> | undefined;
    onTestFinished(async () => {
      release();
      await Promise.allSettled([reservation, ...(erasure ? [erasure] : [])]);
    });
    await Promise.race([reservationReady, reservation]);
    try {
      erasure = anonymizeDiver(pg.connect(), {
        shopId: shop.id,
        personId: racingRecipient.id,
        actorPersonId: owner.person.id,
      });
      void erasure.catch(() => undefined);
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    const reservationId = await reservation;
    if (!erasure) throw new Error("erasure did not start");
    expect(await erasure).toMatchObject({ ok: true });
    const [racedDelivery] = await pg.db
      .select()
      .from(unresolvedSafetyAlertDeliveries)
      .where(eq(unresolvedSafetyAlertDeliveries.id, reservationId));
    expect(racedDelivery).toMatchObject({ personId: racingRecipient.id, status: "pending" });
  });

  it("permits one concurrent attempt and retains a late confirmed success", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "history");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop fixture missing");
    const [trip] = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const [staff] = await listStaff(pg.db, shop.id);
    if (!trip || !staff) throw new Error("trip or staff fixture missing");
    const generationId = crypto.randomUUID();
    const [claim] = await pg.db
      .insert(rollCallEventClaims)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        clientEventId: crypto.randomUUID(),
        state: "erased",
        retainedSafetyEvidence: {
          version: 1,
          receiptId: generationId,
          checkpoint: "after_dive_1",
          status: "not_boarded",
          occurredAt: nowDate().toISOString(),
          meetingDay: null,
          observedEvidenceIds: null,
          retractsEventId: null,
          retractsClientEventId: null,
          reconcilesEvidence: false,
          noteRetained: false,
        },
      })
      .returning({ id: rollCallEventClaims.id });
    const [outbox] = await pg.db
      .insert(unresolvedSafetyAlertOutbox)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        claimId: claim.id,
        generationId,
      })
      .returning({ id: unresolvedSafetyAlertOutbox.id });
    const id = await ensureSafetyReviewDelivery(pg.db, {
      outboxId: outbox.id,
      personId: staff.person.id,
    });
    const gate = await holdRowLock(
      pg,
      sql`select id from ${unresolvedSafetyAlertDeliveries} where id = ${id} for update`,
    );
    const first = startSafetyReviewDelivery(pg.connect(), id);
    const second = startSafetyReviewDelivery(pg.connect(), id);
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    const attempts = (await Promise.all([first, second])).filter(
      (value): value is string => value !== null,
    );
    expect(attempts).toHaveLength(1);
    const attemptId = attempts[0];
    const gate2 = await holdRowLock(
      pg,
      sql`select id from ${unresolvedSafetyAlertDeliveries} where id = ${id} for update`,
    );
    const interrupted = markInterruptedSafetyReviewDelivery(
      pg.connect(),
      id,
      new Date(nowDate().getTime() + 1_000),
    );
    const sent = finishSafetyReviewDelivery(pg.connect(), {
      deliveryId: id,
      attemptId,
      outcome: "delivered",
      providerMessageId: "provider-accepted",
    });
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate2.release();
    }
    await Promise.all([interrupted, sent]);
    const [row] = await pg.db
      .select()
      .from(unresolvedSafetyAlertDeliveries)
      .where(eq(unresolvedSafetyAlertDeliveries.id, id));
    expect(row).toMatchObject({
      status: "delivered",
      attemptId,
      providerMessageId: "provider-accepted",
    });
    expect(await startSafetyReviewDelivery(pg.db, id)).toBeNull();
  });
});
