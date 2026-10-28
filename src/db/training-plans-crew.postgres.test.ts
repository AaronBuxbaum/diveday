import { expect, it } from "vitest";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { lockBoardingCertificationEvidence } from "./boarding-certification-snapshot";
import { recordCrewRollCall } from "./manifests";
import { tripAssignments } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { listStaff, upcomingTripsWithCounts } from "./trips";
import { changeTripCrewOutcome } from "./trips-crew";

describePostgres("crew changes serialize with training plan writes", () => {
  it("waits for a planning transaction before changing the crew", async () => {
    const pg = await postgresTestDb();
    const shopId = "11111111-1111-4111-8111-111111111111";
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const planning = pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shopId, "boarding");
      acquired();
      await hold;
    });
    let change: ReturnType<typeof changeTripCrewOutcome> | undefined;
    try {
      await Promise.race([locked, planning]);
      change = changeTripCrewOutcome(pg.connect(), shopId, "22222222-2222-4222-8222-222222222222", {
        operation: "unassign",
        personId: "33333333-3333-4333-8333-333333333333",
      });
      try {
        await waitForLockWaiters(pg.db, 1);
      } finally {
        release();
      }
      expect((await change).ok).toBe(false);
    } finally {
      release();
      await Promise.allSettled(change ? [planning, change] : [planning]);
    }
  });
  it("serializes an accepted absence with planning writes", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const [staff] = await listStaff(pg.db, shop.id);
    const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
      row.title.startsWith("Two-Tank Reef"),
    );
    if (!staff || !trip) throw new Error("staff or trip missing");
    await pg.db
      .insert(tripAssignments)
      .values({ tripId: trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    let acquired!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const planning = pg.connect().transaction(async (tx) => {
      await lockBoardingCertificationEvidence(tx, shop.id, "boarding");
      acquired();
      await hold;
    });
    let mark: ReturnType<typeof recordCrewRollCall> | undefined;
    try {
      await Promise.race([locked, planning]);
      mark = recordCrewRollCall(pg.connect(), {
        shopId: shop.id,
        tripId: trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        status: "not_boarded",
      });
      try {
        await waitForLockWaiters(pg.db, 1);
      } finally {
        release();
      }
      expect((await mark).ok).toBe(true);
    } finally {
      release();
      await Promise.allSettled(mark ? [planning, mark] : [planning]);
    }
  });
});
