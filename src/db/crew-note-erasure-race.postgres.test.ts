import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import { recordCrewRollCall, recordRollCall } from "./manifests";
import { recordPreDepartureCheck } from "./pre-departure-check";
import {
  bookings,
  people,
  personRoles,
  preDepartureCheckEvents,
  preDepartureChecklistItems,
  rollCallCrewEvents,
  rollCallEvents,
  shops,
  tripAssignments,
  trips,
  userAccounts,
} from "./schema";

async function fixture() {
  const pg = await postgresTestDb();
  const suffix = randomBytes(4).toString("hex");
  const [shop] = await pg.db
    .insert(shops)
    .values({
      name: `Crew note erasure ${suffix}`,
      slug: `crew-note-erasure-${suffix}`,
      timezone: "UTC",
    })
    .returning();
  if (!shop) throw new Error("shop insert returned no row");
  const [owner, diver] = await pg.db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Owner Person" },
      { shopId: shop.id, fullName: "Maya Rivera", email: `maya-${suffix}@example.test` },
    ])
    .returning();
  if (!owner || !diver) throw new Error("people insert returned no rows");
  await pg.db.insert(personRoles).values([
    { personId: owner.id, role: "owner" },
    { personId: diver.id, role: "diver" },
  ]);
  await pg.db.insert(userAccounts).values({
    personId: owner.id,
    email: `owner-${suffix}@example.test`,
    hashedPassword: "unused",
    status: "active",
  });
  const [trip] = await pg.db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Crew note erasure race",
      startsAt: new Date("2031-05-12T13:00:00Z"),
      endsAt: new Date("2031-05-12T17:00:00Z"),
      capacity: 6,
      plannedDives: 1,
    })
    .returning();
  if (!trip) throw new Error("trip insert returned no row");
  const [checklistItem] = await pg.db
    .insert(preDepartureChecklistItems)
    .values({ shopId: shop.id, label: "Oxygen aboard" })
    .returning();
  if (!checklistItem) throw new Error("checklist item insert returned no row");
  await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: owner.id });
  const [booking] = await pg.db
    .insert(bookings)
    .values({
      shopId: shop.id,
      tripId: trip.id,
      personId: diver.id,
      status: "booked",
      bookedAs: "diver",
      participantType: "diver",
    })
    .returning();
  if (!booking) throw new Error("booking insert returned no row");

  const writeNote = (note: string) =>
    recordCrewRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      personId: owner.id,
      recordedByPersonId: owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      note,
    });
  const writeOfflineNote = (note: string, epoch: number) => {
    const snapshotId = randomUUID();
    const occurredAt = nowDate();
    return recordCrewRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      personId: owner.id,
      recordedByPersonId: owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      source: "offline",
      clientEventId: randomUUID(),
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch,
        snapshotRevision: 1,
      }),
      occurredAt,
      note,
    });
  };
  const writeOfflineDiverNote = (note: string, epoch: number) => {
    const snapshotId = randomUUID();
    const occurredAt = nowDate();
    return recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: owner.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      source: "offline",
      clientEventId: randomUUID(),
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch,
        snapshotRevision: 1,
      }),
      occurredAt,
      note,
    });
  };
  const writeChecklistNote = (note: string, epoch: number) => {
    const snapshotId = randomUUID();
    const occurredAt = nowDate();
    return recordPreDepartureCheck(pg.connect(), {
      shopId: shop.id,
      tripId: trip.id,
      checklistItemId: checklistItem.id,
      recordedByPersonId: owner.id,
      status: "checked",
      source: "offline",
      clientEventId: randomUUID(),
      offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 1_000),
      offlineSnapshotId: snapshotId,
      offlineErasureEpochToken: signOfflineErasureEpoch({
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        epoch,
        snapshotRevision: 1,
      }),
      occurredAt,
      note,
    });
  };
  const erase = () =>
    anonymizeDiver(pg.connect(), {
      shopId: shop.id,
      personId: diver.id,
      actorPersonId: owner.id,
    });
  const notes = async () =>
    pg.db
      .select({ note: rollCallCrewEvents.note })
      .from(rollCallCrewEvents)
      .where(
        and(eq(rollCallCrewEvents.shopId, shop.id), eq(rollCallCrewEvents.personId, owner.id)),
      );
  const diverNotes = async () =>
    pg.db
      .select({
        note: rollCallEvents.note,
        status: rollCallEvents.status,
        occurredAt: rollCallEvents.occurredAt,
      })
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.bookingId, booking.id)));
  const checklistNotes = async () =>
    pg.db
      .select({ note: preDepartureCheckEvents.note, status: preDepartureCheckEvents.status })
      .from(preDepartureCheckEvents)
      .where(
        and(
          eq(preDepartureCheckEvents.shopId, shop.id),
          eq(preDepartureCheckEvents.checklistItemId, checklistItem.id),
        ),
      );
  return {
    pg,
    shop,
    diver,
    booking,
    writeNote,
    writeOfflineNote,
    writeOfflineDiverNote,
    writeChecklistNote,
    erase,
    notes,
    diverNotes,
    checklistNotes,
  };
}

describePostgres("crew note writes ordered with erasure", () => {
  it("erasure waits for an in-flight note write, then leaves its text, staff prose that mentions the diver", async () => {
    const f = await fixture();
    await f.pg.db.execute(
      sql`create function test_hold_crew_note_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(281033); return new; end $$`,
    );
    await f.pg.db.execute(
      sql`create trigger test_hold_crew_note_insert before insert on roll_call_crew_events for each row execute function test_hold_crew_note_insert()`,
    );
    const gate = await holdRowLock(f.pg, sql`select pg_advisory_xact_lock(281033)`);
    const noteWrite = f.writeOfflineNote(
      "Maya Rivera returned safely after dive one.",
      f.shop.offlineErasureEpoch,
    );
    let erasure: ReturnType<typeof f.erase> | undefined;
    try {
      // The trigger can only run after the note writer has passed its shared
      // erasure fence; the second waiter is erasure queued behind that writer.
      await waitForLockWaiters(f.pg.db, 1);
      erasure = f.erase();
      await waitForLockWaiters(f.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await noteWrite).toMatchObject({ ok: true });
    expect(await erasure).toMatchObject({ ok: true });
    expect(await f.notes()).toEqual([{ note: "Maya Rivera returned safely after dive one." }]);
  });

  it("allows a note ordered after erasure to retain its free text", async () => {
    const f = await fixture();
    await f.pg.db.execute(
      sql`create function test_hold_erasure_person_update() returns trigger language plpgsql as $$ begin if new.anonymized_at is not null and old.anonymized_at is null then perform pg_advisory_xact_lock(281034); end if; return new; end $$`,
    );
    await f.pg.db.execute(
      sql`create trigger test_hold_erasure_person_update before update on people for each row execute function test_hold_erasure_person_update()`,
    );
    const gate = await holdRowLock(f.pg, sql`select pg_advisory_xact_lock(281034)`);
    const erasure = f.erase();
    let noteWrite: ReturnType<typeof f.writeNote> | undefined;
    try {
      // Erasure is paused after it owns the exclusive fence. The note writer
      // then waits for that fence, so its successful write is truly later.
      await waitForLockWaiters(f.pg.db, 1);
      noteWrite = f.writeNote("Maya Rivera returned safely after dive one.");
      await waitForLockWaiters(f.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await erasure).toMatchObject({ ok: true });
    expect(await noteWrite).toMatchObject({ ok: true });
    expect(await f.notes()).toEqual([{ note: "Maya Rivera returned safely after dive one." }]);
    const [erased] = await f.pg.db
      .select({ name: people.fullName, email: people.email })
      .from(people)
      .where(eq(people.id, f.diver.id));
    expect(erased).toEqual({ name: "[anonymized]", email: null });
  });

  it("keeps an offline roll-call mark but drops its pre-erasure note after waiting behind erasure", async () => {
    const f = await fixture();
    const staleEpoch = f.shop.offlineErasureEpoch;
    await f.pg.db.execute(
      sql`create function test_hold_erasure_person_update() returns trigger language plpgsql as $$ begin if new.anonymized_at is not null and old.anonymized_at is null then perform pg_advisory_xact_lock(281035); end if; return new; end $$`,
    );
    await f.pg.db.execute(
      sql`create trigger test_hold_erasure_person_update before update on people for each row execute function test_hold_erasure_person_update()`,
    );
    const gate = await holdRowLock(f.pg, sql`select pg_advisory_xact_lock(281035)`);
    const erasure = f.erase();
    let offlineWrite: ReturnType<typeof f.writeOfflineNote> | undefined;
    try {
      await waitForLockWaiters(f.pg.db, 1);
      offlineWrite = f.writeOfflineNote("Maya Rivera was seen at the ladder.", staleEpoch);
      await waitForLockWaiters(f.pg.db, 2);
    } finally {
      await gate.release();
    }

    expect(await erasure).toMatchObject({ ok: true });
    expect(await offlineWrite).toMatchObject({
      ok: true,
      noteDisposition: "discarded_erasure_cutoff",
    });
    expect(await f.notes()).toEqual([{ note: null }]);
    const [shopAfterErasure] = await f.pg.db
      .select({ epoch: shops.offlineErasureEpoch })
      .from(shops)
      .where(eq(shops.id, f.shop.id));
    expect(shopAfterErasure?.epoch).toBe(staleEpoch + 1);
    const [mark] = await f.pg.db
      .select({ status: rollCallCrewEvents.status })
      .from(rollCallCrewEvents)
      .where(eq(rollCallCrewEvents.shopId, f.shop.id));
    expect(mark?.status).toBe("not_boarded");

    // A fresh server snapshot carries the incremented shop epoch, so later
    // notes remain available as the product decision requires.
    const freshWrite = await f.writeOfflineNote(
      "A fresh post-erasure note is allowed.",
      staleEpoch + 1,
    );
    expect(freshWrite).toMatchObject({ ok: true });
    expect((await f.notes()).map((row) => row.note).sort()).toEqual(
      [null, "A fresh post-erasure note is allowed."].sort(),
    );
  });

  it("does not reintroduce a pre-erasure note on an erased diver's retained booking", async () => {
    const f = await fixture();
    const staleEpoch = f.shop.offlineErasureEpoch;
    const atTap = nowDate();
    await f.erase();
    const write = await f.writeOfflineDiverNote("Maya Rivera was seen at the ladder.", staleEpoch);
    expect(write).toMatchObject({ ok: true, noteDisposition: "discarded_erasure_cutoff" });
    expect(await f.diverNotes()).toEqual([
      { note: null, status: "not_boarded", occurredAt: expect.any(Date) },
    ]);
    expect((await f.diverNotes())[0]?.occurredAt.getTime()).toBeGreaterThanOrEqual(atTap.getTime());
  });

  it("orders a diver note writer already in flight before erasure and erases its text", async () => {
    const f = await fixture();
    await f.pg.db.execute(
      sql`create function test_hold_diver_note_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(281036); return new; end $$`,
    );
    await f.pg.db.execute(
      sql`create trigger test_hold_diver_note_insert before insert on roll_call_events for each row execute function test_hold_diver_note_insert()`,
    );
    const gate = await holdRowLock(f.pg, sql`select pg_advisory_xact_lock(281036)`);
    const noteWrite = f.writeOfflineDiverNote(
      "Maya Rivera was seen at the ladder.",
      f.shop.offlineErasureEpoch,
    );
    let erasure: ReturnType<typeof f.erase> | undefined;
    try {
      await waitForLockWaiters(f.pg.db, 1);
      erasure = f.erase();
      await waitForLockWaiters(f.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await noteWrite).toMatchObject({ ok: true });
    expect(await erasure).toMatchObject({ ok: true });
    expect(await f.diverNotes()).toMatchObject([{ note: null, status: "not_boarded" }]);
  });

  it("orders a checklist note writer before erasure and leaves its text", async () => {
    const f = await fixture();
    await f.pg.db.execute(
      sql`create function test_hold_checklist_note_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(281037); return new; end $$`,
    );
    await f.pg.db.execute(
      sql`create trigger test_hold_checklist_note_insert before insert on pre_departure_check_events for each row execute function test_hold_checklist_note_insert()`,
    );
    const gate = await holdRowLock(f.pg, sql`select pg_advisory_xact_lock(281037)`);
    const noteWrite = f.writeChecklistNote(
      "Maya Rivera checked the oxygen bottle.",
      f.shop.offlineErasureEpoch,
    );
    let erasure: ReturnType<typeof f.erase> | undefined;
    try {
      await waitForLockWaiters(f.pg.db, 1);
      erasure = f.erase();
      await waitForLockWaiters(f.pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await noteWrite).toMatchObject({ ok: true });
    expect(await erasure).toMatchObject({ ok: true });
    expect(await f.checklistNotes()).toEqual([
      { note: "Maya Rivera checked the oxygen bottle.", status: "checked" },
    ]);
  });
});
