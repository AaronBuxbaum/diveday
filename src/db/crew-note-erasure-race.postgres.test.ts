import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { anonymizeDiver } from "./anonymize";
import { recordCrewRollCall } from "./manifests";
import {
  people,
  personRoles,
  rollCallCrewEvents,
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
  await pg.db.insert(tripAssignments).values({ tripId: trip.id, personId: owner.id });

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
  return { pg, shop, diver, writeNote, erase, notes };
}

describePostgres("crew note writes ordered with erasure", () => {
  it("erasure waits for an in-flight note write, then redacts its matching name", async () => {
    const f = await fixture();
    await f.pg.db.execute(
      sql`create function test_hold_crew_note_insert() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(281033); return new; end $$`,
    );
    await f.pg.db.execute(
      sql`create trigger test_hold_crew_note_insert before insert on roll_call_crew_events for each row execute function test_hold_crew_note_insert()`,
    );
    const gate = await holdRowLock(f.pg, sql`select pg_advisory_xact_lock(281033)`);
    const noteWrite = f.writeNote("Maya Rivera returned safely after dive one.");
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
    expect(await f.notes()).toEqual([{ note: "[redacted] returned safely after dive one." }]);
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
});
