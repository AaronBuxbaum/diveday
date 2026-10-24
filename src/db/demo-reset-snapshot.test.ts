import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import type { AppDb } from "./client";
import type * as Snapshot from "./demo-reset-snapshot";
import { boats, bookings, internalNotes, people, personRoles, trips, userAccounts } from "./schema";
import type * as Seed from "./seed";

/**
 * The e2e reset replays a copy of the re-seed instead of running it
 * (src/db/demo-reset-snapshot.ts). These hold it to the one promise that makes
 * that safe: **the shop a replay leaves is the shop a real reset leaves.**
 */

type Export = Map<string, string[]>;

/** Every row of every table in `public`, as sorted JSON, per table. */
async function exportDatabase(db: AppDb): Promise<Export> {
  const tables = (
    (await db.execute(
      sql`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
    )) as unknown as { rows: { name: string }[] }
  ).rows.map((row) => row.name);
  const out: Export = new Map();
  for (const table of tables) {
    const result = (await db.execute(
      sql.raw(`select to_jsonb(t)::text as row from public."${table}" t`),
    )) as unknown as { rows: { row: string }[] };
    out.set(table, result.rows.map((r) => r.row).sort());
  }
  return out;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Values two *real* resets write differently, so no replay can match them
 * either: they are what "with ids normalized" has to cover beyond the ids. A
 * new entry is a new source of non-determinism in the seed, and is worth a line
 * saying so.
 */
const NONDETERMINISTIC: Record<string, string> = {
  "waiver_records.integrity_hash":
    "the seal hashes the record including its own id (src/db/seed-waiver-evidence.ts)",
  "course_form_records.integrity_hash": "the seal hashes the record including its own id",
  // Theo Lindqvist signs two course forms, and which of the two takes the
  // earlier of the two stamps varies between two real resets from the same
  // database (observed 2026-10-24); everything else about both records agrees.
  "course_form_records.signed_at": "a diver with two forms gets the two stamps in either order",
  "course_form_records.consented_at": "the same stamp as signed_at",
};

/**
 * An export with every generated identifier replaced by a name for the row it
 * identifies. A row's name is its table plus a hash of its content with every
 * id taken out, so two databases that hold the same rows under different ids
 * name them alike, and a foreign key compares by what it points at.
 */
function normalize(data: Export): Map<string, string[]> {
  const parsed = new Map(
    [...data].map(([table, rows]) => [
      table,
      rows.map((row) => JSON.parse(row) as Record<string, unknown>),
    ]),
  );
  const strip = (table: string, row: Record<string, unknown>) =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(row)
          .filter(([column]) => !(`${table}.${column}` in NONDETERMINISTIC) && column !== "seq")
          .map(([column, value]) => [column, JSON.stringify(value ?? null).replace(UUID, "<id>")]),
      ),
    );
  const names = new Map<string, string>();
  for (const [table, rows] of parsed) {
    for (const row of rows) {
      if (typeof row.id !== "string") continue;
      const digest = createHash("sha256").update(strip(table, row)).digest("hex").slice(0, 16);
      names.set(row.id, `${table}#${digest}`);
    }
  }
  return new Map(
    [...parsed].map(([table, rows]) => [
      table,
      rows
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(row)
                .filter(([column]) => column !== "seq")
                .map(([column, value]) => [
                  column,
                  `${table}.${column}` in NONDETERMINISTIC
                    ? "<nondeterministic>"
                    : JSON.stringify(value ?? null).replace(UUID, (id) => names.get(id) ?? "<id?>"),
                ]),
            ),
          ),
        )
        .sort(),
    ]),
  );
}

/** The tables whose rows differ between two exports, for a failure message that names them. */
function differingTables(left: Map<string, string[]>, right: Map<string, string[]>): string[] {
  const tables = new Set([...left.keys(), ...right.keys()]);
  return [...tables]
    .filter((table) => JSON.stringify(left.get(table)) !== JSON.stringify(right.get(table)))
    .sort();
}

/** Copy a row of `table` under a new id, with `changes` applied. */
async function copyRow(
  db: AppDb,
  table: string,
  id: string,
  changes: Record<string, unknown>,
): Promise<string> {
  const result = (await db.execute(
    sql`insert into ${sql.identifier(table)}
        select (jsonb_populate_record(null::${sql.identifier(table)},
          to_jsonb(t) || ${JSON.stringify(changes)}::jsonb || jsonb_build_object('id', gen_random_uuid()))).*
        from ${sql.identifier(table)} t where t.id = ${id}
        returning id`,
  )) as unknown as { rows: { id: string }[] };
  const [row] = result.rows;
  if (!row) throw new Error(`test setup: no ${table} row ${id} to copy`);
  return row.id;
}

/**
 * Drive the demo shop the way a spec does: a new departure with a booking on
 * it, a walk-up with a login, a note, a seeded booking cancelled, a seeded
 * departure deleted, a signed waiver re-signed, an order copied — and, given
 * a name, one *kept* row changed (every boat renamed), which a reset must
 * leave as it is.
 */
async function mutate(db: AppDb, shopId: string, boatName?: string): Promise<void> {
  const [trip] = await db.select().from(trips).where(eq(trips.shopId, shopId)).limit(1);
  const [booking] = await db.select().from(bookings).where(eq(bookings.shopId, shopId)).limit(1);
  if (!trip || !booking) throw new Error("test setup: the seeded schedule is empty");
  const newTrip = await copyRow(db, "trips", trip.id, { title: "A departure a spec added" });
  await copyRow(db, "bookings", booking.id, { trip_id: newTrip });
  await db
    .update(bookings)
    .set({ status: "cancelled" })
    .where(and(eq(bookings.shopId, shopId), eq(bookings.id, booking.id)));
  const [other] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), sql`${trips.id} <> ${trip.id}`))
    .limit(1);
  if (other) await db.update(trips).set({ deletedAt: nowDate() }).where(eq(trips.id, other.id));
  const [walkUp] = await db
    .insert(people)
    .values({ shopId, fullName: "Walk Up", email: "walk-up@example.com" })
    .returning({ id: people.id });
  if (!walkUp) throw new Error("test setup: no walk-up");
  await db.insert(personRoles).values({ personId: walkUp.id, role: "diver" });
  await db.insert(userAccounts).values({
    personId: walkUp.id,
    email: "walk-up@example.com",
    hashedPassword: "x",
    status: "active",
  });
  await db.insert(internalNotes).values({
    shopId,
    personId: walkUp.id,
    body: "Prefers the morning boat",
    createdByPersonId: walkUp.id,
  });
  await db.execute(
    sql`update waiver_records set signed_name = 'Someone Else' where id = (select id from waiver_records where shop_id = ${shopId} limit 1)`,
  );
  const order = (await db.execute(
    sql`select id from orders where shop_id = ${shopId} and stripe_invoice_id is null limit 1`,
  )) as unknown as { rows: { id: string }[] };
  if (order.rows[0]) await copyRow(db, "orders", order.rows[0].id, {});
  if (boatName) await db.update(boats).set({ name: boatName }).where(eq(boats.shopId, shopId));
}

/**
 * The modules under test, loaded into a registry of their own. The re-seed
 * stamps `created_at` from a per-process counter (`nextCreatedAt`,
 * src/db/seed-clock.ts) that never goes back to zero, so two real resets in one
 * process write the same rows a few hundred milliseconds apart. A fresh
 * registry starts the counter where a fresh server's does, so the reset each
 * side of a comparison runs is the first that process ever ran.
 */
async function freshModules(): Promise<{ snapshot: typeof Snapshot; seed: typeof Seed }> {
  vi.resetModules();
  return {
    snapshot: await import("./demo-reset-snapshot"),
    seed: await import("./seed"),
  };
}

describe("the e2e demo reset's snapshot", () => {
  it("leaves exactly the shop a real reset leaves, however a spec drove it", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const { resetDemoFromSnapshot } = (await freshModules()).snapshot;
    const fleet = await db
      .select({ id: boats.id, name: boats.name })
      .from(boats)
      .where(eq(boats.shopId, shop.id));

    // The first reset is a real one and captures the shadow from it.
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("captured");
    const captured = await exportDatabase(db);

    // A replay restores that state *literally* — same ids, same rows — except
    // the kept boat name a spec changed, which a reset keeps.
    await mutate(db, shop.id, "Renamed By A Spec");
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("snapshot");
    const replayed = await exportDatabase(db);
    expect(differingTables(captured, replayed)).toEqual(["boats"]);
    expect(
      (await db.select({ name: boats.name }).from(boats).where(eq(boats.shopId, shop.id))).every(
        (boat) => boat.name === "Renamed By A Spec",
      ),
    ).toBe(true);

    // And that state is what a fresh real reset produces, row for row once the
    // ids each run generates are named by what they identify. The fresh reset
    // runs on its own copy of the same seeded database: the re-seed hands out
    // people and seats in the order unordered reads return them, which is the
    // heap's order, so two real resets agree only from the same starting heap
    // (and do not on a heap a test has churned — see the note on NONDETERMINISTIC).
    // The boats get their names back first: the re-seed reads them.
    for (const boat of fleet) {
      await db.update(boats).set({ name: boat.name }).where(eq(boats.id, boat.id));
    }
    await mutate(db, shop.id);
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("snapshot");
    const again = normalize(await exportDatabase(db));
    const reference = await seededShopContext({ history: true });
    const { resetDemoSchedule } = (await freshModules()).seed;
    await resetDemoSchedule(reference.db, reference.shop.id, { history: true });
    const fresh = normalize(await exportDatabase(reference.db));
    expect(differingTables(fresh, again)).toEqual([]);
  }, 120_000);

  it("falls back to a real reset and captures again when the shadow no longer fits", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const { resetDemoFromSnapshot, capturedDemoResetPlan } = (await freshModules()).snapshot;
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("captured");
    // A shadow the replay can no longer use. The replay's transaction rolls back
    // whole, so the shop is never left half-cleared: the reset runs for real
    // and takes a fresh copy, and the copy after that is used again.
    const plan = capturedDemoResetPlan(db);
    expect(plan?.inserts.length).toBeGreaterThan(0);
    await db.execute(sql`drop table ${sql.raw(plan?.inserts[0]?.shadow ?? "missing")}`);
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("captured");
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("snapshot");
  }, 120_000);

  it("does what each foreign key's trigger would have, and refuses where it would have", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const { resetDemoFromSnapshot } = (await freshModules()).snapshot;
    // Three tables nothing in the clear half deletes from, one per kind of key,
    // made before the capture so it reads their keys.
    await db.execute(sql`create table public.probe_cascade (
      id serial primary key, trip_id uuid references trips(id) on delete cascade)`);
    await db.execute(sql`create table public.probe_null (
      id serial primary key, trip_id uuid references trips(id) on delete set null)`);
    await db.execute(sql`create table public.probe_refuse (
      id serial primary key, booking_id uuid references bookings(id))`);
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("captured");
    const [trip] = await db.select({ id: trips.id }).from(trips).where(eq(trips.shopId, shop.id));
    if (!trip) throw new Error("test setup: no seeded trip");

    // The replay puts the trip back under the same id; the rows naming it must
    // still have been treated as a real delete treats them.
    await db.execute(sql`insert into probe_cascade (trip_id) values (${trip.id})`);
    await db.execute(sql`insert into probe_null (trip_id) values (${trip.id})`);
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("snapshot");
    const survivors = (await db.execute(
      sql`select (select count(*) from probe_cascade)::int as cascaded,
                 (select count(*) from probe_null where trip_id is null)::int as nulled`,
    )) as unknown as { rows: { cascaded: number; nulled: number }[] };
    expect(survivors.rows[0]).toEqual({ cascaded: 0, nulled: 1 });

    // A key with no delete action: the trigger would have raised 23503, so the
    // replay refuses, rolls back, and the real reset raises it — the same
    // failure, naming the same key, that a missing delete always produced.
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id));
    if (!booking) throw new Error("test setup: no seeded booking");
    await db.execute(sql`insert into probe_refuse (booking_id) values (${booking.id})`);
    const before = await db.$count(bookings, eq(bookings.shopId, shop.id));
    await expect(resetDemoFromSnapshot(db, shop.id)).rejects.toMatchObject({
      cause: expect.objectContaining({ code: "23503" }),
    });
    // Nothing half-done: the replay rolled back whole.
    expect(await db.$count(bookings, eq(bookings.shopId, shop.id))).toBe(before);
  }, 120_000);

  it("refuses a replay naming a kept row that is gone", async () => {
    const { db, shop } = await seededShopContext({ history: true });
    const { resetDemoFromSnapshot } = (await freshModules()).snapshot;
    expect((await resetDemoFromSnapshot(db, shop.id)).mode).toBe("captured");
    // A boat the seeded departures sail on, removed behind the triggers' back,
    // so only the replay's own check can notice the shadow still names it.
    const [trip] = await db
      .select({ boatId: trips.boatId })
      .from(trips)
      .where(and(eq(trips.shopId, shop.id), sql`${trips.boatId} is not null`));
    if (!trip?.boatId) throw new Error("test setup: no seeded departure on a boat");
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.delete(boats).where(eq(boats.id, trip.boatId as string));
    });
    const outcome = await resetDemoFromSnapshot(db, shop.id).then(
      (reset) => reset.mode,
      () => "a real reset that failed",
    );
    expect(outcome).not.toBe("snapshot");
  }, 120_000);
});
