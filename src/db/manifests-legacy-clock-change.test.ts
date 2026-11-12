import { expect, it } from "vitest";
import {
  issueOfflineManifestSnapshot,
  readOfflineManifestRoster,
} from "@/features/offline-manifest-snapshots";
import { nowDate } from "@/lib/clock";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";

for (const role of ["diver", "crew"] as const) {
  for (const status of ["not_boarded", "boarded"] as const) {
    it(`retains a signed older ${role} queue's ${status} when its clock changed after saving`, async () => {
      const { db, shop, reef, booking, staff } = await manifestContext();
      const savedAt = nowDate();
      const read = await readOfflineManifestRoster(db, shop.id, reef.id);
      if (!read) throw new Error("fixture roster missing");
      const issued = await issueOfflineManifestSnapshot(db, shop.id, reef.id, read);
      if (!issued.ok) throw new Error("fixture snapshot refused");
      const crewId = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew[0]?.id;
      if (!crewId) throw new Error("fixture crew missing");
      const common = {
        shopId: shop.id,
        tripId: reef.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1" as const,
      };
      const write = (input: Parameters<typeof recordRollCall>[1]) =>
        role === "diver"
          ? recordRollCall(db, input)
          : recordCrewRollCall(db, { ...input, personId: crewId });
      expect(
        await write({
          ...common,
          bookingId: booking.booking.id,
          status: "boarded",
          clientEventId: crypto.randomUUID(),
          observedEvidenceIds: [],
          meetingDay: 0,
        }),
      ).toMatchObject({ ok: true });
      // This real retained wire shape predates observed IDs/day capture. Its
      // valid snapshot cannot make the subsequent device clock trustworthy.
      const legacy = {
        ...common,
        bookingId: booking.booking.id,
        status,
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        offlineSnapshotSavedAt: savedAt,
        offlineSnapshotId: issued.snapshotId,
        offlineErasureEpochToken: issued.erasureEpochToken,
        occurredAt: new Date(savedAt.getTime() - 30 * 60_000),
      };
      expect(await write(legacy)).toMatchObject({ ok: true });
      expect(await write(legacy)).toMatchObject({ ok: true, duplicate: true });
      const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
      const subject =
        role === "diver"
          ? manifest?.divers.find((row) => row.bookingId === booking.booking.id)
          : manifest?.crew.find((row) => row.id === crewId);
      expect(subject?.rollCall?.state).toBe(status);
      expect(subject?.rollCallContext?.conflict).toBe(status === "not_boarded");
      expect(subject?.rollCallContext?.observedEvidenceIds).toHaveLength(2);
      if (status === "not_boarded") expect(subject?.rollCallContext?.orderingUnknown).toBe(true);
    });
  }
}
