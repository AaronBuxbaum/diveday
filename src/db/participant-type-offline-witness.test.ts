import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBooking, setBookingParticipantType } from "./bookings";
import { getTripManifest, recordRollCall } from "./manifests";
import { tripRequirements, trips } from "./schema";
import { seedRollCallEvidence } from "./seed-roll-call-evidence";
import { listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

const ctx = fileScopedShopContext();

it("still checks a live boarded snorkeler when a newer offline dock exemption is invalidated", async () => {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Benwood"),
  );
  const [staff] = await listStaff(db, shop.id);
  if (!trip || !staff) throw new Error("fixture missing");
  await db.update(trips).set({ capacity: 8, diverCapacity: null }).where(eq(trips.id, trip.id));
  await db
    .update(tripRequirements)
    .set({
      requiresWaiver: false,
      requiresPayment: false,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: [],
      requiresNitrox: false,
    })
    .where(and(eq(tripRequirements.tripId, trip.id), eq(tripRequirements.shopId, shop.id)));
  const seat = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    participantType: "snorkeler",
    fullName: "Synthetic guest",
    email: "synthetic-offline@example.com",
  });
  if (!seat.ok) throw new Error("snorkeler not seated");
  const bookingId = seat.bookingId;
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    }),
  ).toMatchObject({ ok: true });
  await seedRollCallEvidence(
    db,
    {
      shopId: shop.id,
      tripId: trip.id,
      bookingId,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
      checkpoint: "departure",
      source: "offline",
      offlineMeetingGeneration: 0,
      offlineAssignmentGeneration: 0,
      occurredAt: new Date(nowDate().getTime() + 1000),
    },
    { observesPrevious: true },
  );
  await db.update(trips).set({ offlineMeetingGeneration: 1 }).where(eq(trips.id, trip.id));
  vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1");
  try {
    expect(
      (await getTripManifest(db, shop.id, trip.id, "departure"))?.divers.find(
        (diver) => diver.bookingId === bookingId,
      )?.rollCall?.state,
    ).toBe("boarded");
    expect(
      await setBookingParticipantType(db, {
        shopId: shop.id,
        tripId: trip.id,
        actorPersonId: staff.person.id,
        bookingId,
        to: "diver",
      }),
    ).toEqual({ ok: false, reason: "boarded_not_ready" });
  } finally {
    vi.unstubAllEnvs();
  }
});
