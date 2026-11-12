import type { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import type { AppDb } from "@/db/client";
import { offlineManifestSnapshotRevisions, tripAssignments, trips as tripRows } from "@/db/schema";
import {
  DEMO_MEDICAL_ALERT,
  DEMO_MEDICAL_ALERT_DIVER,
  DEMO_MEDICAL_ALERT_TRIP,
} from "@/db/seed-medical-alert";
import { listStaff, upcomingTripsWithCounts } from "@/db/trips";
import { nowDate } from "@/lib/clock";
import { queryTimingLogger, withQueryStats } from "@/lib/observability/query-timing";
import { fileScopedShopContext, seededShopContext } from "@/test/db";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import { readManifestPage } from "./manifest-reads";

const ctx = fileScopedShopContext();

describe("readManifestPage (in-memory PGlite)", () => {
  it("reads one departure's manifests and the departure's own rows, in one call", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");

    const reads = await readManifestPage(db, shop.id, reef.id, staff.person.id);

    // One manifest per checkpoint: the dock, then one after each planned dive.
    expect(reads.completeManifests?.map((entry) => entry.checkpoint)).toEqual([
      "departure",
      ...Array.from({ length: reef.plannedDives }, (_, index) => `after_dive_${index + 1}`),
    ]);
    expect(reads.completeManifests?.[0]?.divers.length).toBeGreaterThan(0);
    expect(reads.plannedDives.length).toBe(reef.plannedDives);
    // Never worked this departure: there is nothing for a catch-up to be "since".
    expect(reads.catchUp.mark).toBeNull();
    // The field guides are keyed by the live sites the first wave returned.
    for (const siteId of reads.fieldGuides.keys()) {
      expect(reads.liveDiveSites.map((site) => site.id)).toContain(siteId);
    }
  });

  it("costs a fixed number of statements, not one per diver, and reads the manifest once", async () => {
    // Its own database: the file-scoped one is a transaction handle with no
    // driver of its own to put the counting logger on.
    const { db, shop } = await seededShopContext();
    const counted = drizzle({
      client: db.$client as PGlite,
      logger: queryTimingLogger,
    }) as unknown as AppDb;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");

    const { stats } = await withQueryStats(() =>
      readManifestPage(counted, shop.id, reef.id, staff.person.id),
    );

    // 72 today: 76 before the render stopped issuing the offline snapshot
    // (its lock_timeout, isolation check, advisory lock, trip key-share and
    // revision write went; a plain read of the trip's revision came, issue
    // #4391), 115 in production before the page stopped reading the manifest
    // twice and the roll call stopped reading once per checkpoint (issue #3857).
    // A tripwire: a change that adds a statement should say so here.
    expect(stats.queries).toBeLessThanOrEqual(72);
  });

  it("renders without a write, a lock or a snapshot revision (issue #4391)", async () => {
    // Its own database, for a logger that keeps every statement it sends.
    const { db, shop } = await seededShopContext();
    const sent: string[] = [];
    const recorded = drizzle({
      client: db.$client as PGlite,
      logger: { logQuery: (query: string) => sent.push(query) },
    }) as unknown as AppDb;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const reef = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
    if (!reef) throw new Error("demo reef trip missing");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");

    const reads = await readManifestPage(recorded, shop.id, reef.id, staff.person.id);
    await readManifestPage(recorded, shop.id, reef.id, staff.person.id);

    // Every roll-call tap re-renders this page: a render must be a read.
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((query) => /^\s*(insert|update|delete)\b/i.test(query))).toEqual([]);
    expect(sent.filter((query) => /pg_advisory|for (key )?share|for update/i.test(query))).toEqual(
      [],
    );
    const counters = await db
      .select()
      .from(offlineManifestSnapshotRevisions)
      .where(eq(offlineManifestSnapshotRevisions.tripId, reef.id));
    expect(counters).toEqual([]);
    // It carries the epoch and revision its rows were read at, for the device's save.
    expect(reads.offlineRoster?.erasureEpoch).toBe(shop.offlineErasureEpoch);
    expect(reads.offlineRoster?.snapshotRevision).toBe(0);
  });

  it("reads nothing for a departure that is not this shop's", async () => {
    const { db, shop } = ctx;
    const [staff] = await listStaff(db, shop.id);
    const reads = await readManifestPage(
      db,
      shop.id,
      "00000000-0000-4000-8000-000000000000",
      staff?.person.id ?? "",
    );
    expect(reads.completeManifests?.[0]).toBeUndefined();
  });

  it("carries no diver's medical alert words, even for the owner (H-20261023-medical-alert-for-the: only a recorded tap or an explicit offline save)", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const departure = trips.find((trip) => trip.title === DEMO_MEDICAL_ALERT_TRIP);
    if (!departure) throw new Error("seeded alert departure missing");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);

    const reads = await readManifestPage(db, shop.id, departure.id, owner);

    // The fact rides, so the chip shows and the reveal is offered.
    expect(reads.reader.mayReadMedicalAlerts).toBe(true);
    const flagged = reads.completeManifests?.[0]?.divers.filter((diver) => diver.medicalAlert);
    expect(flagged?.map((diver) => diver.fullName)).toEqual([DEMO_MEDICAL_ALERT_DIVER]);
    // The words do not: not in anything the page renders, serializes or
    // builds its offline payload from.
    const everything = JSON.stringify(reads, (_key, value) =>
      value instanceof Map || value instanceof Set ? [...value] : value,
    );
    expect(everything).not.toContain(DEMO_MEDICAL_ALERT);
    expect(everything).not.toContain("EpiPen");
  });

  it("offers the emergency read off the crew from the day before until the trip's days end (domain review 2, S1)", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const departure = trips.find((trip) => trip.title === DEMO_MEDICAL_ALERT_TRIP);
    if (!departure) throw new Error("seeded alert departure missing");
    const captain = await seededStaffPersonId(db, shop.id, SEEDED_CAPTAIN_EMAIL);
    await db
      .delete(tripAssignments)
      .where(and(eq(tripAssignments.tripId, departure.id), eq(tripAssignments.personId, captain)));
    const DAY_MS = 24 * 60 * 60 * 1000;
    const leaving = async (offset: number) => {
      const startsAt = new Date(nowDate().getTime() + offset);
      await db
        .update(tripRows)
        .set({ startsAt, endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000) })
        .where(eq(tripRows.id, departure.id));
      return (await readManifestPage(db, shop.id, departure.id, captain)).reader;
    };
    // A tab opened the night before keeps the offer; the server decides on the confirm.
    expect(await leaving(DAY_MS)).toMatchObject({
      mayReadMedicalAlerts: false,
      mayEmergencyReadMedicalAlerts: true,
    });
    expect((await leaving(0)).mayEmergencyReadMedicalAlerts).toBe(true);
    // Over: the owner or a manager reads it any time.
    expect((await leaving(-DAY_MS)).mayEmergencyReadMedicalAlerts).toBe(false);
    // Never to someone the crew rule already admits.
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    await leaving(0);
    expect((await readManifestPage(db, shop.id, departure.id, owner)).reader).toMatchObject({
      mayReadMedicalAlerts: true,
      mayEmergencyReadMedicalAlerts: false,
    });
  });
});
