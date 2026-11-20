import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getTripManifest } from "@/db/manifests";
import { rollCallEvents, trips } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { editTripSection, getTripRoster } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { ROLL_CALL_WITNESS_HEADERS } from "@/lib/roll-call-protocol";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { buildOfflineManifestCopies } from "./index";

/**
 * The offline recovery drill (issue 4787), on a real PostgreSQL server.
 *
 * A restore is simulated the way a point-in-time branch behaves: every table is put back to the
 * rows it held at the backup instant, in one step, while the "device" keeps what it captured after
 * that instant. The device is a plain object holding a saved copy and a queue, so what it sends is
 * exactly what it was handed.
 *
 * The drill proves what the application controls: a rewound database never accepts evidence from
 * the lost branch as its own, a lost receipt is retried to the same single row, and a paused
 * server leaves the device queue and the database untouched. It does not prove the external fence
 * (stopping old writers, erasure and access history), which the runbook keeps as a stop.
 */
vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());
const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const { POST } = await import("@/app/api/offline-manifests/sync/route");

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/offline-manifests/sync", {
      method: "POST",
      headers: { ...ROLL_CALL_WITNESS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Copy every public table aside; the returned function puts them all back, rewinding the server. */
async function backup(db: AppDb): Promise<() => Promise<void>> {
  await db.execute(sql`drop schema if exists bak cascade`);
  await db.execute(sql`create schema bak`);
  const { rows } = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  const names = rows.map((row) => row.tablename);
  for (const name of names)
    await db.execute(sql.raw(`create table bak."${name}" as table public."${name}"`));
  return async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const name of names) {
        await tx.execute(sql.raw(`delete from public."${name}"`));
        await tx.execute(sql.raw(`insert into public."${name}" select * from bak."${name}"`));
      }
    });
  };
}

async function drillContext() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "lean");
  const { db } = pg;
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!trip) throw new Error("trip missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  if (!seat) throw new Error("seat missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue({
    user: {
      shopId: shop.id,
      personId: staffPersonId,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: "staff@demo.invalid",
      roles: ["owner"],
    },
  });
  return { db, shop, trip, booking: seat.booking, staffPersonId };
}

/** What the device holds after saving a copy, and the event it queues from it. */
async function deviceCapture(c: Awaited<ReturnType<typeof drillContext>>) {
  const saved = (await buildOfflineManifestCopies(c.db, c.shop, c.staffPersonId, [c.trip.id]))
    .payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  const clientEventId = crypto.randomUUID();
  const event = {
    tripId: c.trip.id,
    bookingId: c.booking.id,
    clientEventId,
    snapshotId: saved.snapshotId,
    erasureEpochToken: saved.erasureEpochToken,
    rollCallWitness: saved.rollCallWitnesses?.[`seat:${c.booking.id}:after_dive_1`],
    meetingDay: saved.rollCallMeetingDay ?? 0,
    snapshotSavedAt: nowDate().toISOString(),
    occurredAt: nowDate().toISOString(),
    checkpoint: "after_dive_1",
    status: "not_boarded",
  };
  return { clientEventId, body: { events: [event] } };
}

const storedRows = (db: AppDb, id: string) =>
  db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id));

describePostgres("offline recovery drill", () => {
  it("never accepts evidence from a lost branch after the meeting is changed differently", async () => {
    const c = await drillContext();
    const restore = await backup(c.db);

    // After the backup the crew move the end time and a device saves a copy of that meeting.
    expect(
      (
        await editTripSection(c.db, c.shop.id, c.trip.id, {
          endsAt: new Date(c.trip.endsAt.getTime() + 3_600_000),
        })
      ).ok,
    ).toBe(true);
    const lost = await deviceCapture(c);

    // The database is restored to before that edit, and the crew make a different edit.
    await restore();
    expect(
      (
        await editTripSection(c.db, c.shop.id, c.trip.id, {
          endsAt: new Date(c.trip.endsAt.getTime() + 7_200_000),
        })
      ).ok,
    ).toBe(true);

    const response = await post(lost.body);
    expect(response.status).toBe(200);
    expect((await response.json()).results).toContainEqual({
      clientEventId: lost.clientEventId,
      status: "rejected",
      reason: "review_required",
    });
    expect(await storedRows(c.db, lost.clientEventId)).toHaveLength(0);
    // The manifest never shows the lost evidence as this meeting's.
    const manifest = await getTripManifest(c.db, c.shop.id, c.trip.id, "after_dive_1");
    expect(
      manifest?.divers.find((diver) => diver.bookingId === c.booking.id)?.rollCall?.state,
    ).not.toBe("not_boarded");
  });

  it("retries a lost receipt to one row, and refuses a reused id on another subject's behalf", async () => {
    const c = await drillContext();
    const device = await deviceCapture(c);
    const restore = await backup(c.db);

    // The server accepts the event, then the receipt is lost and the database is restored.
    const first = await (await post(device.body)).json();
    expect(first.results).toContainEqual({
      clientEventId: device.clientEventId,
      status: "applied",
    });
    await restore();
    expect(await storedRows(c.db, device.clientEventId)).toHaveLength(0);

    // The device retries the same queue, twice. The meeting is unchanged, so it is accepted once.
    const retry = await (await post(device.body)).json();
    expect(retry.results).toContainEqual({
      clientEventId: device.clientEventId,
      status: "applied",
    });
    const again = await (await post(device.body)).json();
    expect(again.results).toContainEqual({
      clientEventId: device.clientEventId,
      status: "duplicate",
    });
    expect(await storedRows(c.db, device.clientEventId)).toHaveLength(1);
  });

  it("leaves the queue and the database untouched while the operator pause is on", async () => {
    const c = await drillContext();
    const device = await deviceCapture(c);
    const countRows = async () => {
      const { rows } = await c.db.execute<{ n: string }>(
        sql`select count(*)::text as n from roll_call_events`,
      );
      return rows[0]?.n;
    };
    const before = await countRows();
    vi.stubEnv("DIVEDAY_OFFLINE_SYNC_PAUSED", "1");
    try {
      const response = await post(device.body);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "offline_sync_paused" });
      expect(await countRows()).toBe(before);
    } finally {
      vi.stubEnv("DIVEDAY_OFFLINE_SYNC_PAUSED", "");
    }
    // Lifting the pause lets the very same queue settle, still once.
    expect((await (await post(device.body)).json()).results).toContainEqual({
      clientEventId: device.clientEventId,
      status: "applied",
    });
    const [tripRow] = await c.db.select().from(trips).where(eq(trips.id, c.trip.id));
    expect(tripRow).toBeDefined();
  });
});
