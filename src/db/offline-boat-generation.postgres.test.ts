import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { getTripManifest, recordRollCall } from "./manifests";
import { boats, trips } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { editTripSection, getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline evidence across a boat change", () => {
  for (const order of ["boat first", "intake first"] as const) {
    it(`holds an observation captured for the old boat when ${order}`, async () => {
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
      const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
      if (!subject) throw new Error("seat missing");
      expect(
        await recordRollCall(pg.db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: subject.booking.id,
          recordedByPersonId: owner.person.id,
          checkpoint: "departure",
          status: "not_boarded",
          source: "live",
        }),
      ).toMatchObject({ ok: true });
      const [original] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
      if (!original) throw new Error("trip missing");
      expect(
        await editTripSection(pg.db, shop.id, trip.id, { boatId: original.boatId }),
      ).toMatchObject({ ok: true });
      const [same] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
      expect(same?.offlineMeetingGeneration).toBe(original.offlineMeetingGeneration);
      const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
        .payloads[0];
      const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:departure`];
      if (!saved?.snapshotId || !witness) throw new Error("witness missing");
      const observed =
        saved.manifests
          .find((manifest) => manifest.checkpoint === "departure")
          ?.divers.find((diver) => diver.bookingId === subject.booking.id)?.rollCallContext
          ?.observedEvidenceIds ?? [];
      const [replacement] = await pg.db
        .insert(boats)
        .values({ shopId: shop.id, name: "Replacement boat", capacity: 200 })
        .returning();
      if (!replacement) throw new Error("replacement missing");
      const input = {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure" as const,
        status: "boarded" as const,
        physicalPresenceOnly: true,
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: observed,
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      };
      if (order === "intake first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({ ok: true });
      expect(
        await editTripSection(pg.db, shop.id, trip.id, { boatId: replacement.id }),
      ).toMatchObject({ ok: true });
      expect(
        await editTripSection(pg.db, shop.id, trip.id, { boatId: original.boatId }),
      ).toMatchObject({ ok: true });
      const [restored] = await pg.db.select().from(trips).where(eq(trips.id, trip.id));
      expect(restored?.offlineMeetingGeneration).toBe(original.offlineMeetingGeneration + 2);
      if (order === "boat first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({
          ok: false,
          reason: "review_required",
        });
      const manifest = await getTripManifest(pg.db, shop.id, trip.id, "departure");
      expect(
        manifest?.divers.find((diver) => diver.bookingId === subject.booking.id)?.rollCall?.state,
      ).toBe("not_boarded");
    });
  }
});
