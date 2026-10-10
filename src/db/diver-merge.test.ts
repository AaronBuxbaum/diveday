import { and, eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import {
  computeWaiverIntegrityHash,
  verifyWaiverIntegrity,
  WAIVER_INTEGRITY_VERSION_MOVED,
  WAIVER_INTEGRITY_VERSION_SIGNED,
} from "@/lib/waiver-integrity";
import { fileScopedShopContext } from "@/test/db";
import {
  DIVER_HISTORY_TABLES,
  DIVER_MERGE_COUNT_GROUPS,
  listDiverMergeCandidates,
  listDiverMergeDuplicateIds,
  mergeDiverRecords,
  PERSON_COLUMNS_DELIBERATELY_UNMOVED,
  PERSON_REFERENCES_OUTSIDE_THE_NAMING_CONVENTION,
  PERSON_TABLES_DELIBERATELY_UNMOVED,
  STAFF_HISTORY_TABLES,
  STAFF_PERSON_ONLY_TABLES,
} from "./diver-merge";
import {
  activityEvents,
  bookings,
  certifications,
  gearItems,
  gearReservations,
  internalNotes,
  people,
  personRoles,
  priorVisits,
  recapPulses,
  rentalFitProfiles,
  shops,
  tripDeskEvents,
  trips,
  waiverRecords,
  waiverTemplates,
} from "./schema";

async function mergeFixtures() {
  const { db, shop } = ctx;
  const [owner] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), eq(personRoles.role, "owner")))
    .limit(1);
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(eq(trips.shopId, shop.id))
    .limit(1);
  if (!owner || !trip) throw new Error("merge fixture needs the seeded owner and a trip");

  const [source, survivor] = await db
    .insert(people)
    .values([
      { shopId: shop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" },
      { shopId: shop.id, fullName: "Maya Rivera", email: "maya@example.com" },
    ])
    .returning();
  if (!source || !survivor) throw new Error("merge fixture people insert failed");
  await db.insert(personRoles).values([
    { personId: source.id, role: "diver" },
    { personId: survivor.id, role: "diver" },
  ]);
  return { db, shop, owner, trip, source, survivor };
}

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`); nothing here commits or races.
const ctx = fileScopedShopContext();

describe("diver record merge", () => {
  it("moves a source-only email onto an email-less survivor", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db.update(people).set({ email: null }).where(eq(people.id, survivor.id));
    await db.update(people).set({ email: "source@example.com" }).where(eq(people.id, source.id));

    const result = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    expect(result).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });
    const [mergedSurvivor] = await db
      .select({ email: people.email })
      .from(people)
      .where(eq(people.id, survivor.id));
    expect(mergedSurvivor?.email).toBe("source@example.com");
  });

  it("surfaces narrow same-name and same-phone candidates, never a name alone", async () => {
    const { db, shop, source, survivor } = await mergeFixtures();
    // One name and nothing else in common: a parent and a namesake child look
    // exactly like this, so the name alone is never offered.
    const nameOnly = await listDiverMergeCandidates(db, shop.id, source.id);
    expect(nameOnly.find((candidate) => candidate.id === survivor.id)).toBeUndefined();

    await db.update(people).set({ phone: "+1 305 555 0142" }).where(eq(people.id, survivor.id));
    const candidates = await listDiverMergeCandidates(db, shop.id, source.id);
    expect(candidates.find((candidate) => candidate.id === survivor.id)).toEqual(
      expect.objectContaining({ id: survivor.id, reasons: ["same_phone", "same_name"] }),
    );
    expect(await listDiverMergeDuplicateIds(db, shop.id)).toEqual(
      expect.arrayContaining([source.id, survivor.id]),
    );

    const [phoneMatch] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Jules Other", phone: "+1 305 555 0142" })
      .returning();
    if (!phoneMatch) throw new Error("phone candidate insert failed");
    await db.insert(personRoles).values({ personId: phoneMatch.id, role: "diver" });
    const withPhone = await listDiverMergeCandidates(db, shop.id, source.id);
    expect(withPhone.find((candidate) => candidate.id === phoneMatch.id)?.reasons).toContain(
      "same_phone",
    );
  });

  it("moves diver history atomically and leaves activity subjects on the original id", async () => {
    const { db, shop, owner, trip, source, survivor } = await mergeFixtures();
    await db.insert(certifications).values({
      shopId: shop.id,
      personId: source.id,
      agency: "padi",
      level: "open_water",
      identifier: "MAYA-OW-1",
      status: "verified",
    });
    await db.insert(rentalFitProfiles).values({
      shopId: shop.id,
      personId: source.id,
      bcdSize: "M",
    });
    await db.insert(priorVisits).values({
      shopId: shop.id,
      personId: source.id,
      visitedOn: "2025-05-02",
      title: "Reef day",
      dedupeKey: "prior-maya-1",
      importedAt: new Date("2025-05-03T00:00:00.000Z"),
    });
    const [booking] = await db
      .insert(bookings)
      .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: source.id })
      .returning({ id: bookings.id });
    if (!booking) throw new Error("booking fixture insert failed");
    await db.insert(internalNotes).values({
      shopId: shop.id,
      personId: source.id,
      bookingId: booking.id,
      body: "Bring the smaller BCD.",
      createdByPersonId: owner.id,
    });
    await db.insert(activityEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      actorPersonId: owner.id,
      subjectPersonId: source.id,
      code: "note_added",
      params: { actor: "Owner", diver: "Source Diver" },
      occurredAt: new Date("2026-08-25T00:00:00.000Z"),
    });
    // The diver's own private word about the day (D40). It is theirs, not the
    // shop's, so it must land on the survivor — and it is the one row here
    // whose live-uniqueness is per *booking*, which is why moving it cannot
    // collide the way a per-person singleton can.
    await db.insert(recapPulses).values({
      shopId: shop.id,
      bookingId: booking.id,
      tripId: trip.id,
      personId: source.id,
      categories: ["gear"],
      note: "The BCD was loose all day.",
    });

    const result = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(result).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });

    expect(
      (await db.select().from(certifications).where(eq(certifications.personId, survivor.id))).map(
        (row) => row.identifier,
      ),
    ).toEqual(["MAYA-OW-1"]);
    expect(
      (
        await db.select().from(rentalFitProfiles).where(eq(rentalFitProfiles.personId, survivor.id))
      ).map((row) => row.bcdSize),
    ).toEqual(["M"]);
    expect(
      (await db.select().from(priorVisits).where(eq(priorVisits.personId, survivor.id))).map(
        (row) => row.dedupeKey,
      ),
    ).toEqual(["prior-maya-1"]);
    expect((await db.select().from(bookings).where(eq(bookings.id, booking.id)))[0]?.personId).toBe(
      survivor.id,
    );
    expect(
      (await db.select().from(internalNotes).where(eq(internalNotes.personId, survivor.id))).length,
    ).toBe(1);
    expect(
      (await db.select().from(activityEvents).where(eq(activityEvents.bookingId, booking.id)))[0]
        ?.subjectPersonId,
    ).toBe(source.id);
    expect(
      (await db.select().from(recapPulses).where(eq(recapPulses.personId, survivor.id))).map(
        (row) => row.note,
      ),
    ).toEqual(["The BCD was loose all day."]);

    const [merged] = await db.select().from(people).where(eq(people.id, source.id));
    expect(merged).toMatchObject({
      deletedAt: expect.any(Date),
      mergedIntoPersonId: survivor.id,
      mergedByPersonId: owner.id,
      mergedAt: expect.any(Date),
    });
  });

  it("refuses a shared trip, anonymized source, and unauthorized actor without moving rows", async () => {
    const { db, shop, owner, trip, source, survivor } = await mergeFixtures();
    await db.insert(bookings).values([
      { bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: source.id },
      { bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: survivor.id },
    ]);
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "booking_conflict" });

    const [sourceAfterConflict] = await db.select().from(people).where(eq(people.id, source.id));
    expect(sourceAfterConflict?.mergedIntoPersonId).toBeNull();

    await db
      .update(people)
      .set({ deletedAt: new Date("2026-08-25T00:00:00.000Z"), anonymizedAt: nowDate() })
      .where(eq(people.id, source.id));
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "anonymized" });
    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: source.id,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });
  });
});

/**
 * **A seat that is already over does not block a merge** (issue #2177). A
 * cancelled seat, or any seat on a deleted departure, cannot be resolved any
 * further — there is no way to remove a cancelled booking — so refusing on it
 * blocked two records that both once sat on one departure forever: a walk-in
 * entered twice at the counter whose duplicate seat was cancelled is exactly
 * that. Such a seat on the merged-away record stays there, keeping its pointer
 * and the departure log intact; the `(trip_id, person_id)` key never sees two
 * seats under the kept record. Two live seats still refuse, and so does a live
 * seat moving onto a kept record whose own seat is cancelled, because the key
 * has room for one seat per person and the live one must not be left behind.
 */
describe("diver record merge, a seat that is already over", () => {
  async function seatBoth(
    f: Awaited<ReturnType<typeof mergeFixtures>>,
    sourceStatus: "booked" | "cancelled",
    survivorStatus: "booked" | "cancelled",
  ) {
    const [sourceSeat, survivorSeat] = await f.db
      .insert(bookings)
      .values([
        {
          bookedAs: "diver",
          shopId: f.shop.id,
          tripId: f.trip.id,
          personId: f.source.id,
          status: sourceStatus,
        },
        {
          bookedAs: "diver",
          shopId: f.shop.id,
          tripId: f.trip.id,
          personId: f.survivor.id,
          status: survivorStatus,
        },
      ])
      .returning({ id: bookings.id });
    if (!sourceSeat || !survivorSeat) throw new Error("seat insert failed");
    return { sourceSeat, survivorSeat };
  }
  const merge = (f: Awaited<ReturnType<typeof mergeFixtures>>, flip = false) =>
    mergeDiverRecords({
      db: f.db,
      shopId: f.shop.id,
      personId: flip ? f.survivor.id : f.source.id,
      survivorId: flip ? f.source.id : f.survivor.id,
      actorPersonId: f.owner.id,
    });
  const holder = async (f: Awaited<ReturnType<typeof mergeFixtures>>, id: string) =>
    (
      await f.db.select({ personId: bookings.personId }).from(bookings).where(eq(bookings.id, id))
    )[0]?.personId;

  it("merges when the merged-away record's seat is cancelled, and leaves that seat behind", async () => {
    const f = await mergeFixtures();
    const { sourceSeat, survivorSeat } = await seatBoth(f, "cancelled", "booked");
    expect(await merge(f)).toEqual({
      ok: true,
      survivorId: f.survivor.id,
      mergedPersonId: f.source.id,
    });
    expect(await holder(f, sourceSeat.id)).toBe(f.source.id);
    expect(await holder(f, survivorSeat.id)).toBe(f.survivor.id);
  });

  it("merges when both seats are cancelled, and moves neither", async () => {
    const f = await mergeFixtures();
    const { sourceSeat, survivorSeat } = await seatBoth(f, "cancelled", "cancelled");
    expect((await merge(f)).ok).toBe(true);
    expect(await holder(f, sourceSeat.id)).toBe(f.source.id);
    expect(await holder(f, survivorSeat.id)).toBe(f.survivor.id);
  });

  it("merges two seats on a deleted departure, leaving the merged-away one behind", async () => {
    const f = await mergeFixtures();
    const { sourceSeat, survivorSeat } = await seatBoth(f, "booked", "booked");
    await f.db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, f.trip.id));
    expect((await merge(f)).ok).toBe(true);
    expect(await holder(f, sourceSeat.id)).toBe(f.source.id);
    expect(await holder(f, survivorSeat.id)).toBe(f.survivor.id);
  });

  it("still moves the merged-away record's other seats to the kept record", async () => {
    const f = await mergeFixtures();
    const { sourceSeat } = await seatBoth(f, "cancelled", "booked");
    const [otherTrip] = await f.db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.shopId, f.shop.id), sql`${trips.id} <> ${f.trip.id}`))
      .limit(1);
    if (!otherTrip) throw new Error("merge fixture needs a second trip");
    const [elsewhere] = await f.db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: f.shop.id,
        tripId: otherTrip.id,
        personId: f.source.id,
        status: "cancelled",
      })
      .returning({ id: bookings.id });
    if (!elsewhere) throw new Error("seat insert failed");
    expect((await merge(f)).ok).toBe(true);
    expect(await holder(f, sourceSeat.id)).toBe(f.source.id);
    // Cancelled too, but on a departure the kept record never sat on: it moves.
    expect(await holder(f, elsewhere.id)).toBe(f.survivor.id);
  });

  it("refuses a live seat onto a kept record whose seat is cancelled, and merges the other way", async () => {
    const f = await mergeFixtures();
    const { sourceSeat, survivorSeat } = await seatBoth(f, "booked", "cancelled");
    expect(await merge(f)).toEqual({ ok: false, reason: "booking_conflict" });
    expect(await holder(f, sourceSeat.id)).toBe(f.source.id);
    const [untouched] = await f.db.select().from(people).where(eq(people.id, f.source.id));
    expect(untouched?.mergedIntoPersonId).toBeNull();

    // Kept the other way round, the cancelled seat is the one left behind.
    expect((await merge(f, true)).ok).toBe(true);
    expect(await holder(f, sourceSeat.id)).toBe(f.source.id);
    expect(await holder(f, survivorSeat.id)).toBe(f.survivor.id);
    const [merged] = await f.db.select().from(people).where(eq(people.id, f.survivor.id));
    expect(merged?.mergedIntoPersonId).toBe(f.source.id);
  });

  it("still refuses two live seats on one departure", async () => {
    const f = await mergeFixtures();
    await seatBoth(f, "booked", "booked");
    expect(await merge(f)).toEqual({ ok: false, reason: "booking_conflict" });
    expect(await merge(f, true)).toEqual({ ok: false, reason: "booking_conflict" });
  });
});

/**
 * The merge moves history table by table from a hard-coded list, so a table
 * added tomorrow with a `person_id` is silently forgotten: no error, no failing
 * test, just a row left pointing at a diver the shop just removed. That is how
 * `gear_reservations` was missed. This holds the answers exhaustive against the
 * live schema, which is the only place the truth is.
 */
describe("every person_id column in the schema has a merge answer", () => {
  it("classifies each one as moved, refused, or deliberately left alone", async () => {
    const { db } = ctx;
    const result = await db.execute(sql`
      select table_name
      from information_schema.columns
      where table_schema = 'public' and column_name = 'person_id'
      order by table_name
    `);
    const inSchema = result.rows.map((row) => String((row as { table_name: string }).table_name));
    expect(inSchema.length).toBeGreaterThan(20);

    const classified = new Set<string>([
      ...DIVER_HISTORY_TABLES,
      ...STAFF_HISTORY_TABLES,
      ...STAFF_PERSON_ONLY_TABLES,
      ...Object.keys(PERSON_TABLES_DELIBERATELY_UNMOVED),
    ]);
    expect(inSchema.filter((table) => !classified.has(table))).toEqual([]);
    // And nothing is classified that the schema no longer has.
    expect([...classified].filter((table) => !inSchema.includes(table)).sort()).toEqual([]);
  });

  /**
   * The case above could not see a column called anything else, and most of
   * them are: `subject_person_id`, `actor_person_id`, `recorded_by_person_id`.
   * So the guard written to stop a table being forgotten had a blind spot the
   * exact shape of a naming convention — `activity_events.subject_person_id`
   * sat in it from the day it was written, and `trip_desk_events` (slice 16d)
   * landed in it without anything going red.
   *
   * `like '%person_id'` is the version that sees them. Every pair is either
   * moved with the diver or has a written reason for staying, and the reasons
   * are almost all the same one: attribution belongs to the shop.
   */
  it("classifies the prefixed person columns too", async () => {
    const { db } = ctx;
    const result = await db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and column_name like '%person_id'
        and column_name <> 'person_id'
      order by table_name, column_name
    `);
    const inSchema = result.rows.map((row) => {
      const { table_name, column_name } = row as { table_name: string; column_name: string };
      return `${table_name}.${column_name}`;
    });
    expect(inSchema.length).toBeGreaterThan(20);

    const classified = new Set<string>(Object.keys(PERSON_COLUMNS_DELIBERATELY_UNMOVED));
    expect(inSchema.filter((pair) => !classified.has(pair))).toEqual([]);
    expect([...classified].filter((pair) => !inSchema.includes(pair)).sort()).toEqual([]);
  });

  /**
   * The two cases above find a person column by its *name*. A foreign key to
   * `people` under any other name (`guardian_id`, `instructor_id`, a column a
   * future table calls `diver_id`) would slip past both, so this one asks the
   * catalog for the constraints themselves: every column that references
   * `people` must have a merge answer, whatever it is called.
   */
  it("classifies every foreign key that references people, whatever its column is called", async () => {
    const { db } = ctx;
    const result = await db.execute(sql`
      select cl.relname as table_name, att.attname as column_name
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class ref on ref.oid = con.confrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
      cross join lateral unnest(con.conkey) as k(attnum)
      join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
      where con.contype = 'f' and ref.relname = 'people' and ns.nspname = 'public'
      order by 1, 2
    `);
    const foreignKeys = result.rows.map((row) => {
      const { table_name, column_name } = row as { table_name: string; column_name: string };
      return { table: table_name, column: column_name };
    });
    expect(foreignKeys.length).toBeGreaterThan(20);

    const bareTables = new Set<string>([
      ...DIVER_HISTORY_TABLES,
      ...STAFF_HISTORY_TABLES,
      ...STAFF_PERSON_ONLY_TABLES,
      ...Object.keys(PERSON_TABLES_DELIBERATELY_UNMOVED),
    ]);
    const unanswered = foreignKeys
      .filter(({ table, column }) =>
        column === "person_id"
          ? !bareTables.has(table)
          : !(`${table}.${column}` in PERSON_COLUMNS_DELIBERATELY_UNMOVED) &&
            !(`${table}.${column}` in PERSON_REFERENCES_OUTSIDE_THE_NAMING_CONVENTION),
      )
      .map(({ table, column }) => `${table}.${column}`);
    expect(unanswered).toEqual([]);
    // And the outside-the-convention list names only references that exist.
    const present = new Set(foreignKeys.map(({ table, column }) => `${table}.${column}`));
    expect(
      Object.keys(PERSON_REFERENCES_OUTSIDE_THE_NAMING_CONVENTION).filter(
        (pair) => !present.has(pair),
      ),
    ).toEqual([]);
  });

  /**
   * The preview's counts are the whole of what moves only if every moved
   * table is counted, once. A table added to the moved list and forgotten here
   * would move rows the staffer was never shown.
   */
  it("counts every moved table in exactly one preview group", () => {
    const grouped: string[] = Object.values(DIVER_MERGE_COUNT_GROUPS).flat();
    expect([...grouped].sort()).toEqual([...DIVER_HISTORY_TABLES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  /**
   * `activity_events.subject_person_id` has always stayed put, and the case at
   * the top of this file pins it. `trip_desk_events` takes the same answer, so
   * this says so out loud rather than leaving the new table's behaviour to be
   * inferred from a map: a trail records who a thing happened to at the time,
   * and this one is read by `trip_id`, so nothing is lost from the survivor's
   * page by leaving it. The actor beside it is attribution and never moves
   * either.
   */
  it("leaves a desk event's subject and actor on the ids that were there", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(eq(trips.shopId, shop.id))
      .orderBy(trips.id)
      .limit(1);
    if (!trip) throw new Error("expected a seeded trip");
    const [event] = await db
      .insert(tripDeskEvents)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        kind: "seat_taken",
        actorPersonId: owner.id,
        subjectPersonId: source.id,
      })
      .returning();
    if (!event) throw new Error("desk event fixture insert failed");

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });

    const [after] = await db
      .select({
        subjectPersonId: tripDeskEvents.subjectPersonId,
        actorPersonId: tripDeskEvents.actorPersonId,
      })
      .from(tripDeskEvents)
      .where(eq(tripDeskEvents.id, event.id));
    expect(after?.subjectPersonId).toBe(source.id);
    expect(after?.actorPersonId).toBe(owner.id);
  });

  it("moves a bookingless counter rental onto the survivor", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    const [item] = await db
      .insert(gearItems)
      .values({
        shopId: shop.id,
        kind: "bcd",
        label: "BCD-07",
        size: "M",
      })
      .returning();
    if (!item) throw new Error("gear fixture insert failed");
    const [reservation] = await db
      .insert(gearReservations)
      .values({
        shopId: shop.id,
        gearItemId: item.id,
        personId: source.id,
        reservedFrom: "2026-09-01",
        reservedUntil: "2026-09-02",
      })
      .returning();
    if (!reservation) throw new Error("gear reservation fixture insert failed");

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });

    const [moved] = await db
      .select({ personId: gearReservations.personId })
      .from(gearReservations)
      .where(eq(gearReservations.id, reservation.id));
    expect(moved?.personId).toBe(survivor.id);
  });
});

/**
 * `no_certification_declared_at` and `no_certification_cleared_at` are read as
 * a pair -- declared-and-not-cleared is the diver's standing "I hold no card"
 * stamp -- so merging them column by column could pair a live declaration with
 * the other record's older clear and erase the stamp everywhere at once.
 */
describe("merging the no-certification stamp", () => {
  it("keeps a live declaration rather than pairing it with the other record's clear", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db
      .update(people)
      .set({
        noCertificationDeclaredAt: new Date("2026-08-20T00:00:00.000Z"),
        noCertificationClearedAt: null,
        noCertificationClearedByPersonId: null,
      })
      .where(eq(people.id, survivor.id));
    await db
      .update(people)
      .set({
        noCertificationDeclaredAt: new Date("2026-08-01T00:00:00.000Z"),
        noCertificationClearedAt: new Date("2026-08-05T00:00:00.000Z"),
        noCertificationClearedByPersonId: owner.id,
      })
      .where(eq(people.id, source.id));

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });

    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.noCertificationDeclaredAt).toEqual(new Date("2026-08-20T00:00:00.000Z"));
    expect(merged?.noCertificationClearedAt).toBeNull();
    expect(merged?.noCertificationClearedByPersonId).toBeNull();
  });

  it("takes the newer declaration's own clear when that is the source's", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db
      .update(people)
      .set({
        noCertificationDeclaredAt: new Date("2026-08-01T00:00:00.000Z"),
        noCertificationClearedAt: null,
      })
      .where(eq(people.id, survivor.id));
    await db
      .update(people)
      .set({
        noCertificationDeclaredAt: new Date("2026-08-20T00:00:00.000Z"),
        noCertificationClearedAt: new Date("2026-08-22T00:00:00.000Z"),
        noCertificationClearedByPersonId: owner.id,
      })
      .where(eq(people.id, source.id));

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.noCertificationDeclaredAt).toEqual(new Date("2026-08-20T00:00:00.000Z"));
    expect(merged?.noCertificationClearedAt).toEqual(new Date("2026-08-22T00:00:00.000Z"));
    expect(merged?.noCertificationClearedByPersonId).toBe(owner.id);
  });
});

/**
 * The one tenant check in a rewrite that repoints twenty-one tables. Every
 * other refusal is about the state of the two rows; this is the one that stops
 * a staffer folding another shop's diver into their own roster, and it had no
 * test.
 */
describe("merge tenant isolation", () => {
  it("refuses a survivor that belongs to another shop", async () => {
    const { db, shop, owner, source } = await mergeFixtures();
    const [otherShop] = await db
      .insert(shops)
      .values({ slug: `other-${source.id.slice(0, 8)}`, name: "Other Shop", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("second shop insert failed");
    const [foreign] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Maya Rivera" })
      .returning();
    if (!foreign) throw new Error("foreign person insert failed");
    await db.insert(personRoles).values({ personId: foreign.id, role: "diver" });

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: foreign.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "not_found" });

    // Neither row moved.
    const [sourceAfter] = await db.select().from(people).where(eq(people.id, source.id));
    const [foreignAfter] = await db.select().from(people).where(eq(people.id, foreign.id));
    expect(sourceAfter?.mergedIntoPersonId).toBeNull();
    expect(foreignAfter?.mergedIntoPersonId).toBeNull();
  });

  it("refuses when the caller names a shop neither person belongs to", async () => {
    const { db, owner, source, survivor } = await mergeFixtures();

    expect(
      await mergeDiverRecords({
        db,
        shopId: crypto.randomUUID(),
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: false, reason: "not_authorized" });
  });

  /** The candidate list is the door to the merge, and never crosses a shop. */
  it("never offers another shop's diver as a duplicate", async () => {
    const { db, shop, source } = await mergeFixtures();
    const [otherShop] = await db
      .insert(shops)
      .values({ slug: `other2-${source.id.slice(0, 8)}`, name: "Other Shop 2", timezone: "UTC" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("second shop insert failed");
    const [foreign] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Maya Rivera", phone: "+1 (305) 555-0142" })
      .returning();
    if (!foreign) throw new Error("foreign person insert failed");
    await db.insert(personRoles).values({ personId: foreign.id, role: "diver" });

    const candidates = await listDiverMergeCandidates(db, shop.id, source.id);
    expect(candidates.map((candidate) => candidate.id)).not.toContain(foreign.id);
  });
});

/**
 * `rental_fit_profiles` and `last_minute_list_entries` are one row per person
 * by construction. A diver fitted at the counter under each of their two
 * records made the blanket repoint raise 23505, which rolled the whole merge
 * back to `record_conflict` -- so the merge became permanently impossible
 * through the UI, with nothing saying which row to delete to unblock it.
 */
describe("merging a one-row-per-person record", () => {
  it("completes when both records carry a rental fit profile", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db.insert(rentalFitProfiles).values([
      { shopId: shop.id, personId: survivor.id, wetsuitSize: "M" },
      { shopId: shop.id, personId: source.id, wetsuitSize: "L" },
    ]);

    expect(
      await mergeDiverRecords({
        db,
        shopId: shop.id,
        personId: source.id,
        survivorId: survivor.id,
        actorPersonId: owner.id,
      }),
    ).toEqual({ ok: true, survivorId: survivor.id, mergedPersonId: source.id });

    // The survivor is the record the shop chose to keep, so its sizes stand.
    const profiles = await db
      .select()
      .from(rentalFitProfiles)
      .where(inArray(rentalFitProfiles.personId, [source.id, survivor.id]));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.personId).toBe(survivor.id);
    expect(profiles[0]?.wetsuitSize).toBe("M");
  });

  it("moves the source's profile when the survivor has none", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db
      .insert(rentalFitProfiles)
      .values({ shopId: shop.id, personId: source.id, wetsuitSize: "L" });

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const profiles = await db
      .select()
      .from(rentalFitProfiles)
      .where(inArray(rentalFitProfiles.personId, [source.id, survivor.id]));
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.personId).toBe(survivor.id);
    expect(profiles[0]?.wetsuitSize).toBe("L");
  });
});

describe("merging a diver's signed releases (issue #2080)", () => {
  /** A release on the source, sealed the way `completeWaiver` seals it — or with a broken seal. */
  async function sealedRelease(
    db: Awaited<ReturnType<typeof mergeFixtures>>["db"],
    shopId: string,
    personId: string,
    seal: "valid" | "broken",
  ) {
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shopId))
      .limit(1);
    if (!template) throw new Error("expected a seeded waiver template");
    const signedAt = nowDate();
    const [row] = await db
      .insert(waiverRecords)
      .values({
        shopId,
        personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        status: "completed",
        signedName: "Maya Rivera",
        signatureMethod: "typed",
        tokenHash: `hash-${crypto.randomUUID()}`,
        expiresAt: signedAt,
        consentedAt: signedAt,
        signedAt,
        completedAt: signedAt,
      })
      .returning();
    if (!row) throw new Error("release insert failed");
    const integrityHash = computeWaiverIntegrityHash(
      seal === "valid" ? row : { ...row, signedName: "Somebody Else" },
    );
    await db
      .update(waiverRecords)
      .set({ integrityHash, integrityVersion: WAIVER_INTEGRITY_VERSION_SIGNED })
      .where(eq(waiverRecords.id, row.id));
    return row.id;
  }

  it("re-seals a verified release over the survivor, so it never reads as tampered", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    const releaseId = await sealedRelease(db, shop.id, source.id, "valid");

    const merged = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    expect(merged.ok).toBe(true);

    const [moved] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, releaseId));
    if (!moved) throw new Error("release vanished");
    expect(moved.personId).toBe(survivor.id);
    expect(moved.movedFromPersonId).toBe(source.id);
    expect(moved.movedByPersonId).toBe(owner.id);
    expect(moved.integrityVersion).toBe(WAIVER_INTEGRITY_VERSION_MOVED);
    expect(verifyWaiverIntegrity(moved)).toBe("valid");
  });

  it("moves a release whose seal already failed without re-sealing it", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    const releaseId = await sealedRelease(db, shop.id, source.id, "broken");

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const [moved] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, releaseId));
    if (!moved) throw new Error("release vanished");
    expect(moved.personId).toBe(survivor.id);
    expect(moved.integrityVersion).toBe(WAIVER_INTEGRITY_VERSION_SIGNED);
    expect(verifyWaiverIntegrity(moved)).toBe("invalid");
  });

  it("keeps a release valid across a second merge", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    const releaseId = await sealedRelease(db, shop.id, source.id, "valid");
    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });
    const [third] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Maya Rivera" })
      .returning();
    if (!third) throw new Error("third record insert failed");
    await db.insert(personRoles).values({ personId: third.id, role: "diver" });

    const again = await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: survivor.id,
      survivorId: third.id,
      actorPersonId: owner.id,
    });
    expect(again.ok).toBe(true);
    const [moved] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, releaseId));
    expect(moved?.personId).toBe(third.id);
    expect(moved?.movedFromPersonId).toBe(survivor.id);
    expect(moved && verifyWaiverIntegrity(moved)).toBe("valid");
  });
});

/** A staffer's "18 or older" (H-100) is an answer and its author, kept together. */
describe("merging an 18-or-older answer", () => {
  it("takes the source's answer and who gave it when the survivor has none", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    const attestedAt = new Date("2026-10-06T15:00:00.000Z");
    await db
      .update(people)
      .set({ adultAttestedAt: attestedAt, adultAttestedByPersonId: owner.id })
      .where(eq(people.id, source.id));

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.adultAttestedAt).toEqual(attestedAt);
    expect(merged?.adultAttestedByPersonId).toBe(owner.id);
  });

  it("drops the answer when either record has a date of birth", async () => {
    const { db, shop, owner, source, survivor } = await mergeFixtures();
    await db
      .update(people)
      .set({
        adultAttestedAt: new Date("2026-10-06T15:00:00.000Z"),
        adultAttestedByPersonId: owner.id,
      })
      .where(eq(people.id, source.id));
    await db.update(people).set({ dateOfBirth: "2011-04-09" }).where(eq(people.id, survivor.id));

    await mergeDiverRecords({
      db,
      shopId: shop.id,
      personId: source.id,
      survivorId: survivor.id,
      actorPersonId: owner.id,
    });

    const [merged] = await db.select().from(people).where(eq(people.id, survivor.id));
    expect(merged?.dateOfBirth).toBe("2011-04-09");
    expect(merged?.adultAttestedAt).toBeNull();
    expect(merged?.adultAttestedByPersonId).toBeNull();
  });
});
