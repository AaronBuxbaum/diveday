import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { recordCrewRollCall, recordRollCall } from "./manifests";
import { offlineReviewRefusals, rollCallEvents, tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { editTripSection, getTripRoster, listStaff } from "./trips";
import { upcomingTripsWithCounts } from "./trips-queries.test-support";

vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());

describePostgres("offline review refusal receipt", () => {
  for (const first of [
    "refusal",
    "write",
    "ordinary_seat",
    "ordinary_crew",
    "ordinary_seat_first",
    "ordinary_crew_first",
  ] as const) {
    it(`serializes a ${first}-first confirmation against a competing request with the same ID`, async () => {
      const pg = await postgresTestDb();
      await seedDemo(pg.db, "lean");
      const shop = await getShopBySlug(pg.db, "blue-mantis");
      if (!shop) throw new Error("shop missing");
      const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
        row.title.startsWith("Two-Tank Reef — Molasses"),
      );
      if (!trip) throw new Error("trip missing");
      const [subject] = await getTripRoster(pg.db, shop.id, trip.id);
      const owner = (await listStaff(pg.db, shop.id)).find((staff) =>
        staff.roles.includes("owner"),
      );
      if (!subject || !owner) throw new Error("fixture missing");
      if (first === "ordinary_crew_first")
        await pg.db
          .insert(tripAssignments)
          .values({ tripId: trip.id, personId: owner.person.id })
          .onConflictDoNothing();
      const old = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
        .payloads[0];
      const oldWitness = old?.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
      if (!old?.snapshotId || !oldWitness) throw new Error("old proof missing");
      expect(
        (
          await editTripSection(pg.db, shop.id, trip.id, {
            endsAt: new Date(trip.endsAt.getTime() + 3600000),
          })
        ).ok,
      ).toBe(true);
      const current = (await buildOfflineManifestCopies(pg.db, shop, owner.person.id, [trip.id]))
        .payloads[0];
      const currentWitness =
        current?.rollCallWitnesses?.[`seat:${subject.booking.id}:after_dive_1`];
      if (!current?.snapshotId || !currentWitness) throw new Error("current proof missing");
      const confirmationId = crypto.randomUUID();
      const common = {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: subject.booking.id,
        recordedByPersonId: owner.person.id,
        checkpoint: "after_dive_1" as const,
        status: "boarded" as const,
        source: "live" as const,
        clientEventId: confirmationId,
        observedEvidenceIds: [],
        reconcilesEvidence: true,
        reviewOriginalWitness: oldWitness,
        reviewOriginalSnapshotId: old.snapshotId,
        reviewOriginalMeetingDay: old.rollCallMeetingDay ?? 0,
      };
      const stale = {
        ...common,
        reviewWitness: oldWitness,
        offlineSnapshotId: old.snapshotId,
        meetingDay: old.rollCallMeetingDay ?? 0,
      };
      const fresh = {
        ...common,
        reviewWitness: currentWitness,
        offlineSnapshotId: current.snapshotId,
        meetingDay: current.rollCallMeetingDay ?? 0,
      };
      let entered!: () => void;
      let release!: () => void;
      const holding = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = pg.connect().transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('offline_review_confirmation'), hashtext(${`${shop.id}:${confirmationId}`}))`,
        );
        entered();
        await gate;
      });
      await holding;
      const ordinarySeat = () =>
        recordRollCall(pg.connect(), {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: subject.booking.id,
          recordedByPersonId: owner.person.id,
          checkpoint: "after_dive_1",
          status: "boarded",
          source: "live",
          clientEventId: confirmationId,
        });
      const ordinaryCrew = () =>
        recordCrewRollCall(pg.connect(), {
          shopId: shop.id,
          tripId: trip.id,
          personId: owner.person.id,
          recordedByPersonId: owner.person.id,
          checkpoint: "after_dive_1",
          status: "boarded",
          source: "live",
          clientEventId: confirmationId,
        });
      const one =
        first === "ordinary_seat_first"
          ? ordinarySeat()
          : first === "ordinary_crew_first"
            ? ordinaryCrew()
            : recordRollCall(pg.connect(), first === "write" ? fresh : stale);
      await waitForLockWaiters(pg.db, 1);
      const two =
        first === "ordinary_seat"
          ? ordinarySeat()
          : first === "ordinary_crew"
            ? ordinaryCrew()
            : recordRollCall(pg.connect(), first === "refusal" ? fresh : stale);
      try {
        await waitForLockWaiters(pg.db, 2);
      } finally {
        release();
        await blocker;
      }
      const [a, b] = await Promise.all([one, two]);
      const marks = await pg.db
        .select()
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, confirmationId));
      const refusals = await pg.db
        .select()
        .from(offlineReviewRefusals)
        .where(eq(offlineReviewRefusals.clientEventId, confirmationId));
      if (first === "ordinary_seat_first" || first === "ordinary_crew_first") {
        expect(a).toMatchObject({ ok: true });
        expect(b).toMatchObject({ ok: false, reason: "client_event_conflict" });
        expect(marks).toHaveLength(1);
        expect(refusals).toHaveLength(0);
      } else if (first !== "write") {
        expect(a).toMatchObject({ ok: false, notApplied: true });
        expect(b).toMatchObject(
          first === "refusal"
            ? { ok: false, notApplied: true }
            : { ok: false, reason: "client_event_conflict" },
        );
        expect(marks).toHaveLength(0);
        expect(refusals).toHaveLength(1);
      } else {
        expect(a).toMatchObject({ ok: true });
        expect(b).toMatchObject({ ok: true, duplicate: true });
        expect(marks).toHaveLength(1);
        expect(refusals).toHaveLength(0);
      }
    });
  }
});
