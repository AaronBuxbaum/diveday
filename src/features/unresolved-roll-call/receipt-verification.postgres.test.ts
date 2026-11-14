import { and, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { loadShopExportBundleInput } from "@/db/export";
import { table } from "@/db/export-bundle-table.test-support";
import { recordRollCall } from "@/db/manifests";
import { capturableObservation, type RollCallClaimInput } from "@/db/roll-call-claims";
import {
  accountSessions,
  rollCallEventClaims,
  shops,
  unresolvedSafetyAlertOutbox,
  unresolvedSafetyScanIncidents,
  userAccounts,
} from "@/db/schema";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { anonymizeDiver } from "@/features/anonymize/store";
import { nowDate } from "@/lib/clock";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

// Exercise the prototype only in isolated scratch databases; production stays disabled.
vi.mock("./review-availability", () => ({ unresolvedReviewAvailable: () => true }));
const { persistVerifiedHandoffReceipt, verifyRetainedObservationForReceipt } = await import(
  "./receipt-verification"
);

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
  it("retains committed safety facts when receipt persistence wins the fence", async () => {
    const { pg, shop, seat, staffId, sessionId, input } = await fixture();
    const [before] = await pg.db
      .select()
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, shop.id),
          eq(rollCallEventClaims.clientEventId, input.clientEventId),
        ),
      );
    const gate = await holdRowLock(
      pg,
      sql`select id from roll_call_event_claims where id = ${before.id} for update`,
    );
    const receipt = persistVerifiedHandoffReceipt(pg.connect(), input, sessionId);
    void receipt.catch(() => undefined);
    let erasure: ReturnType<typeof anonymizeDiver> | undefined;
    onTestFinished(async () => {
      await gate.release();
      await Promise.allSettled([receipt, ...(erasure ? [erasure] : [])]);
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      const exclusive = await pg.db.execute(
        sql`select pg_try_advisory_xact_lock(hashtext('boarding_certification_evidence'), hashtext(${shop.id})) as acquired`,
      );
      expect(exclusive.rows[0]).toMatchObject({ acquired: false });
      erasure = anonymizeDiver(pg.connect(), {
        shopId: shop.id,
        personId: seat.person.id,
        actorPersonId: staffId,
      });
      void erasure.catch(() => undefined);
      await waitForLockWaiters(pg.db, 2);
      const waiting = await pg.db.execute(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock(%boarding_certification_evidence%'`,
      );
      expect(Number((waiting.rows[0] as { count: number }).count)).toBeGreaterThan(0);
    } finally {
      await gate.release();
    }
    const result = await receipt;
    if (!result.ok || !("receipt" in result) || !result.receipt)
      throw new Error("fixture receipt missing");
    if (!erasure) throw new Error("erasure did not start");
    expect(await erasure).toMatchObject({ ok: true });
    const [after] = await pg.db
      .select()
      .from(rollCallEventClaims)
      .where(eq(rollCallEventClaims.id, before.id));
    expect(after).toMatchObject({
      state: "erased",
      bookingId: null,
      unresolvedObservation: null,
      retainedSafetyEvidence: {
        receiptId: result.receipt.id,
        status: "not_boarded",
        noteRetained: false,
      },
    });
    const outbox = await pg.db
      .select()
      .from(unresolvedSafetyAlertOutbox)
      .where(
        and(
          eq(unresolvedSafetyAlertOutbox.shopId, shop.id),
          eq(unresolvedSafetyAlertOutbox.claimId, before.id),
        ),
      );
    expect(outbox).toHaveLength(1);
    expect(outbox[0].generationId).toBe(result.receipt.id);
  });

  it("does not persist a receipt when subject erasure wins the fence", async () => {
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
    let receipt: ReturnType<typeof persistVerifiedHandoffReceipt> | undefined;
    void erasure.catch(() => undefined);
    onTestFinished(async () => {
      await gate.release();
      await Promise.allSettled([erasure, ...(receipt ? [receipt] : [])]);
    });
    try {
      await waitForLockWaiters(pg.db, 1);
      const exclusive = await pg.db.execute(
        sql`select pg_try_advisory_xact_lock_shared(hashtext('boarding_certification_evidence'), hashtext(${shop.id})) as acquired`,
      );
      expect(exclusive.rows[0]).toMatchObject({ acquired: false });
      receipt = persistVerifiedHandoffReceipt(pg.connect(), input, sessionId);
      void receipt.catch(() => undefined);
      await waitForLockWaiters(pg.db, 2);
      const waiting = await pg.db.execute(
        sql`select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%pg_advisory_xact_lock_shared%'`,
      );
      expect(Number((waiting.rows[0] as { count: number }).count)).toBeGreaterThan(0);
    } finally {
      await gate.release();
    }
    expect(await erasure).toMatchObject({ ok: true });
    if (!receipt) throw new Error("receipt attempt did not start");
    expect(await receipt).toMatchObject({ ok: false, reason: "unavailable" });
    const [claim] = await pg.db
      .select()
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, shop.id),
          eq(rollCallEventClaims.clientEventId, input.clientEventId),
        ),
      );
    expect(claim).toMatchObject({
      state: "erased",
      handoffReceiptId: null,
      retainedSafetyEvidence: null,
    });
    expect(
      await pg.db
        .select()
        .from(unresolvedSafetyAlertOutbox)
        .where(
          and(
            eq(unresolvedSafetyAlertOutbox.shopId, shop.id),
            eq(unresolvedSafetyAlertOutbox.claimId, claim.id),
          ),
        ),
    ).toEqual([]);
  });

  it("retains safety facts and the alert obligation when the subject is erased", async () => {
    const { pg, shop, seat, staffId, sessionId, input } = await fixture();
    const receipt = await persistVerifiedHandoffReceipt(pg.db, input, sessionId);
    expect(receipt).toMatchObject({ ok: true, receipt: { id: expect.any(String) } });
    const [before] = await pg.db
      .select()
      .from(rollCallEventClaims)
      .where(
        and(
          eq(rollCallEventClaims.shopId, shop.id),
          eq(rollCallEventClaims.clientEventId, input.clientEventId),
        ),
      );
    if (!receipt.ok || !("receipt" in receipt) || !receipt.receipt)
      throw new Error("fixture receipt missing");
    expect(before?.retainedSafetyEvidence).toEqual({
      version: 1,
      receiptId: receipt.receipt.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: input.occurredAt?.toISOString(),
      meetingDay: 0,
      observedEvidenceIds: [],
      retractsEventId: null,
      retractsClientEventId: null,
      reconcilesEvidence: false,
      noteRetained: false,
    });
    const obligations = () =>
      pg.db
        .select()
        .from(unresolvedSafetyAlertOutbox)
        .where(
          and(
            eq(unresolvedSafetyAlertOutbox.shopId, shop.id),
            eq(unresolvedSafetyAlertOutbox.claimId, before.id),
          ),
        );
    const beforeObligations = await obligations();
    expect(beforeObligations).toHaveLength(1);

    expect(
      await anonymizeDiver(pg.db, {
        shopId: shop.id,
        personId: seat.person.id,
        actorPersonId: staffId,
      }),
    ).toMatchObject({ ok: true });
    const [after] = await pg.db
      .select()
      .from(rollCallEventClaims)
      .where(eq(rollCallEventClaims.id, before.id));
    expect(after).toMatchObject({
      state: "erased",
      bookingId: null,
      crewPersonId: null,
      unresolvedObservation: null,
      unresolvedRecordedByPersonId: null,
      intentFingerprint: null,
      intentWithoutNoteFingerprint: null,
      proofFingerprint: null,
      keyFingerprint: null,
      handoffReceiptId: null,
      handoffReceiptAt: null,
      retainedSafetyEvidence: before.retainedSafetyEvidence,
    });
    expect(await obligations()).toEqual(beforeObligations);
    expect(await persistVerifiedHandoffReceipt(pg.db, input, sessionId)).toMatchObject({
      ok: false,
      reason: "unavailable",
    });
    const bundle = await loadShopExportBundleInput(pg.db, shop.id);
    if (!bundle) throw new Error("shop export missing");
    const claims = table(bundle, "roll_call_event_claims.csv");
    const claimRow = claims.rows.find((row) => row[claims.header.indexOf("id")] === before.id);
    if (!claimRow) throw new Error("erased claim missing from export");
    for (const field of [
      "subject_kind",
      "booking_id",
      "crew_person_id",
      "intent_fingerprint",
      "intent_without_note_fingerprint",
      "proof_fingerprint",
      "key_fingerprint",
      "unresolved_reason",
      "note_disposition",
      "accepted_event_id",
      "unresolved_observation",
      "unresolved_recorded_by_person_id",
      "handoff_receipt_id",
      "handoff_receipt_at",
    ]) {
      expect(claimRow[claims.header.indexOf(field)]).toBeNull();
    }
    expect(claimRow[claims.header.indexOf("state")]).toBe("erased");
    expect(claimRow[claims.header.indexOf("client_event_id")]).toBe(input.clientEventId);
    expect(JSON.parse(String(claimRow[claims.header.indexOf("retained_safety_evidence")]))).toEqual(
      before.retainedSafetyEvidence,
    );
    const outbox = table(bundle, "unresolved_safety_alert_outbox.csv");
    expect(
      outbox.rows.some((row) => row[outbox.header.indexOf("id")] === beforeObligations[0].id),
    ).toBe(true);

    const [other] = await pg.db
      .insert(shops)
      .values({
        name: "Unrelated shop",
        slug: "receipt-export-other",
        timezone: "UTC",
      })
      .returning();
    const otherBundle = await loadShopExportBundleInput(pg.db, other.id);
    if (!otherBundle) throw new Error("other shop export missing");
    const otherClaims = table(otherBundle, "roll_call_event_claims.csv");
    expect(
      otherClaims.rows.some((row) => row[otherClaims.header.indexOf("id")] === before.id),
    ).toBe(false);
    const otherOutbox = table(otherBundle, "unresolved_safety_alert_outbox.csv");
    expect(
      otherOutbox.rows.some(
        (row) => row[otherOutbox.header.indexOf("id")] === beforeObligations[0].id,
      ),
    ).toBe(false);
    for (const foreign of [
      { tripId: input.tripId },
      { claimId: before.id },
      { outboxId: beforeObligations[0].id },
    ]) {
      const [incident] = await pg.db
        .insert(unresolvedSafetyScanIncidents)
        .values({
          shopId: other.id,
          tripId: crypto.randomUUID(),
          claimId: crypto.randomUUID(),
          outboxId: crypto.randomUUID(),
          generationId: crypto.randomUUID(),
          scanSequence: 999,
          ...foreign,
        })
        .returning();
      await expect(loadShopExportBundleInput(pg.db, other.id)).rejects.toThrow(
        "Safety export has inconsistent tenant references",
      );
      await pg.db
        .delete(unresolvedSafetyScanIncidents)
        .where(eq(unresolvedSafetyScanIncidents.id, incident.id));
    }
    const [missing] = await pg.db
      .insert(unresolvedSafetyScanIncidents)
      .values({
        shopId: other.id,
        tripId: crypto.randomUUID(),
        claimId: crypto.randomUUID(),
        outboxId: crypto.randomUUID(),
        generationId: crypto.randomUUID(),
        scanSequence: 1000,
      })
      .returning();
    const missingBundle = await loadShopExportBundleInput(pg.db, other.id);
    if (!missingBundle) throw new Error("missing-incident export missing");
    const incidents = table(missingBundle, "unresolved_safety_scan_incidents.csv");
    const missingRow = incidents.rows.find(
      (row) => row[incidents.header.indexOf("id")] === missing.id,
    );
    if (!missingRow) throw new Error("missing incident omitted");
    expect(missingRow[incidents.header.indexOf("outbox_id")]).toBe(missing.outboxId);
    expect(missingRow[incidents.header.indexOf("generation_id")]).toBe(missing.generationId);
    expect(missingRow[incidents.header.indexOf("scan_sequence")]).toBe(missing.scanSequence);
    expect(missingRow[incidents.header.indexOf("trip_id")]).toBe(missing.tripId);
    expect(missingRow[incidents.header.indexOf("claim_id")]).toBe(missing.claimId);
  });

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
