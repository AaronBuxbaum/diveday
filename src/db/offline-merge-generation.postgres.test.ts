import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { getDiverMergePreview, mergeDiverRecords } from "./diver-merge";
import { getTripManifest, recordRollCall } from "./manifests";
import { bookings, people, personRoles, rollCallEvents } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { listStaff, moveTrip } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline evidence across diver merge", () => {
  for (const order of ["merge first", "intake first"] as const) {
    it(`keeps the old mark out of the survivor's manifest when ${order}`, async () => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "lean");
      const shop = await getShopBySlug(pg.db, "blue-mantis");
      if (!shop) throw new Error("shop missing");
      const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
        row.title.startsWith("Two-Tank Reef — Molasses"),
      );
      const owner = (await listStaff(pg.db, shop.id)).find((staff) =>
        staff.roles.includes("owner"),
      );
      if (!trip || !owner) throw new Error("fixture missing");
      expect(
        await moveTrip(pg.db, shop.id, trip.id, new Date(nowDate().getTime() + 7 * 86400000)),
      ).toMatchObject({ ok: true });
      const [source, survivor] = await pg.db
        .insert(people)
        .values([
          { shopId: shop.id, fullName: "Maya Rivera" },
          { shopId: shop.id, fullName: "Maya Rivera" },
        ])
        .returning();
      if (!source || !survivor) throw new Error("people missing");
      await pg.db.insert(personRoles).values([
        { personId: source.id, role: "diver" },
        { personId: survivor.id, role: "diver" },
      ]);
      const [booking] = await pg.db
        .insert(bookings)
        .values({
          shopId: shop.id,
          tripId: trip.id,
          personId: source.id,
          bookedAs: "diver",
          status: "booked",
        })
        .returning();
      if (!booking) throw new Error("booking missing");
      const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
        .payloads[0];
      const witness = saved?.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
      if (!saved?.snapshotId || !witness) throw new Error("witness missing");
      const id = crypto.randomUUID();
      const input = {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1" as const,
        status: "not_boarded" as const,
        source: "offline" as const,
        clientEventId: id,
        observedEvidenceIds: [],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      };
      if (order === "intake first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({ ok: true });
      const preview = await getDiverMergePreview(pg.db, shop.id, source.id, survivor.id);
      expect(preview?.refusal).toBeNull();
      expect(
        await mergeDiverRecords({
          db: pg.db,
          shopId: shop.id,
          personId: source.id,
          survivorId: survivor.id,
          actorPersonId: owner.person.id,
          acknowledged: preview?.acknowledgement || undefined,
        }),
      ).toMatchObject({ ok: true });
      if (order === "merge first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({
          ok: false,
          reason: "review_required",
        });
      const [seat] = await pg.db.select().from(bookings).where(eq(bookings.id, booking.id));
      expect(seat?.personId).toBe(survivor.id);
      expect(seat?.offlineAssignmentGeneration).toBe(1);
      const manifest = await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1");
      expect(
        manifest?.divers.find((diver) => diver.bookingId === booking.id)?.rollCall?.state,
      ).not.toBe("not_boarded");
      expect(
        await pg.db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id)),
      ).toHaveLength(order === "intake first" ? 1 : 0);
    });
  }
});
