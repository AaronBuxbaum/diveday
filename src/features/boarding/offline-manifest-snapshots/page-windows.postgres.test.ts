import { eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { getTripManifests } from "@/db/manifests";
import { bookings, offlineManifestSnapshotRevisions, people } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { createTrip, editTrip } from "@/db/trips";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import {
  issueOfflineManifestSnapshotAtSchedule,
  nextOfflineManifestSnapshotRevision,
  readOfflineManifestRoster,
  readOfflineManifestRosterWithWindows,
} from "./store";

async function setup() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "history");
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const first = new Date("2035-04-10T12:00:00.000Z");
  const days = [0, 1].map((day) => ({
    dayNumber: day + 1,
    startsAt: new Date(first.getTime() + day * 86_400_000),
    endsAt: new Date(first.getTime() + day * 86_400_000 + 4 * 3_600_000),
  }));
  const trip = await createTrip(pg.db, {
    shopId: shop.id,
    title: "Page snapshot schedule race",
    startsAt: days[0].startsAt,
    endsAt: days[1].endsAt,
    capacity: 8,
    scheduleDays: days,
  });
  if (!trip) throw new Error("trip missing");
  const changed = [
    days[0],
    {
      ...days[1],
      startsAt: new Date(days[1].startsAt.getTime() + 3_600_000),
    },
  ];
  await nextOfflineManifestSnapshotRevision(pg.db, shop.id, trip.id);
  const read = await readOfflineManifestRoster(pg.db, shop.id, trip.id);
  if (!read) throw new Error("roster missing");
  const witness = {
    ...read,
    schedule: {
      startsAt: trip.startsAt.toISOString(),
      endsAt: trip.endsAt.toISOString(),
      meetingWindows: days.map(({ startsAt, endsAt }) => ({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })),
    },
  };
  const edit = () =>
    editTrip(pg.connect(), shop.id, trip.id, {
      title: trip.title,
      startsAt: days[0].startsAt,
      endsAt: changed[1].endsAt,
      capacity: trip.capacity,
      plannedDives: trip.plannedDives,
      scheduleDays: changed,
    });
  return { pg, shop, trip, witness, edit, days };
}

describePostgres("page snapshot claims against second-day schedule edits", () => {
  it("keeps roster and windows in one view when an old writer edits during the read", async () => {
    const { pg, shop, trip, edit, days } = await setup();
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Meeting Day Diver" })
      .returning({ id: people.id });
    await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" });
    vi.stubEnv("DIVEDAY_CLOCK", "2035-04-11T02:15:00.000Z");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    let release!: () => void;
    let observed!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      observed = resolve;
    });
    const reading = readOfflineManifestRosterWithWindows(pg.connect(), shop.id, trip.id, {
      afterScheduleRead: async () => {
        observed();
        await held;
      },
    });
    try {
      await ready;
      expect((await edit()).ok).toBe(true);
    } finally {
      release();
    }
    const captured = await reading;
    expect(captured?.windows).toEqual(days.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })));
    expect(captured?.manifests[0].trip.startsAt).toEqual(days[0].startsAt);
    expect(captured?.manifests[0].divers[0].rollCallContext?.meetingDay).toBe(1);
    const current = await getTripManifests(pg.db, shop.id, trip.id);
    expect(current?.[0].divers[0].rollCallContext?.meetingDay).toBe(0);
    if (!captured) throw new Error("page missing");
    const schedule = {
      startsAt: captured.manifests[0].trip.startsAt.toISOString(),
      endsAt: captured.manifests[0].trip.endsAt.toISOString(),
      meetingWindows: (captured.windows ?? []).map((day) => ({
        startsAt: day.startsAt.toISOString(),
        endsAt: day.endsAt.toISOString(),
      })),
    };
    expect(
      await issueOfflineManifestSnapshotAtSchedule(
        pg.connect(),
        shop.id,
        trip.id,
        captured,
        schedule,
      ),
    ).toEqual({ ok: false, reason: "snapshot_superseded" });
  });
  it("refuses a stale claim when the schedule edit commits first", async () => {
    const { pg, shop, trip, witness, edit } = await setup();
    const gate = await holdRowLock(pg, sql`select id from trips where id = ${trip.id} for update`);
    const writer = edit();
    await waitForLockWaiters(pg.db, 1);
    const claim = issueOfflineManifestSnapshotAtSchedule(
      pg.connect(),
      shop.id,
      trip.id,
      witness,
      witness.schedule,
    );
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect((await writer).ok).toBe(true);
    expect(await claim).toEqual({ ok: false, reason: "snapshot_superseded" });
    const counters = await pg.db
      .select({ revision: offlineManifestSnapshotRevisions.revision })
      .from(offlineManifestSnapshotRevisions)
      .where(eq(offlineManifestSnapshotRevisions.tripId, trip.id));
    expect(counters).toEqual([{ revision: 1 }]);
  });
  it("finishes a claim before an edit queued behind its trip lock", async () => {
    const { pg, shop, trip, witness, edit } = await setup();
    const gate = await holdRowLock(
      pg,
      sql`select trip_id from offline_manifest_snapshot_revisions where trip_id = ${trip.id} for update`,
    );
    const claim = issueOfflineManifestSnapshotAtSchedule(
      pg.connect(),
      shop.id,
      trip.id,
      witness,
      witness.schedule,
    );
    await waitForLockWaiters(pg.db, 1);
    const writer = edit();
    try {
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }
    expect(await claim).toMatchObject({ ok: true, snapshotRevision: 2 });
    expect((await writer).ok).toBe(true);
  });

  it("accepts matching values after an edit and revert without claiming historical identity", async () => {
    const { pg, shop, trip, witness, edit, days } = await setup();
    expect((await edit()).ok).toBe(true);
    expect(
      (
        await editTrip(pg.connect(), shop.id, trip.id, {
          title: trip.title,
          startsAt: days[0].startsAt,
          endsAt: days[1].endsAt,
          capacity: trip.capacity,
          plannedDives: trip.plannedDives,
          scheduleDays: days,
        })
      ).ok,
    ).toBe(true);
    expect(
      await issueOfflineManifestSnapshotAtSchedule(
        pg.connect(),
        shop.id,
        trip.id,
        witness,
        witness.schedule,
      ),
    ).toMatchObject({ ok: true, snapshotRevision: 2 });
  });
});
