import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { manifestContext } from "../test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall } from "./manifests";
import { rollCallProjectionForDb } from "./roll-call-causal-store";
import { rollCallEvents } from "./schema";

it("does not count a generation-bound offline crew mark as a verified seat observation", async () => {
  const { db, shop, reef, staff } = await manifestContext();
  const manifest = await getTripManifest(db, shop.id, reef.id, "after_dive_1");
  const crewId = manifest?.crew[0]?.id;
  if (!crewId) throw new Error("fixture missing crew");
  const eventId = crypto.randomUUID();
  expect(
    await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      personId: crewId,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      clientEventId: eventId,
    }),
  ).toMatchObject({ ok: true });
  const [live] = await db
    .select()
    .from(rollCallEvents)
    .where(eq(rollCallEvents.clientEventId, eventId));
  if (!live) throw new Error("crew evidence missing");
  // Simulate an ambiguous stored row. A seat witness cannot authenticate a
  // crew subject, and excluding it must leave the live observation standing.
  const ambiguous = {
    ...live,
    id: crypto.randomUUID(),
    source: "offline" as const,
    offlineMeetingGeneration: 0,
    offlineAssignmentGeneration: 0,
    offlineCrewAssignmentId: null,
  };
  const projection = await rollCallProjectionForDb(db, [
    { event: live, day: 0 },
    { event: ambiguous, day: 0 },
  ]);
  expect(projection.rows).toEqual([]);
  expect(projection.recount.size).toBe(1);
});
