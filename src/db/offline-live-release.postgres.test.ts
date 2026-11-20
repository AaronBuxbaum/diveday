import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { markBookingNoShow } from "@/features/no-show/store";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { recordRollCall } from "./manifests";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, moveTrip } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline evidence after a live no-show", () => {
  it("holds an older offline mark rather than undoing the live release", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!trip || !owner) throw new Error("fixture missing");
    const startsAt = new Date(nowDate().getTime() + 7 * 86400000);
    expect(await moveTrip(pg.db, shop.id, trip.id, startsAt)).toMatchObject({ ok: true });
    const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
    if (!subject) throw new Error("seat missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:departure`];
    if (!saved?.snapshotId || !witness) throw new Error("witness missing");
    expect(
      await markBookingNoShow(pg.db, {
        shopId: shop.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        now: startsAt,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await recordRollCall(pg.db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure",
        status: "not_boarded",
        source: "offline",
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: [],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      }),
    ).toMatchObject({ ok: false, reason: "review_required" });
  });
});
