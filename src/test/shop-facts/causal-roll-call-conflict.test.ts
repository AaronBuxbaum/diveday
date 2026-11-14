import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { rollCallEvents } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import { OFFLINE_MANIFEST_RECORD_VERSION, serializeManifests } from "@/lib/offline-manifests";
import { offlineCausalContext } from "@/lib/roll-call-offline-causality";
import { fileScopedShopContext } from "../db";
import { seedCausalRollCallConflict } from "./causal-roll-call-conflict";
import { resolveFacts } from "./index";

const ctx = fileScopedShopContext();
for (const role of ["diver", "crew"] as const) {
  it.each([0, 1, 2, 3])(
    `authors independent ${role} evidence with stable display order (seed %i)`,
    async () => {
      const resolution = resolveFacts([{ name: "causalRollCallConflict", role }]);
      expect(resolution.ok && resolution.facts[0]?.privateOnly).toBe(true);
      const { db, shop } = ctx;
      const fact = await seedCausalRollCallConflict(db, shop, { role }, nowDate());
      const manifest = await getTripManifest(db, shop.id, fact.tripId, "after_dive_1");
      const subject =
        role === "diver"
          ? manifest?.divers.find((row) => row.bookingId === fact.bookingId)
          : manifest?.crew.find((row) => row.id === fact.personId);
      expect(subject?.rollCallContext).toMatchObject({
        conflict: true,
        orderingUnknown: false,
        meetingDay: 0,
      });
      expect(subject?.rollCallContext?.observedEvidenceIds.toSorted()).toEqual(
        fact.evidenceIds.toSorted(),
      );
      expect(new Set(fact.evidenceIds).size).toBe(2);
      expect(fact.evidenceIds.toReversed()).toEqual(fact.evidenceIds.toSorted());
      const liveEvidence = subject?.rollCallContext?.evidence;
      expect(liveEvidence).toMatchObject([
        { id: fact.evidenceIds[1], status: "not_boarded", note: "Named missing evidence" },
        { id: fact.evidenceIds[0], status: "boarded", note: null },
      ]);
      expect(liveEvidence?.every((item) => item.recordedByName.length > 0)).toBe(true);
      if (!manifest) throw new Error("fixture missing manifest");
      const payload = serializeManifests(
        [manifest],
        {
          slug: shop.slug,
          name: shop.name,
          timezone: shop.timezone,
          emergencyReference: EMPTY_EMERGENCY_REFERENCE,
        },
        () => "",
      );
      const copy = {
        version: OFFLINE_MANIFEST_RECORD_VERSION,
        ...payload,
        snapshotId: crypto.randomUUID(),
        savedAt: nowDate().toISOString(),
        expiresAt: new Date(nowDate().getTime() + 86_400_000).toISOString(),
      };
      const offline = offlineCausalContext(
        copy,
        [],
        role === "diver" ? { bookingId: fact.bookingId } : { crewPersonId: fact.personId },
        "after_dive_1",
      );
      expect(offline.conflict).toBe(true);
      expect(offline.evidence).toMatchObject(liveEvidence ?? []);
      expect(manifest?.completeness.complete).toBe(false);
      const raw = await db
        .select()
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.shopId, shop.id),
            eq(rollCallEvents.tripId, fact.tripId),
            eq(rollCallEvents.checkpoint, "after_dive_1"),
          ),
        );
      expect(raw).toHaveLength(2);
      expect(raw.map((row) => row.observedEvidenceIds)).toEqual([[], []]);
      expect(raw.every((row) => row.captureContext?.meetingDay === 0)).toBe(true);
    },
  );
}
