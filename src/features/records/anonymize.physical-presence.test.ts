import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { recordRollCall } from "@/db/manifests";
import { getBookingReadiness } from "@/db/readiness";
import { bookings, rollCallEvents, trips } from "@/db/schema";
import { seatHeld } from "@/db/trips-queries";
import { nowDate } from "@/lib/clock";
import { manifestContext } from "@/test/substrate-fixtures/db/manifests-test-fixtures";
import { anonymizeDiver } from "./anonymize";

it("erases physical-observation blocker details while preserving causal context and retry intent", async () => {
  const { db, shop, reef, staff: owner } = await manifestContext();
  // Only the demo reef trip: reading readiness for every scheduled seat was the slow part.
  const candidates = await db
    .select({ id: bookings.id, tripId: bookings.tripId, personId: bookings.personId })
    .from(bookings)
    .innerJoin(trips, eq(trips.id, bookings.tripId))
    .where(
      and(
        eq(bookings.shopId, shop.id),
        eq(bookings.tripId, reef.id),
        seatHeld,
        eq(trips.status, "scheduled"),
      ),
    )
    .orderBy(bookings.id);
  let target: (typeof candidates)[number] | undefined;
  for (const booking of candidates) {
    const readiness = await getBookingReadiness(db, shop.id, booking.id);
    if (readiness?.status === "blocked") {
      target = booking;
      break;
    }
  }
  if (!target) throw new Error("expected a blocked seeded booking");
  const occurredAt = nowDate();
  const clientEventId = crypto.randomUUID();
  const input = {
    shopId: shop.id,
    tripId: target.tripId,
    bookingId: target.id,
    recordedByPersonId: owner.id,
    status: "boarded" as const,
    checkpoint: "departure" as const,
    physicalPresenceOnly: true,
    observedEvidenceIds: [],
    meetingDay: 0,
    clientEventId,
    occurredAt,
  };
  const recorded = await recordRollCall(db, input);
  expect(recorded.ok).toBe(true);
  if (!recorded.ok) throw new Error("expected physical observation");
  const [before] = await db
    .select()
    .from(rollCallEvents)
    .where(eq(rollCallEvents.id, recorded.eventId));
  expect(before.readinessBlockers?.length).toBeGreaterThan(0);
  expect(
    (
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: target.personId,
        actorPersonId: owner.id,
      })
    ).ok,
  ).toBe(true);
  const [after] = await db
    .select()
    .from(rollCallEvents)
    .where(eq(rollCallEvents.id, recorded.eventId));
  expect(after).toMatchObject({
    statementStatus: "boarded",
    clientEventId,
    observedEvidenceIds: [],
    meetingDay: 0,
    readinessStatus: "blocked",
    readinessBlockers: null,
    captureContext: {
      occurredAt: occurredAt.toISOString(),
      meetingDay: 0,
      physicalPresenceOnly: true,
    },
  });
  expect(after.captureContext).not.toHaveProperty("readinessBlockerCodes");
  expect(await recordRollCall(db, input)).toMatchObject({
    ok: true,
    duplicate: true,
    eventId: recorded.eventId,
  });
  expect(await recordRollCall(db, { ...input, physicalPresenceOnly: false })).toEqual({
    ok: false,
    reason: "client_event_conflict",
  });
});
