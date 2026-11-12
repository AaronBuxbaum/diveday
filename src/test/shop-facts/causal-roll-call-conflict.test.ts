import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { rollCallEvents } from "@/db/schema";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "../db";
import { seedCausalRollCallConflict } from "./causal-roll-call-conflict";
import { resolveFacts } from "./index";

const ctx = fileScopedShopContext();
for (const role of ["diver", "crew"] as const) {
  it(`authors independent ${role} evidence through supported writers in a private fixture`, async () => {
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
  });
}
