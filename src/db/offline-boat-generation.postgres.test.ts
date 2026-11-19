import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { departureCounts } from "@/features/departure-counts";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { listRollCallGaps } from "@/features/roll-call-gaps";
import { nowDate } from "@/lib/clock";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { getTripManifest, onTheWaterByRollCall, recordRollCall } from "./manifests";
import { boats, trips } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { editTripSection, getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline evidence across a boat change", () => {
  for (const [order, checkpoint] of [
    ["boat first", "departure"],
    ["intake first", "departure"],
    ["intake first", "after_dive_1"],
  ] as const) {
    it(`holds an observation captured for the old boat at ${checkpoint} when ${order}`, async () => {
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
      const [subject, other] = await getTripRoster(pg.db, shop.id, trip.id);
      if (!subject || !other) throw new Error("seats missing");
      expect(
        await recordRollCall(pg.db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: subject.booking.id,
          recordedByPersonId: owner.person.id,
          checkpoint,
          status: "not_boarded",
          source: "live",
        }),
      ).toMatchObject({ ok: true });
      expect(
        await recordRollCall(pg.db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: other.booking.id,
          recordedByPersonId: owner.person.id,
          checkpoint,
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
      const witness = saved?.rollCallWitnesses?.[`seat:${subject.booking.id}:${checkpoint}`];
      if (!saved?.snapshotId || !witness) throw new Error("witness missing");
      const observed =
        saved.manifests
          .find((manifest) => manifest.checkpoint === checkpoint)
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
        checkpoint,
        status: "boarded" as const,
        ...(checkpoint === "departure" ? { physicalPresenceOnly: true } : {}),
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        observedEvidenceIds: observed,
        meetingDay: saved.rollCallMeetingDay ?? 0,
        offlineSnapshotId: saved.snapshotId,
        offlineErasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: witness,
        offlineSnapshotSavedAt: nowDate(),
      };
      if (order === "intake first") {
        expect(await recordRollCall(pg.db, input)).toMatchObject({ ok: true });
        expect(await recordRollCall(pg.db, input)).toMatchObject({ ok: true, duplicate: true });
        const current = await getTripManifest(pg.db, shop.id, trip.id, checkpoint);
        const seen = current?.divers.find((diver) => diver.bookingId === subject.booking.id)
          ?.rollCallContext?.observedEvidenceIds;
        expect(
          await recordRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: subject.booking.id,
            recordedByPersonId: owner.person.id,
            checkpoint,
            status: "not_boarded",
            source: "live",
            observedEvidenceIds: seen,
          }),
        ).toMatchObject({ ok: true });
      }
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
      if (order === "intake first")
        expect(await recordRollCall(pg.db, input)).toMatchObject({
          ok: false,
          reason: "review_required",
        });
      const manifest = await getTripManifest(pg.db, shop.id, trip.id, checkpoint);
      const person = manifest?.divers.find((diver) => diver.bookingId === subject.booking.id);
      expect(person?.rollCall?.state).toBe(order === "intake first" ? undefined : "not_boarded");
      if (order === "intake first") {
        expect(person).toMatchObject({ recountRequired: true });
        expect(manifest?.summary.recountRequired).toBe(1);
        expect(await onTheWaterByRollCall(pg.db, shop.id, trip.id, subject.booking.id)).toBe(
          "uncertain",
        );
        const counts = await departureCounts(pg.db, shop.id, [trip.id], { readiness: new Map() });
        expect(counts.get(trip.id)).toMatchObject({
          recountRequired: 1,
          ...(checkpoint === "after_dive_1" ? { back: 0 } : {}),
        });
        if (checkpoint === "after_dive_1") {
          const gaps = await listRollCallGaps(
            pg.db,
            shop.id,
            new Date(trip.endsAt.getTime() + 60_000),
            [trip.id],
            { historical: true },
          );
          expect(gaps.find((gap) => gap.reason === "missing_diver")).toMatchObject({ awaiting: 1 });
        }
        const fresh = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
          .payloads[0];
        const freshWitness = fresh?.rollCallWitnesses?.[`seat:${subject.booking.id}:${checkpoint}`];
        if (!fresh?.snapshotId || !freshWitness) throw new Error("fresh witness missing");
        expect(
          await recordRollCall(pg.db, {
            ...input,
            clientEventId: crypto.randomUUID(),
            observedEvidenceIds: [],
            offlineSnapshotId: fresh.snapshotId,
            offlineErasureEpochToken: fresh.erasureEpochToken,
            meetingDay: fresh.rollCallMeetingDay ?? 0,
            rollCallWitness: freshWitness,
          }),
        ).toMatchObject({ ok: false, reason: "review_required" });
        expect(
          await recordRollCall(pg.db, {
            ...input,
            bookingId: subject.booking.id.toUpperCase(),
            clientEventId: crypto.randomUUID(),
            observedEvidenceIds: [],
            offlineSnapshotId: fresh.snapshotId,
            offlineErasureEpochToken: fresh.erasureEpochToken,
            meetingDay: fresh.rollCallMeetingDay ?? 0,
            rollCallWitness: freshWitness,
          }),
        ).toMatchObject({ ok: false, reason: "review_required" });
      }
      expect(
        manifest?.divers.find((diver) => diver.bookingId === other.booking.id)?.rollCall?.state,
      ).toBe("not_boarded");
      if (order === "intake first") {
        expect(
          await recordRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: subject.booking.id,
            recordedByPersonId: owner.person.id,
            checkpoint,
            status: "not_boarded",
            source: "live",
          }),
        ).toMatchObject({ ok: true });
        const recounted = await getTripManifest(pg.db, shop.id, trip.id, checkpoint);
        expect(
          recounted?.divers.find((diver) => diver.bookingId === subject.booking.id),
        ).toMatchObject({ rollCall: { state: "not_boarded" }, recountRequired: false });
        expect(recounted?.summary.recountRequired).toBe(0);
        expect(await onTheWaterByRollCall(pg.db, shop.id, trip.id, subject.booking.id)).toBe(
          checkpoint === "departure" ? null : "missing_after_dive",
        );
        const freshEvent = recounted?.divers.find((diver) => diver.bookingId === subject.booking.id)
          ?.rollCall?.eventId;
        if (!freshEvent) throw new Error("fresh recount event missing");
        expect(
          await recordRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: subject.booking.id,
            recordedByPersonId: owner.person.id,
            checkpoint,
            status: "cleared",
            source: "live",
            retractsEventId: freshEvent,
          }),
        ).toMatchObject({ ok: true });
        const retracted = await getTripManifest(pg.db, shop.id, trip.id, checkpoint);
        expect(
          retracted?.divers.find((diver) => diver.bookingId === subject.booking.id),
        ).toMatchObject({ recountRequired: true, rollCall: undefined });
        expect(
          await recordRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: subject.booking.id,
            recordedByPersonId: owner.person.id,
            checkpoint,
            status: "not_boarded",
            source: "live",
          }),
        ).toMatchObject({ ok: true });
        expect(
          await editTripSection(pg.db, shop.id, trip.id, { boatId: replacement.id }),
        ).toMatchObject({ ok: true });
        const changedAgain = await getTripManifest(pg.db, shop.id, trip.id, checkpoint);
        expect(
          changedAgain?.divers.find((diver) => diver.bookingId === subject.booking.id),
        ).toMatchObject({ recountRequired: true, rollCall: undefined });
        const stalePage = changedAgain?.divers.find(
          (diver) => diver.bookingId === subject.booking.id,
        )?.rollCallContext;
        expect(
          await editTripSection(pg.db, shop.id, trip.id, { boatId: original.boatId }),
        ).toMatchObject({ ok: true });
        expect(
          await recordRollCall(pg.db, {
            shopId: shop.id,
            tripId: trip.id,
            bookingId: subject.booking.id,
            recordedByPersonId: owner.person.id,
            checkpoint,
            status: "not_boarded",
            source: "live",
            observedEvidenceIds: stalePage?.observedEvidenceIds ?? [],
          }),
        ).toMatchObject({ ok: false, reason: "review_required" });
        const counts = await departureCounts(pg.db, shop.id, [trip.id], { readiness: new Map() });
        expect(counts.get(trip.id)).toMatchObject({ recountRequired: 1 });
      }
    });
  }
});
