import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { recordRollCall } from "@/db/manifests";
import { capturableObservation, type RollCallClaimInput } from "@/db/roll-call-claims";
import { accountSessions, rollCallEventClaims, userAccounts } from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { anonymizeDiver } from "@/features/anonymize/store";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// Exercise the prototype only in isolated scratch databases; production stays disabled.
vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: () => true }));
const { verifyRetainedObservationForReceipt } = await import("./receipt-verification");

async function fixture() {
  const pg = await postgresTestDb();
  await seedDemo(pg.db, "history");
  const shop = await getShopBySlug(pg.db, "blue-mantis");
  if (!shop) throw new Error("shop missing");
  const trip = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((row) =>
    row.title.startsWith("Two-Tank Reef — Molasses"),
  );
  if (!trip) throw new Error("trip missing");
  const [seat] = await getTripRoster(pg.db, shop.id, trip.id);
  if (!seat) throw new Error("seat missing");
  const staffId = await seededStaffPersonId(pg.db, shop.id, SEEDED_OWNER_EMAIL);
  const [account] = await pg.db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, staffId));
  if (!account) throw new Error("account missing");
  const [session] = await pg.db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId: staffId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      roles: ["owner"],
      name: "Staff",
      token: crypto.randomUUID(),
      expiresAt: new Date(nowDate().getTime() + 60_000),
    })
    .returning({ id: accountSessions.id });
  const input: RollCallClaimInput = {
    shopId: shop.id,
    tripId: trip.id,
    clientEventId: crypto.randomUUID(),
    recordedByPersonId: staffId,
    subject: { kind: "seat", bookingId: seat.booking.id },
    source: "offline",
    checkpoint: "after_dive_1",
    status: "not_boarded",
    occurredAt: nowDate(),
    offlineSnapshotId: crypto.randomUUID(),
    offlineSnapshotSavedAt: nowDate(),
    meetingDay: 0,
    observedEvidenceIds: [],
  };
  const result = await recordRollCall(pg.db, {
    ...input,
    bookingId: seat.booking.id,
    status: "not_boarded",
    checkpoint: "after_dive_1",
    source: "offline",
    observedEvidenceIds: [],
  });
  expect(result).toMatchObject({ ok: false, reason: "meeting_identity_unverified" });
  await pg.db
    .update(rollCallEventClaims)
    .set({
      unresolvedObservation: capturableObservation(input),
      unresolvedRecordedByPersonId: staffId,
    })
    .where(
      and(
        eq(rollCallEventClaims.shopId, shop.id),
        eq(rollCallEventClaims.clientEventId, input.clientEventId),
      ),
    );
  expect(await verifyRetainedObservationForReceipt(pg.db, input, session.id)).toEqual({ ok: true });
  return { pg, shop, seat, staffId, sessionId: session.id, input };
}

describePostgres("unresolved receipt precondition races", () => {
  it("refuses when session revocation commits while verification is waiting", async () => {
    const { pg, sessionId, input } = await fixture();
    let release!: () => void;
    let deleted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      deleted = resolve;
    });
    let verification: ReturnType<typeof verifyRetainedObservationForReceipt> | undefined;
    const revoke = pg.connect().transaction(async (tx) => {
      await tx.delete(accountSessions).where(eq(accountSessions.id, sessionId));
      deleted();
      await gate;
    });
    void revoke.catch(() => undefined);
    onTestFinished(async () => {
      release();
      await Promise.allSettled([revoke, ...(verification ? [verification] : [])]);
    });
    await Promise.race([started, revoke]);
    verification = verifyRetainedObservationForReceipt(pg.connect(), input, sessionId);
    void verification.catch(() => undefined);
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
    }
    await revoke;
    expect(await verification).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("refuses when erasure commits while verification waits behind its fence", async () => {
    const { pg, shop, seat, staffId, sessionId, input } = await fixture();
    const gate = await holdRowLock(
      pg,
      sql`select id from people where id = ${seat.person.id} for update`,
    );
    const erasure = anonymizeDiver(pg.connect(), {
      shopId: shop.id,
      personId: seat.person.id,
      actorPersonId: staffId,
    });
    let verification: ReturnType<typeof verifyRetainedObservationForReceipt> | undefined;
    void erasure.catch(() => undefined);
    onTestFinished(async () => {
      await gate.release();
      await Promise.allSettled([erasure, ...(verification ? [verification] : [])]);
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      const exclusive = await pg.db.execute(
        sql`select pg_try_advisory_xact_lock_shared(hashtext('boarding_certification_evidence'), hashtext(${shop.id})) as acquired`,
      );
      expect(exclusive.rows[0]).toMatchObject({ acquired: false });
      verification = verifyRetainedObservationForReceipt(pg.connect(), input, sessionId);
      void verification.catch(() => undefined);
      await waitForLockWaiters(pg.db, 2);
      const waiting = await pg.db.execute(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock_shared%'`,
      );
      expect(Number((waiting.rows[0] as { count: number }).count)).toBeGreaterThan(0);
    } finally {
      await gate.release();
    }
    expect(await erasure).toMatchObject({ ok: true });
    const [claim] = await pg.db
      .select({ state: rollCallEventClaims.state })
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, shop.id),
          eq(rollCallEventClaims.clientEventId, input.clientEventId),
        ),
      );
    expect(claim?.state).toBe("erased");
    if (!verification) throw new Error("verification did not start");
    expect(await verification).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
