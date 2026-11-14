import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { meetingGeneration, meetingIncarnation } from "@/test/meeting-generation";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { rollCallEventClaims, rollCallEvents, tripScheduleDays } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

describePostgres("accepted and unresolved roll-call identities under contention", () => {
  for (const role of ["diver", "crew"] as const) {
    it(`serializes conflicting ${role} intents under one client ID`, async () => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "history");
      const shop = await getShopBySlug(pg.db, "blue-mantis");
      if (!shop) throw new Error("shop missing");
      const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
        row.title.startsWith("Two-Tank Reef — Molasses"),
      );
      if (!trip) throw new Error("trip missing");
      const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
      const crew = (await getTripManifest(pg.db, shop.id, trip.id, "after_dive_1"))?.crew[0];
      const [staff] = await listStaff(pg.db, shop.id);
      if (!seat || !crew?.id || !staff) throw new Error("fixture roster missing");
      const [day] = await pg.db
        .select()
        .from(tripScheduleDays)
        .where(eq(tripScheduleDays.tripId, trip.id));
      const meeting = day ?? trip;
      const snapshotId = crypto.randomUUID();
      const proof = signOfflineMeetingIdentity({
        scheduleGeneration: await meetingGeneration(pg.db, trip.id),
        datasetIncarnation: await meetingIncarnation(pg.db, trip.id),
        shopId: shop.id,
        tripId: trip.id,
        snapshotId,
        meetingDay: 0,
        meetingId: meeting.id,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
      });
      const common = {
        shopId: shop.id,
        tripId: trip.id,
        recordedByPersonId: staff.person.id,
        checkpoint: "after_dive_1" as const,
        source: "offline" as const,
        clientEventId: crypto.randomUUID(),
        meetingDay: 0,
        offlineSnapshotId: snapshotId,
        offlineSnapshotSavedAt: nowDate(),
        occurredAt: nowDate(),
        observedEvidenceIds: [],
      };
      const call = (valid: boolean) =>
        role === "diver"
          ? recordRollCall(pg.connect(), {
              ...common,
              bookingId: seat.booking.id,
              status: valid ? "boarded" : "not_boarded",
              offlineMeetingIdentityProof: valid ? proof : undefined,
            })
          : recordCrewRollCall(pg.connect(), {
              ...common,
              personId: crew.id,
              status: valid ? "boarded" : "not_boarded",
              offlineMeetingIdentityProof: valid ? proof : undefined,
            });
      const gate = await holdRowLock(
        pg,
        sql`select pg_advisory_xact_lock(hashtext('roll_call_event_claim'), hashtext(${shop.id}))`,
      );
      const unresolved = call(false);
      const accepted = call(true);
      try {
        await waitForLockWaiters(pg.db, 2);
      } finally {
        await gate.release();
      }
      const results = await Promise.all([unresolved, accepted]);
      expect(
        results.filter((row) => !row.ok && row.reason === "client_event_conflict"),
      ).toHaveLength(1);
      expect(
        results.filter(
          (row) => row.ok || (!row.ok && row.reason === "meeting_identity_unverified"),
        ),
      ).toHaveLength(1);
      const claims = await pg.db
        .select()
        .from(rollCallEventClaims)
        .where(eq(rollCallEventClaims.clientEventId, common.clientEventId));
      expect(claims).toHaveLength(1);
      const events = await pg.db
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, common.clientEventId));
      expect(events).toHaveLength(claims[0].state === "accepted" ? 1 : 0);
    });
  }
});
