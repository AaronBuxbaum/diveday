import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  buildOfflineManifestCopies,
  readOfflineManifestRosterWithWindows,
} from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { getTripManifest, recordCrewRollCall } from "./manifests";
import { boats } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { changeTripCrew, editTripSection, getTripCrewIds, listStaff, setTripCrew } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline crew count after a boat replacement", () => {
  for (const order of ["boat first", "intake first", "crew reassigned"] as const)
    it(`does not count a saved old-boat crew mark when ${order}`, async () => {
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
      const saved = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
        .payloads[0];
      const before = await getTripManifest(pg.db, shop.id, trip.id, "departure");
      const crew = before?.crew[0];
      if (!crew || !saved?.snapshotId) throw new Error("crew or snapshot missing");
      const witness = saved.rollCallWitnesses?.[`crew:${crew.id}:departure`];
      if (!witness) throw new Error("crew witness missing");
      const sameCrew = await getTripCrewIds(pg.db, shop.id, trip.id);
      expect(await setTripCrew(pg.db, shop.id, trip.id, sameCrew)).toBe(true);
      const [replacement] = await pg.db
        .insert(boats)
        .values({ shopId: shop.id, name: "Replacement boat", capacity: 200 })
        .returning();
      if (!replacement) throw new Error("boat missing");
      const input = {
        shopId: shop.id,
        tripId: trip.id,
        personId: crew.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "departure" as const,
        status: "boarded" as const,
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        offlineSnapshotSavedAt: nowDate(),
        observedEvidenceIds: [],
        rollCallWitness: witness,
      };
      if (order === "intake first") {
        expect(await recordCrewRollCall(pg.db, input)).toMatchObject({ ok: true });
        expect(await recordCrewRollCall(pg.db, input)).toMatchObject({ ok: true, duplicate: true });
        const correction = {
          ...input,
          clientEventId: crypto.randomUUID(),
          status: "not_boarded" as const,
          observedEvidenceIds: [clientRollCallEvidenceId(input.clientEventId)],
        };
        expect(await recordCrewRollCall(pg.db, correction)).toMatchObject({ ok: true });
        expect(
          (await getTripManifest(pg.db, shop.id, trip.id, "departure"))?.crew.find(
            (item) => item.id === crew.id,
          )?.rollCall?.state,
        ).toBe("not_boarded");
      }
      if (order === "crew reassigned") {
        expect(
          await changeTripCrew(pg.db, shop.id, trip.id, {
            personId: crew.id,
            operation: "unassign",
          }),
        ).toBe(true);
        expect(
          await changeTripCrew(pg.db, shop.id, trip.id, { personId: crew.id, operation: "assign" }),
        ).toBe(true);
      } else {
        expect(
          await editTripSection(pg.db, shop.id, trip.id, { boatId: replacement.id }),
        ).toMatchObject({ ok: true });
      }
      const result = await recordCrewRollCall(pg.db, input);
      const after = await getTripManifest(pg.db, shop.id, trip.id, "departure");
      expect({
        result,
        crew: after?.crew.find((item) => item.id === crew.id)?.rollCall?.state,
      }).toMatchObject({ result: { ok: false, reason: "review_required" }, crew: undefined });
      if (order === "intake first") {
        expect(after?.crew.find((item) => item.id === crew.id)?.recountRequired).toBe(true);
        const fresh = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
          .payloads[0];
        const freshWitness = fresh?.rollCallWitnesses?.[`crew:${crew.id}:departure`];
        if (!fresh?.snapshotId || !freshWitness) throw new Error("fresh crew witness missing");
        expect(
          await recordCrewRollCall(pg.db, {
            ...input,
            clientEventId: crypto.randomUUID(),
            offlineSnapshotId: fresh.snapshotId,
            offlineErasureEpochToken: fresh.erasureEpochToken,
            meetingDay: fresh.rollCallMeetingDay ?? 0,
            rollCallWitness: freshWitness,
          }),
        ).toMatchObject({ ok: false, reason: "review_required" });
        const page = await readOfflineManifestRosterWithWindows(pg.db, shop.id, trip.id);
        const proof = page?.manifests
          .find((item) => item.checkpoint === "departure")
          ?.crew.find((item) => item.id === crew.id)?.rollCallContext?.liveRecountProof;
        if (!proof) throw new Error("crew recount proof missing");
        expect(await editTripSection(pg.db, shop.id, trip.id, { boatId: null })).toMatchObject({
          ok: true,
        });
        expect(
          await recordCrewRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            personId: crew.id,
            recordedByPersonId: owner.person.id,
            checkpoint: "departure",
            status: "not_boarded",
            source: "live",
            liveRecountProof: proof,
          }),
        ).toMatchObject({ ok: false, reason: "review_required" });
        const updatedPage = await readOfflineManifestRosterWithWindows(pg.db, shop.id, trip.id);
        const currentProof = updatedPage?.manifests
          .find((item) => item.checkpoint === "departure")
          ?.crew.find((item) => item.id === crew.id)?.rollCallContext?.liveRecountProof;
        if (!currentProof) throw new Error("current crew recount proof missing");
        expect(
          await recordCrewRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            personId: crew.id,
            recordedByPersonId: owner.person.id,
            checkpoint: "departure",
            status: "not_boarded",
            source: "live",
            liveRecountProof: currentProof,
          }),
        ).toMatchObject({ ok: true });
        expect(
          (await getTripManifest(pg.db, shop.id, trip.id, "departure"))?.crew.find(
            (item) => item.id === crew.id,
          ),
        ).toMatchObject({ recountRequired: false, rollCall: { state: "not_boarded" } });
      }
    });
});
