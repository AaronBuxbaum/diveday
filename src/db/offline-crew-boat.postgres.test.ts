import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { getTripManifest, recordCrewRollCall } from "./manifests";
import { boats } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { editTripSection, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "0"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline crew count after a boat replacement", () => {
  it("does not count a saved old-boat crew mark on the new boat", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db, "lean");
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef — Molasses"),
    );
    const owner = (await listStaff(pg.db, shop.id)).find((staff) => staff.roles.includes("owner"));
    if (!trip || !owner) throw new Error("fixture missing");
    const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
      .payloads[0];
    const before = await getTripManifest(pg.db, shop.id, trip.id, "departure");
    const crew = before?.crew[0];
    if (!crew || !saved?.snapshotId) throw new Error("crew or snapshot missing");
    const [replacement] = await pg.db
      .insert(boats)
      .values({ shopId: shop.id, name: "Replacement boat", capacity: 200 })
      .returning();
    if (!replacement) throw new Error("boat missing");
    expect(
      await editTripSection(pg.db, shop.id, trip.id, { boatId: replacement.id }),
    ).toMatchObject({ ok: true });
    const result = await recordCrewRollCall(pg.db, {
      shopId: shop.id,
      tripId: trip.id,
      personId: crew.id,
      recordedByPersonId: owner.person.id,
      checkpoint: "departure",
      status: "boarded",
      source: "offline",
      clientEventId: crypto.randomUUID(),
      meetingDay: saved.rollCallMeetingDay ?? 0,
      offlineSnapshotId: saved.snapshotId,
      offlineErasureEpochToken: saved.erasureEpochToken,
      offlineSnapshotSavedAt: nowDate(),
      observedEvidenceIds: [],
    });
    const after = await getTripManifest(pg.db, shop.id, trip.id, "departure");
    expect({
      result,
      crew: after?.crew.find((item) => item.id === crew.id)?.rollCall?.state,
    }).toMatchObject({ result: { ok: false, reason: "review_required" }, crew: undefined });
  });
});
