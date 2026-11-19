/**
 * Local-only experiment; intentionally red until the two safety gaps at the
 * end are fixed. The scratch triggers and HMAC witness below are not a
 * production migration or an authenticated snapshot implementation. Run
 * only with DIVEDAY_TEST_POSTGRES_URL pointed at a disposable PostgreSQL.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { canonicalRollCallEvidenceId } from "@/lib/roll-call-causality";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { moveBooking } from "./bookings";
import type { AppDb } from "./client";
import { getTripManifest, recordRollCall } from "./manifests";
import { recordPreDepartureCheck } from "./pre-departure-check";
import {
  bookings,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  rollCallEvents,
  trips,
} from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { editTripSection, getTripRoster, listStaff, moveTrip } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

describePostgres("mixed-version offline event boundary", () => {
  it("refuses unversioned offline writers while leaving live writes available", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const departures = await upcomingTripsWithCounts(pg.db, shop.id, new Date(0));
    const trip = departures.find((x) => x.title.startsWith("Two-Tank Reef — Molasses"));
    if (!trip) throw new Error("trip missing");
    const target = departures.find((x) => x.id !== trip.id && x.startsAt > trip.startsAt);
    if (!target) throw new Error("target departure missing");
    const [subject, other] = await getTripRoster(pg.db, shop.id, trip.id);
    const owner = (await listStaff(pg.db, shop.id)).find((s) => s.roles.includes("owner"));
    const [item] = await pg.db
      .select()
      .from(preDepartureChecklistItems)
      .where(
        and(
          eq(preDepartureChecklistItems.shopId, shop.id),
          isNull(preDepartureChecklistItems.deletedAt),
        ),
      )
      .limit(1);
    if (!subject || !other || !owner || !item) throw new Error("fixture missing");
    // Prototype only: installed after seeding in this disposable database.
    // A production boundary must replace this marker with a verified path.
    await pg.db.execute(
      sql.raw(`
      create function scratch_offline_version_guard() returns trigger language plpgsql as $$
      begin
        if new.source = 'offline' and
           (new.client_event_id is null or
            current_setting('diveday.test_verified_event', true) is distinct from new.client_event_id::text)
        then raise exception 'offline witness required' using errcode = 'P0001'; end if;
        return new;
      end $$;
      create trigger scratch_roll_call_guard before insert on roll_call_events
        for each row execute function scratch_offline_version_guard();
      create trigger scratch_checklist_guard before insert on pre_departure_check_events
        for each row execute function scratch_offline_version_guard();
      create table scratch_meeting_generation (trip_id uuid primary key, generation integer not null);
      create function scratch_meeting_changed() returns trigger language plpgsql as $$
      begin
        if new.ends_at is distinct from old.ends_at or new.starts_at is distinct from old.starts_at then
          insert into scratch_meeting_generation values (new.id, 1)
          on conflict (trip_id) do update set generation = scratch_meeting_generation.generation + 1;
        end if;
        return null;
      end $$;
      create constraint trigger scratch_meeting_changed_trigger after update on trips
        deferrable initially deferred for each row execute function scratch_meeting_changed();
      create table scratch_subject_generation (booking_id uuid primary key, generation integer not null);
      create function scratch_subject_changed() returns trigger language plpgsql as $$
      declare k uuid;
      begin
        if tg_op = 'UPDATE' and new.trip_id is not distinct from old.trip_id
           and new.person_id is not distinct from old.person_id then return null; end if;
        k := case when tg_op = 'DELETE' then old.id else new.id end;
        insert into scratch_subject_generation values (k, 1)
        on conflict (booking_id) do update set generation = scratch_subject_generation.generation + 1;
        return null;
      end $$;
      create constraint trigger scratch_subject_changed_trigger after insert or update or delete on bookings
        deferrable initially deferred for each row execute function scratch_subject_changed();
    `),
    );
    const at = nowDate();
    const savedAt = new Date(at.getTime() - 1000);
    const rollId = crypto.randomUUID(),
      checkId = crypto.randomUUID();
    const roll = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      recordedByPersonId: owner.person.id,
      status: "not_boarded" as const,
      checkpoint: "after_dive_1" as const,
    };
    const check = {
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: item.id,
      recordedByPersonId: owner.person.id,
      status: "checked" as const,
    };
    const before = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    await expect(
      recordRollCall(pg.db, {
        ...roll,
        source: "offline",
        clientEventId: rollId,
        offlineSnapshotSavedAt: savedAt,
        occurredAt: at,
      }),
    ).rejects.toThrow();
    await expect(
      recordPreDepartureCheck(pg.db, {
        ...check,
        source: "offline",
        clientEventId: checkId,
        offlineSnapshotSavedAt: savedAt,
        occurredAt: at,
      }),
    ).rejects.toThrow();
    expect(
      await pg.db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, rollId)),
    ).toHaveLength(0);
    expect(
      await pg.db
        .select()
        .from(preDepartureCheckEvents)
        .where(eq(preDepartureCheckEvents.clientEventId, checkId)),
    ).toHaveLength(0);
    expect(
      (await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1"))?.divers.find(
        (x) => x.bookingId === subject.booking.id,
      )?.rollCall,
    ).toEqual(before?.divers.find((x) => x.bookingId === subject.booking.id)?.rollCall);
    // A synthetic application witness; this is a prototype, not the shipped token format.
    const sign = (body: string) =>
      createHmac("sha256", "synthetic-witness-key").update(body).digest("hex");
    const scope = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: subject.booking.id,
      checkpoint: roll.checkpoint,
    };
    const frontier = async (db: AppDb) =>
      (
        await db
          .select({ id: rollCallEvents.id, clientEventId: rollCallEvents.clientEventId })
          .from(rollCallEvents)
          .where(
            and(
              eq(rollCallEvents.shopId, scope.shopId),
              eq(rollCallEvents.tripId, scope.tripId),
              eq(rollCallEvents.bookingId, scope.bookingId),
              eq(rollCallEvents.checkpoint, scope.checkpoint),
            ),
          )
      )
        .map(canonicalRollCallEvidenceId)
        .sort();
    await pg.db.execute(sql`insert into scratch_meeting_generation values (${trip.id}, 0)`);
    await pg.db.execute(
      sql`insert into scratch_subject_generation values (${subject.booking.id}, 0)`,
    );
    const signed = (generation: number, ids: string[], subjectGeneration = 0) => {
      const body = JSON.stringify({ ...scope, generation, subjectGeneration, ids });
      return { body, tag: sign(body) };
    };
    const rollbackTrial = new Error("scratch witness trial rollback");
    const verifyAndWrite = async (
      proof: ReturnType<typeof signed>,
      eventId: string,
      afterValidation?: () => Promise<void>,
      rollback = false,
    ) => {
      let trialOutcome: Awaited<ReturnType<typeof recordRollCall>> | undefined;
      try {
        return await pg.db.transaction(async (tx) => {
          const expected = Buffer.from(sign(proof.body), "hex");
          const supplied = Buffer.from(proof.tag, "hex");
          if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
            return "review";
          const value = JSON.parse(proof.body) as typeof scope & {
            generation: number;
            subjectGeneration: number;
            ids: string[];
          };
          if (
            value.shopId !== scope.shopId ||
            value.tripId !== scope.tripId ||
            value.bookingId !== scope.bookingId ||
            value.checkpoint !== scope.checkpoint
          )
            return "review";
          await tx
            .select({ id: trips.id })
            .from(trips)
            .where(and(eq(trips.shopId, shop.id), eq(trips.id, trip.id)))
            .for("update");
          const [prior] = await tx
            .select({ id: rollCallEvents.id })
            .from(rollCallEvents)
            .where(
              and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.clientEventId, eventId)),
            );
          if (prior) {
            return recordRollCall(tx as unknown as AppDb, {
              ...roll,
              status: "boarded",
              source: "offline",
              clientEventId: eventId,
              observedEvidenceIds: value.ids,
              offlineSnapshotSavedAt: savedAt,
              occurredAt: at,
            });
          }
          const locked = await tx.execute(
            sql`select generation from scratch_meeting_generation where trip_id = ${trip.id} for update`,
          );
          const version = Number(locked.rows[0]?.generation);
          const [seat] = await tx
            .select({ tripId: bookings.tripId })
            .from(bookings)
            .where(and(eq(bookings.shopId, shop.id), eq(bookings.id, subject.booking.id)))
            .for("update");
          const subjectVersion = await tx.execute(
            sql`select generation from scratch_subject_generation where booking_id = ${subject.booking.id} for update`,
          );
          if (
            seat?.tripId !== trip.id ||
            version !== value.generation ||
            Number(subjectVersion.rows[0]?.generation) !== value.subjectGeneration ||
            JSON.stringify(await frontier(tx as unknown as AppDb)) !== JSON.stringify(value.ids)
          )
            return "review";
          await afterValidation?.();
          await tx.execute(sql`select set_config('diveday.test_verified_event', ${eventId}, true)`);
          const outcome = await recordRollCall(tx as unknown as AppDb, {
            ...roll,
            status: "boarded",
            source: "offline",
            clientEventId: eventId,
            observedEvidenceIds: value.ids,
            offlineSnapshotSavedAt: savedAt,
            occurredAt: at,
          });
          if (rollback) {
            trialOutcome = outcome;
            throw rollbackTrial;
          }
          return outcome;
        });
      } catch (error) {
        if (error === rollbackTrial && trialOutcome) return trialOutcome;
        throw error;
      }
    };
    const old = signed(0, await frontier(pg.db));
    expect(await verifyAndWrite({ ...old, tag: "00".repeat(32) }, crypto.randomUUID())).toBe(
      "review",
    );
    expect((await editTripSection(pg.db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
    const noopVersion = await pg.db.execute(
      sql`select generation from scratch_meeting_generation where trip_id = ${trip.id}`,
    );
    expect(Number(noopVersion.rows[0]?.generation)).toBe(0);
    const changed = await editTripSection(pg.db, shop.id, trip.id, {
      endsAt: new Date(trip.endsAt.getTime() + 3_600_000),
    });
    expect(changed).toMatchObject({ ok: true });
    expect((await editTripSection(pg.db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
    expect(await verifyAndWrite(old, crypto.randomUUID())).toBe("review");
    const beforeMove = signed(2, await frontier(pg.db));
    let writerEntered!: () => void;
    let releaseWriter!: () => void;
    const writerHasLock = new Promise<void>((resolve) => {
      writerEntered = resolve;
    });
    const writerGate = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const writerFirst = moveTrip(
      pg.connect(),
      shop.id,
      trip.id,
      new Date(trip.startsAt.getTime() + 3_600_000),
      {
        beforeMove: async () => {
          writerEntered();
          await writerGate;
        },
      },
    );
    await writerHasLock;
    const behindWriter = verifyAndWrite(beforeMove, crypto.randomUUID());
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      releaseWriter();
    }
    expect(await writerFirst).toMatchObject({ ok: true });
    expect(await behindWriter).toBe("review");
    expect(await moveTrip(pg.db, shop.id, trip.id, trip.startsAt)).toMatchObject({ ok: true });
    expect(await verifyAndWrite(beforeMove, crypto.randomUUID())).toBe("review");
    const beforeSeatMove = signed(4, await frontier(pg.db));
    expect(
      await moveBooking(pg.db, {
        shopId: shop.id,
        fromTripId: trip.id,
        toTripId: target.id,
        bookingId: subject.booking.id,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await moveBooking(pg.db, {
        shopId: shop.id,
        fromTripId: target.id,
        toTripId: trip.id,
        bookingId: subject.booking.id,
      }),
    ).toMatchObject({ ok: true });
    expect
      .soft(await verifyAndWrite(beforeSeatMove, crypto.randomUUID(), undefined, true))
      .toBe("review");
    const beforeLive = signed(4, await frontier(pg.db), 2);
    expect(await recordRollCall(pg.db, roll)).toMatchObject({ ok: true });
    expect(await verifyAndWrite(beforeLive, crypto.randomUUID())).toBe("review");
    expect(await recordPreDepartureCheck(pg.db, check)).toMatchObject({ ok: true });
    const acceptedCheckId = crypto.randomUUID();
    const checkedOffline = {
      ...check,
      source: "offline" as const,
      clientEventId: acceptedCheckId,
      offlineSnapshotSavedAt: savedAt,
      occurredAt: at,
    };
    const checked = await pg.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('diveday.test_verified_event', ${acceptedCheckId}, true)`,
      );
      return recordPreDepartureCheck(tx as unknown as AppDb, checkedOffline);
    });
    expect(checked).toMatchObject({ ok: true });
    const wrongUndo = await recordPreDepartureCheck(pg.db, {
      ...checkedOffline,
      status: "cleared",
    });
    expect.soft(wrongUndo).not.toMatchObject({ ok: true, duplicate: true });
    const storedCheck = await pg.db
      .select({ status: preDepartureCheckEvents.status })
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.clientEventId, acceptedCheckId));
    expect(storedCheck).toEqual([{ status: "checked" }]);
    const current = signed(4, await frontier(pg.db), 2);
    expect(await recordRollCall(pg.db, { ...roll, bookingId: other.booking.id })).toMatchObject({
      ok: true,
    });
    const beforeIntake = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    expect(
      beforeIntake?.divers.find((d) => d.bookingId === subject.booking.id)?.rollCall?.state,
    ).toBe("not_boarded");
    const acceptedId = crypto.randomUUID();
    let entered!: () => void;
    let release!: () => void;
    const validated = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const intake = verifyAndWrite(current, acceptedId, async () => {
      entered();
      await gate;
    });
    await validated;
    const writer = editTripSection(pg.connect(), shop.id, trip.id, {
      endsAt: new Date(trip.endsAt.getTime() + 3_600_000),
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    expect(await intake).toMatchObject({ ok: true });
    expect(await writer).toMatchObject({ ok: true });
    const afterEdit = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
    expect
      .soft(afterEdit?.divers.find((d) => d.bookingId === subject.booking.id)?.rollCall?.state)
      .not.toBe("boarded");
    expect(await verifyAndWrite(current, acceptedId)).toMatchObject({ ok: true, duplicate: true });
    expect(await verifyAndWrite(current, crypto.randomUUID())).toBe("review");
  });
});
