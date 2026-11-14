import { and, count, eq, sql } from "drizzle-orm";
import { expect, it, onTestFinished, vi } from "vitest";
import { cancelDeparture } from "@/db/aboard-at-sea";
import { callTripBlowout } from "@/db/blowouts";
import { loadShopExportBundleInput } from "@/db/export";
import { subscribeManifestEvents } from "@/db/manifest-events";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "@/db/manifests";
import { offlinePredecessorsAccepted } from "@/db/roll-call-causal-store";
import { capturableObservation } from "@/db/roll-call-claims";
import {
  accountSessions,
  rollCallEventClaims,
  rollCallEvents,
  tripScheduleDays,
  unresolvedSafetyAlertOutbox,
  userAccounts,
} from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { anonymizeDiver } from "@/features/anonymize/store";
import {
  issueOfflineManifestSnapshot,
  readOfflineManifestRoster,
} from "@/features/offline-manifest-snapshots";
import { shopClock } from "@/features/shop-clock/rules";
import { getDayCloseout } from "@/features/today/closeout-reader";
import { getTodayWork } from "@/features/today/today-reader";
import { readUnresolvedRollCallObservation } from "@/features/unresolved-roll-call";
import {
  persistVerifiedHandoffReceipt,
  verifyRetainedObservationForReceipt,
} from "@/features/unresolved-roll-call/receipt-verification";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import {
  OFFLINE_UNRESOLVED_HEADER,
  OFFLINE_UNRESOLVED_VERSION,
  ROLL_CALL_CAUSAL_HEADERS,
} from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { meetingProofScope } from "@/test/meeting-generation";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
vi.mock("@/features/unresolved-roll-call/review-availability", () => ({
  unresolvedReviewAvailable: () => true,
}));
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};

import {
  checkAlertObligationRetry,
  checkRetainedReviewIndex,
  checkRetainedTripIsNotRemoved,
  createRetainedReviewLookup,
} from "@/test/retained-safety-helpers";

const { POST } = await import("./route");
function postRequest(body: unknown, supportsUnresolved = false) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: {
      ...ROLL_CALL_CAUSAL_HEADERS,
      ...(supportsUnresolved ? { [OFFLINE_UNRESOLVED_HEADER]: OFFLINE_UNRESOLVED_VERSION } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function seededContext() {
  const { db, shop } = fileCtx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("fixture trip missing");
  const [row] = await getTripRoster(db, shop.id, trip.id);
  if (!row) throw new Error("fixture booking missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, trip, booking: row.booking, diverName: row.person.fullName, staffPersonId };
}
function staffSession(shopId: string, personId: string): DiveDaySession {
  return {
    user: {
      shopId,
      personId,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: "staff@demo.invalid",
      roles: ["owner"],
    },
  };
}

type Event = {
  tripId: string;
  checkpoint: string;
  snapshotId: string;
  snapshotSavedAt: string;
  occurredAt: string;
  clientEventId: string;
  bookingId?: string;
  crewPersonId?: string;
  status: string;
  note?: string | null;
  observedEvidenceIds: string[];
  meetingDay: number;
  meetingIdentityProof?: string;
  retractsClientEventId?: string;
};
async function send(event: Event) {
  const response = await POST(postRequest({ events: [event] }, true));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    results: { clientEventId: string; status: string; reason?: string }[];
  };
  expect(body.results).toHaveLength(1);
  return body.results[0];
}
async function capturedEvent(role: "diver" | "crew") {
  const fixture = await seededContext();
  const { db, shop, trip, booking, staffPersonId } = fixture;
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const crewId = (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.crew[0]?.id;
  if (!crewId) throw new Error("fixture missing assigned crew");
  const event: Event = {
    tripId: trip.id,
    checkpoint: "after_dive_1",
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: nowDate().toISOString(),
    occurredAt: nowDate().toISOString(),
    clientEventId: crypto.randomUUID(),
    ...(role === "diver" ? { bookingId: booking.id } : { crewPersonId: crewId }),
    status: "not_boarded",
    observedEvidenceIds: [],
    meetingDay: 0,
  };
  return { ...fixture, event };
}
async function proveMeeting(event: Event, shopId: string) {
  const [day] = await fileCtx.db
    .select()
    .from(tripScheduleDays)
    .where(
      and(
        eq(tripScheduleDays.tripId, event.tripId),
        eq(tripScheduleDays.dayNumber, event.meetingDay + 1),
      ),
    );
  if (!day) throw new Error("fixture meeting missing");
  return {
    ...event,
    meetingIdentityProof: signOfflineMeetingIdentity({
      ...(await meetingProofScope(fileCtx.db, event.tripId)),
      shopId,
      tripId: event.tripId,
      snapshotId: event.snapshotId,
      meetingDay: event.meetingDay,
      meetingId: day.id,
      startsAt: day.startsAt,
      endsAt: day.endsAt,
    }),
  };
}

it("tombstones an unresolved claim on erasure and does not revive it on retry", async () => {
  const { db, shop, booking, staffPersonId, event } = await capturedEvent("diver");
  const first = await POST(
    postRequest({ events: [{ ...event, note: "a private observation" }] }, true),
  );
  expect(await first.json()).toMatchObject({
    results: [expect.objectContaining({ status: "unresolved" })],
  });
  // Seed a hypothetical future internal copy directly: production capture is
  // disabled until recovery and retention are complete. Erasure must still
  // clear both its contents and its author if such a row exists.
  await db
    .update(rollCallEventClaims)
    .set({
      unresolvedRecordedByPersonId: staffPersonId,
      handoffReceiptId: crypto.randomUUID(),
      handoffReceiptAt: nowDate(),
      unresolvedObservation: {
        checkpoint: event.checkpoint,
        status: event.status,
        occurredAt: event.occurredAt,
        snapshotId: event.snapshotId,
        snapshotSavedAt: event.snapshotSavedAt,
        meetingDay: event.meetingDay,
        meetingProof: null,
        erasureToken: null,
        observedEvidenceIds: event.observedEvidenceIds,
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        note: "a private observation",
      },
    })
    .where(
      and(
        eq(rollCallEventClaims.shopId, shop.id),
        eq(rollCallEventClaims.clientEventId, event.clientEventId),
      ),
    );
  const lookup = await createRetainedReviewLookup(db, shop, staffPersonId, event);
  const reviewed = await readUnresolvedRollCallObservation(db, lookup);
  expect(reviewed).toMatchObject({
    ok: true,
    claim: { observation: { note: "a private observation" }, bookingId: booking.id },
  });
  if (!reviewed.ok) throw new Error("review unavailable");
  expect(reviewed.claim.observation).not.toHaveProperty("meetingProof");
  expect(reviewed.claim.observation).not.toHaveProperty("erasureToken");
  expect(reviewed.claim.observation).not.toHaveProperty("snapshotId");
  expect(
    await readUnresolvedRollCallObservation(db, { ...lookup, tripId: crypto.randomUUID() }),
  ).toMatchObject({ ok: false, reason: "not_found" });
  expect(
    await readUnresolvedRollCallObservation(db, { ...lookup, staffPersonId: booking.personId }),
  ).toMatchObject({ ok: false, reason: "forbidden" });
  expect(
    await readUnresolvedRollCallObservation(db, { ...lookup, shopId: crypto.randomUUID() }),
  ).toMatchObject({ ok: false, reason: "forbidden" });
  await db
    .update(userAccounts)
    .set({ status: "disabled" })
    .where(eq(userAccounts.personId, staffPersonId));
  try {
    expect(await readUnresolvedRollCallObservation(db, lookup)).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
  } finally {
    await db
      .update(userAccounts)
      .set({ status: "active" })
      .where(eq(userAccounts.personId, staffPersonId));
  }
  const before = (await loadShopExportBundleInput(db, shop.id))?.tables.find(
    (table) => table.file === "roll_call_event_claims.csv",
  );
  const beforeRow = before?.rows.find(
    (row) => row[before.header.indexOf("client_event_id")] === event.clientEventId,
  );
  expect(beforeRow?.[before?.header.indexOf("state") ?? -1]).toBe("unresolved");
  expect(beforeRow?.[before?.header.indexOf("unresolved_observation") ?? -1]).toContain(
    "a private observation",
  );
  expect(beforeRow?.[before?.header.indexOf("intent_without_note_fingerprint") ?? -1]).toBeTruthy();
  expect(
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staffPersonId,
    }),
  ).toMatchObject({ ok: true });
  const [claim] = await db
    .select()
    .from(rollCallEventClaims)
    .where(
      and(
        eq(rollCallEventClaims.shopId, shop.id),
        eq(rollCallEventClaims.clientEventId, event.clientEventId),
      ),
    );
  expect(claim).toMatchObject({
    state: "erased",
    subjectKind: null,
    bookingId: null,
    crewPersonId: null,
    intentFingerprint: null,
    intentWithoutNoteFingerprint: null,
    proofFingerprint: null,
    keyFingerprint: null,
    unresolvedReason: null,
    noteDisposition: null,
    acceptedEventId: null,
    unresolvedObservation: null,
    unresolvedRecordedByPersonId: null,
    handoffReceiptId: null,
    handoffReceiptAt: null,
  });
  expect(await readUnresolvedRollCallObservation(db, lookup)).toMatchObject({
    ok: false,
    reason: "not_found",
  });
  const after = (await loadShopExportBundleInput(db, shop.id))?.tables.find(
    (table) => table.file === "roll_call_event_claims.csv",
  );
  const afterRow = after?.rows.find(
    (row) => row[after.header.indexOf("client_event_id")] === event.clientEventId,
  );
  expect(afterRow?.[after?.header.indexOf("state") ?? -1]).toBe("erased");
  expect(afterRow?.[after?.header.indexOf("unresolved_observation") ?? -1]).toBeNull();
  expect(afterRow?.[after?.header.indexOf("unresolved_recorded_by_person_id") ?? -1]).toBeNull();
  expect(afterRow?.[after?.header.indexOf("intent_without_note_fingerprint") ?? -1]).toBeNull();
  const retry = await POST(postRequest({ events: [event] }, true));
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: event.clientEventId,
        status: "unresolved",
      }),
    ],
  });
});

it("does not recreate an erased seat's claim identifiers for a new offline event", async () => {
  const { db, shop, booking, staffPersonId, event } = await capturedEvent("diver");
  expect(
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staffPersonId,
    }),
  ).toMatchObject({ ok: true });
  const response = await POST(postRequest({ events: [event] }, true));
  expect(await response.json()).toMatchObject({
    results: [expect.objectContaining({ status: "unresolved" })],
  });
  const [claim] = await db
    .select()
    .from(rollCallEventClaims)
    .where(
      and(
        eq(rollCallEventClaims.shopId, shop.id),
        eq(rollCallEventClaims.clientEventId, event.clientEventId),
      ),
    );
  expect(claim).toMatchObject({
    state: "erased",
    subjectKind: null,
    bookingId: null,
    crewPersonId: null,
    intentFingerprint: null,
    intentWithoutNoteFingerprint: null,
    proofFingerprint: null,
    keyFingerprint: null,
  });
});

it("does not silently acknowledge an erased subject's accepted event under a different proof", async () => {
  const { db, shop, booking, staffPersonId, event: captured } = await capturedEvent("diver");
  const event = await proveMeeting(captured, shop.id);
  expect(
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staffPersonId,
    }),
  ).toMatchObject({ ok: true });
  const first = await POST(postRequest({ events: [event] }, true));
  expect(await first.json()).toMatchObject({
    results: [expect.objectContaining({ status: "applied" })],
  });
  for (const retryEvent of [
    event,
    { ...event, meetingIdentityProof: undefined },
    { ...event, status: "boarded" },
  ]) {
    const retry = await POST(postRequest({ events: [retryEvent] }, true));
    expect(await retry.json()).toMatchObject({
      results: [
        expect.objectContaining({
          clientEventId: event.clientEventId,
          status: "unresolved",
        }),
      ],
    });
  }
  const rows = await db
    .select({ id: rollCallEvents.id })
    .from(rollCallEvents)
    .where(
      and(
        eq(rollCallEvents.shopId, shop.id),
        eq(rollCallEvents.clientEventId, event.clientEventId),
      ),
    );
  expect(rows).toHaveLength(1);
});

it("keeps a retry pending when its claim verification key is no longer available", async () => {
  const { db, shop, event } = await capturedEvent("diver");
  const first = await POST(postRequest({ events: [event] }, true));
  expect(await first.json()).toMatchObject({
    results: [expect.objectContaining({ status: "unresolved" })],
  });
  // Represent a claim issued under a different retained verification key.
  await db
    .update(rollCallEventClaims)
    .set({ keyFingerprint: "a".repeat(43) })
    .where(
      and(
        eq(rollCallEventClaims.shopId, shop.id),
        eq(rollCallEventClaims.clientEventId, event.clientEventId),
      ),
    );
  const retry = await POST(postRequest({ events: [event] }, true));
  expect(retry.status).toBe(503);
  expect(await retry.json()).toEqual({ error: "sync_unavailable" });
  const [claim] = await db
    .select()
    .from(rollCallEventClaims)
    .where(
      and(
        eq(rollCallEventClaims.shopId, shop.id),
        eq(rollCallEventClaims.clientEventId, event.clientEventId),
      ),
    );
  expect(claim?.state).toBe("unresolved");
});

it("answers an already committed dependent as duplicate despite a later refusal list", async () => {
  const { shop, event: captured } = await capturedEvent("diver");
  const first = await proveMeeting(captured, shop.id);
  expect(await send(first)).toMatchObject({ status: "applied" });
  const dependent = {
    ...first,
    clientEventId: crypto.randomUUID(),
    status: "boarded",
    observedEvidenceIds: [clientRollCallEvidenceId(first.clientEventId)],
  };
  expect(await send(dependent)).toMatchObject({ status: "applied" });
  const retry = await POST(
    postRequest(
      { events: [dependent], refusedEvidenceIds: [clientRollCallEvidenceId(first.clientEventId)] },
      true,
    ),
  );
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: dependent.clientEventId,
        status: "duplicate",
      }),
    ],
  });
});

it("defers a dependent whose accepted predecessor still names an unknown ancestor", async () => {
  const { db, shop, booking, staffPersonId, event: captured } = await capturedEvent("diver");
  const firstId = crypto.randomUUID();
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: captured.tripId,
      bookingId: booking.id,
      recordedByPersonId: staffPersonId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      source: "live",
      clientEventId: firstId,
      meetingDay: 0,
      observedEvidenceIds: [clientRollCallEvidenceId(crypto.randomUUID())],
    }),
  ).toMatchObject({ ok: true });
  const dependent = await proveMeeting(
    { ...captured, status: "boarded", observedEvidenceIds: [clientRollCallEvidenceId(firstId)] },
    shop.id,
  );
  const response = await POST(postRequest({ events: [dependent] }, true));
  expect(await response.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: dependent.clientEventId,
        status: "unresolved",
        reason: "unresolved_predecessor",
      }),
    ],
  });
  const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
  expect(rows.some((row) => row.clientEventId === dependent.clientEventId)).toBe(false);
});

it("fails closed when the scoped predecessor history exceeds its 10,000-row bound", async () => {
  const { db, shop, booking, staffPersonId, event } = await capturedEvent("diver");
  const firstId = crypto.randomUUID();
  const first = await recordRollCall(db, {
    shopId: shop.id,
    tripId: event.tripId,
    bookingId: booking.id,
    recordedByPersonId: staffPersonId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    source: "live",
    clientEventId: firstId,
    meetingDay: 0,
    observedEvidenceIds: [],
  });
  if (!first.ok) throw new Error(`fixture mark refused: ${first.reason}`);
  const where = and(
    eq(rollCallEvents.shopId, shop.id),
    eq(rollCallEvents.tripId, event.tripId),
    eq(rollCallEvents.checkpoint, "after_dive_1"),
    eq(rollCallEvents.subjectKind, "seat"),
    eq(rollCallEvents.bookingId, booking.id),
  );
  const [existing] = await db.select({ value: count() }).from(rollCallEvents).where(where);
  const needed = 10_000 - existing.value;
  if (needed < 0) throw new Error("fixture already exceeds test bound");
  const insert = async (n: number) =>
    db.execute(sql`
    insert into ${rollCallEvents} (shop_id, trip_id, subject_kind, booking_id, recorded_by_person_id,
      effective_status, statement_status, meeting_day, causal_frontier, checkpoint, source, occurred_at)
    select ${shop.id}, ${event.tripId}, 'seat', ${booking.id}, ${staffPersonId},
      'not_boarded', 'not_boarded', 0, '[]'::jsonb, 'after_dive_1', 'live', now()
    from generate_series(1, ${n})`);
  await insert(needed);
  const subject = {
    shopId: shop.id,
    tripId: event.tripId,
    bookingId: booking.id,
    checkpoint: "after_dive_1",
  };
  const input = { meetingDay: 0, observedEvidenceIds: [clientRollCallEvidenceId(firstId)] };
  expect(await offlinePredecessorsAccepted(db, subject, input)).toBe(true);
  await insert(1);
  expect(await offlinePredecessorsAccepted(db, subject, input)).toBe(false);
}, 60_000);

it("accepts a scoped live server predecessor and defers a foreign-subject predecessor", async () => {
  const { db, shop, booking, staffPersonId, event: captured } = await capturedEvent("diver");
  const first = await recordRollCall(db, {
    shopId: shop.id,
    tripId: captured.tripId,
    bookingId: booking.id,
    recordedByPersonId: staffPersonId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    source: "live",
    meetingDay: 0,
    observedEvidenceIds: [],
  });
  if (!first.ok) throw new Error(`fixture mark refused: ${first.reason}`);
  const own = await proveMeeting(
    { ...captured, status: "boarded", observedEvidenceIds: [`server:${first.eventId}`] },
    shop.id,
  );
  expect(await send(own)).toMatchObject({ status: "applied" });

  const crew = (await getTripManifest(db, shop.id, captured.tripId, "after_dive_1"))?.crew[0];
  if (!crew?.id) throw new Error("fixture crew missing");
  const foreign = await recordCrewRollCall(db, {
    shopId: shop.id,
    tripId: captured.tripId,
    personId: crew.id,
    recordedByPersonId: staffPersonId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    source: "live",
    meetingDay: 0,
    observedEvidenceIds: [],
  });
  if (!foreign.ok) throw new Error(`fixture crew mark refused: ${foreign.reason}`);
  const wrong = await proveMeeting(
    {
      ...captured,
      clientEventId: crypto.randomUUID(),
      status: "boarded",
      observedEvidenceIds: [`server:${foreign.eventId}`],
    },
    shop.id,
  );
  const response = await POST(postRequest({ events: [wrong] }, true));
  expect(await response.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: wrong.clientEventId,
        status: "unresolved",
        reason: "unresolved_predecessor",
      }),
    ],
  });
});

for (const role of ["diver", "crew"] as const) {
  it(`keeps a ${role} dependent unresolved across requests without client-supplied refusal state`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const first = await POST(postRequest({ events: [event] }, true));
    expect(first.status).toBe(200);
    const dependent = await proveMeeting(
      {
        ...event,
        clientEventId: crypto.randomUUID(),
        status: "boarded",
        observedEvidenceIds: [clientRollCallEvidenceId(event.clientEventId)],
      },
      shop.id,
    );
    const next = await POST(postRequest({ events: [dependent] }, true));
    expect(await next.json()).toMatchObject({
      results: [
        expect.objectContaining({
          clientEventId: dependent.clientEventId,
          status: "unresolved",
          reason: "unresolved_predecessor",
        }),
      ],
    });
    const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
    expect(rows.some((row) => row.clientEventId === dependent.clientEventId)).toBe(false);
  });
  it(`ignores a ${role} event's self-observation as the causal fold does`, async () => {
    const { shop, event: captured } = await capturedEvent(role);
    const event = await proveMeeting(
      { ...captured, observedEvidenceIds: [clientRollCallEvidenceId(captured.clientEventId)] },
      shop.id,
    );
    expect(await send(event)).toMatchObject({ status: "applied" });
  });
}

it("returns an erasure disposal receipt for a deferred note", async () => {
  const { db, shop, booking, staffPersonId, event } = await capturedEvent("diver");
  const token = signOfflineErasureEpoch({
    shopId: shop.id,
    tripId: event.tripId,
    snapshotId: event.snapshotId,
    epoch: shop.offlineErasureEpoch,
    snapshotRevision: 1,
  });
  expect(
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staffPersonId,
    }),
  ).toMatchObject({ ok: true });
  const response = await POST(
    postRequest(
      { events: [{ ...event, erasureEpochToken: token, note: "A private observation" }] },
      true,
    ),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: event.clientEventId,
        status: "unresolved",
        noteDisposition: "discarded_erasure_cutoff",
      }),
    ],
  });
});

it("does not block an independent event when the queue references over 200 refusals", async () => {
  const { shop, event } = await capturedEvent("diver");
  const refused = Array.from({ length: 201 }, () => clientRollCallEvidenceId(crypto.randomUUID()));
  const first = await proveMeeting(
    { ...event, observedEvidenceIds: refused.slice(0, 200) },
    shop.id,
  );
  const second = await proveMeeting(
    { ...event, clientEventId: crypto.randomUUID(), observedEvidenceIds: refused.slice(200) },
    shop.id,
  );
  const independent = await proveMeeting({ ...event, clientEventId: crypto.randomUUID() }, shop.id);
  const response = await POST(
    postRequest({ events: [first, second, independent], refusedEvidenceIds: refused }, true),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    results: expect.arrayContaining([
      expect.objectContaining({ clientEventId: first.clientEventId, status: "unresolved" }),
      expect.objectContaining({ clientEventId: second.clientEventId, status: "unresolved" }),
      expect.objectContaining({ clientEventId: independent.clientEventId, status: "applied" }),
    ]),
  });
});

it("verifies a retained note-free intent but refuses altered content and missing keys", async () => {
  const { db, shop, booking, staffPersonId, event } = await capturedEvent("diver");
  expect(await send(event)).toMatchObject({ status: "unresolved" });
  const input = {
    shopId: shop.id,
    tripId: event.tripId,
    clientEventId: event.clientEventId,
    recordedByPersonId: staffPersonId,
    subject: { kind: "seat" as const, bookingId: booking.id },
    source: "offline" as const,
    checkpoint: event.checkpoint,
    status: event.status,
    occurredAt: new Date(event.occurredAt),
    offlineSnapshotId: event.snapshotId,
    offlineSnapshotSavedAt: new Date(event.snapshotSavedAt),
    meetingDay: event.meetingDay,
    observedEvidenceIds: event.observedEvidenceIds,
  };
  const where = and(
    eq(rollCallEventClaims.shopId, shop.id),
    eq(rollCallEventClaims.clientEventId, event.clientEventId),
  );
  await db
    .update(rollCallEventClaims)
    .set({
      unresolvedObservation: capturableObservation(input),
      unresolvedRecordedByPersonId: staffPersonId,
    })
    .where(where);
  const [account] = await db
    .select({ id: userAccounts.id })
    .from(userAccounts)
    .where(eq(userAccounts.personId, staffPersonId));
  if (!account) throw new Error("staff account missing");
  const [session] = await db
    .insert(accountSessions)
    .values({
      userAccountId: account.id,
      personId: staffPersonId,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      roles: ["owner"],
      name: "Staff",
      token: crypto.randomUUID(),
      expiresAt: new Date(nowDate().getTime() + 60_000),
    })
    .returning({ id: accountSessions.id });
  expect(await verifyRetainedObservationForReceipt(db, input, session.id)).toEqual({ ok: true });
  const staleRoster = await readOfflineManifestRoster(db, shop.id, event.tripId);
  if (!staleRoster) throw new Error("roster missing");
  expect(staleRoster.manifests[0]?.retainedSafetyUnresolved).not.toBe(true);
  const changed = vi.fn();
  const unsubscribe = subscribeManifestEvents(shop.id, event.tripId, changed);
  onTestFinished(unsubscribe);
  await db.execute(sql`create function pg_temp.reject_safety_outbox() returns trigger language plpgsql as $$
    begin raise exception 'test outbox failure'; end $$`);
  await db.execute(sql`create trigger test_reject_safety_outbox before insert on ${unresolvedSafetyAlertOutbox}
    for each row execute function pg_temp.reject_safety_outbox()`);
  await expect(persistVerifiedHandoffReceipt(db, input, session.id)).rejects.toThrow();
  const [afterFailure] = await db.select().from(rollCallEventClaims).where(where);
  expect(afterFailure.handoffReceiptId).toBeNull();
  expect(afterFailure.retainedSafetyEvidence).toBeNull();
  expect((await readOfflineManifestRoster(db, shop.id, event.tripId))?.snapshotRevision).toBe(
    staleRoster.snapshotRevision,
  );
  expect(changed).not.toHaveBeenCalled();
  await db.execute(sql`drop trigger test_reject_safety_outbox on ${unresolvedSafetyAlertOutbox}`);
  const firstReceipt = await persistVerifiedHandoffReceipt(db, input, session.id);
  expect(firstReceipt).toMatchObject({
    ok: true,
    receipt: { id: expect.any(String), createdAt: expect.any(Date) },
  });
  if (!firstReceipt.ok || !("receipt" in firstReceipt) || !firstReceipt.receipt)
    throw new Error("receipt missing");
  expect(changed).toHaveBeenCalledTimes(1);
  expect(await persistVerifiedHandoffReceipt(db, input, session.id)).toEqual(firstReceipt);
  expect(changed).toHaveBeenCalledTimes(1);
  await checkAlertObligationRetry(db, input, session.id, firstReceipt);
  unsubscribe();
  expect(await issueOfflineManifestSnapshot(db, shop.id, event.tripId, staleRoster)).toMatchObject({
    ok: false,
    reason: "snapshot_superseded",
  });
  const refreshedRoster = await readOfflineManifestRoster(db, shop.id, event.tripId);
  expect(refreshedRoster?.manifests[0]?.retainedSafetyUnresolved).toBe(true);
  await checkRetainedTripIsNotRemoved(db, shop.id, event.tripId);
  expect(await cancelDeparture(db, shop.id, event.tripId)).toEqual({
    ok: false,
    reason: "unresolved_safety_evidence",
  });
  const email = fakeEmail();
  expect(
    await callTripBlowout(db, {
      shopId: shop.id,
      tripId: event.tripId,
      calledByPersonId: staffPersonId,
      provider: email.provider,
    }),
  ).toMatchObject({ ok: false, reason: "unresolved_safety_evidence" });
  expect(email.sent).toHaveLength(0);
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: event.tripId,
      bookingId: booking.id,
      recordedByPersonId: staffPersonId,
      checkpoint: "after_dive_1",
      status: "boarded",
      source: "live",
    }),
  ).toMatchObject({ ok: true });
  const today = await getTodayWork(
    db,
    shop.id,
    shop.slug,
    shopClock(shop),
    undefined,
    staffTranslator("en-US"),
  );
  expect(today.retainedSafetyUnresolved).toBe(true);
  expect(today.departures.find((departure) => departure.tripId === event.tripId)).toMatchObject({
    retainedSafetyUnresolved: true,
  });
  const closeout = await getDayCloseout(db, shop.id, shop.timezone);
  expect(closeout.departures.find((departure) => departure.tripId === event.tripId)).toMatchObject({
    retainedSafetyUnresolved: true,
  });

  const [storedCopy] = await db
    .select({ facts: rollCallEventClaims.retainedSafetyEvidence })
    .from(rollCallEventClaims)
    .where(where);
  if (!storedCopy.facts) throw new Error("retained facts missing");
  await db
    .update(rollCallEventClaims)
    .set({ retainedSafetyEvidence: { ...storedCopy.facts, status: "boarded" } })
    .where(where);
  expect(await persistVerifiedHandoffReceipt(db, input, session.id)).toMatchObject({
    ok: false,
    reason: "unavailable",
  });
  await db
    .update(rollCallEventClaims)
    .set({ retainedSafetyEvidence: storedCopy.facts })
    .where(where);
  expect(
    await persistVerifiedHandoffReceipt(db, { ...input, status: "boarded" }, session.id),
  ).toMatchObject({ ok: false });

  expect(
    await verifyRetainedObservationForReceipt(db, { ...input, status: "boarded" }, session.id),
  ).toMatchObject({ ok: false });
  await db
    .update(accountSessions)
    .set({ expiresAt: new Date(nowDate().getTime() - 1) })
    .where(eq(accountSessions.id, session.id));
  expect(await verifyRetainedObservationForReceipt(db, input, session.id)).toMatchObject({
    ok: false,
    reason: "forbidden",
  });
  await db.delete(accountSessions).where(eq(accountSessions.id, session.id));
  expect(await verifyRetainedObservationForReceipt(db, input, session.id)).toMatchObject({
    ok: false,
    reason: "forbidden",
  });
  await db.insert(accountSessions).values({
    id: session.id,
    userAccountId: account.id,
    personId: staffPersonId,
    shopId: shop.id,
    shopSlug: "blue-mantis",
    roles: ["owner"],
    name: "Staff",
    token: crypto.randomUUID(),
    expiresAt: new Date(nowDate().getTime() + 60_000),
  });
  await db
    .update(rollCallEventClaims)
    .set({ keyFingerprint: "key-no-longer-available" })
    .where(where);
  expect(await verifyRetainedObservationForReceipt(db, input, session.id)).toMatchObject({
    ok: false,
    reason: "unavailable",
  });
  expect(
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staffPersonId,
    }),
  ).toMatchObject({ ok: true });
  const [retained] = await db.select().from(rollCallEventClaims).where(where);
  await checkRetainedReviewIndex(db, input, session.id, null);
  expect(
    await db
      .select()
      .from(unresolvedSafetyAlertOutbox)
      .where(eq(unresolvedSafetyAlertOutbox.generationId, firstReceipt.receipt.id)),
  ).toHaveLength(1);
  expect(retained).toMatchObject({
    state: "erased",
    handoffReceiptId: null,
    unresolvedObservation: null,
    retainedSafetyEvidence: {
      receiptId: firstReceipt.receipt.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      noteRetained: false,
    },
  });
  expect(retained.retainedSafetyEvidence).not.toHaveProperty("note");
  const manifest = await getTripManifest(db, shop.id, event.tripId, "after_dive_1");
  expect(manifest).toMatchObject({
    retainedSafetyUnresolved: true,
    completeness: { complete: false, retainedSafetyUnresolved: true },
  });
});
