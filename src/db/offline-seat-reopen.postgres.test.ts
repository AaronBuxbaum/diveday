import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOfflineManifestCopies } from "@/features/boarding/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { cancelBooking, restoreBooking } from "./bookings";
import { getTripManifest, recordRollCall } from "./manifests";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, moveTrip } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline evidence across a reopened seat", () => {
  for (const order of ["cancel first", "intake first"] as const) {
    it(`does not count an old mark after the seat is restored when ${order}`, async () => {
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
      const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
      if (!subject) throw new Error("seat missing");
      const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
        .payloads[0];
      const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:departure`];
      if (!saved?.snapshotId || !witness) throw new Error("witness missing");
      const input = {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure" as const,
        status: "not_boarded" as const,
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: [],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      };
      if (order === "intake first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({ ok: true });
      expect(await cancelBooking(pg.db, shop.id, subject.booking.id)).toMatchObject({ ok: true });
      expect(await restoreBooking(pg.db, shop.id, subject.booking.id)).toBe("restored");
      if (order === "cancel first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({
          ok: false,
          reason: "review_required",
        });
      const manifest = await getTripManifest(pg.db, shop.id, trip.id, "departure");
      expect(
        manifest?.divers.find((diver) => diver.bookingId === subject.booking.id)?.rollCall?.state,
      ).not.toBe("not_boarded");
    });
  }
});
