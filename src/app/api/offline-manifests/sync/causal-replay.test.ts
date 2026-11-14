import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import {
  bookingArrivalEvents,
  personRoles,
  preDepartureCheckEvents,
  rollCallEventClaims,
  rollCallEvents,
  tripScheduleDays,
} from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { completeWaiver, issueWaiverRequest } from "@/db/waivers";
import type { DiveDaySession } from "@/lib/auth";
import { authSecret } from "@/lib/auth-secret";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { signOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import * as receiptSecrets from "@/lib/offline-receipt-secrets";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import {
  OFFLINE_UNRESOLVED_HEADER,
  OFFLINE_UNRESOLVED_VERSION,
  ROLL_CALL_CAUSAL_HEADERS,
} from "@/lib/roll-call-protocol";
import { deriveLabelKey, signPayload } from "@/lib/signed-token";
import { fileScopedShopContext } from "@/test/db";
import { meetingGeneration, meetingIncarnation } from "@/test/meeting-generation";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
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
      scheduleGeneration: await meetingGeneration(fileCtx.db, event.tripId),
      datasetIncarnation: await meetingIncarnation(fileCtx.db, event.tripId),
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

for (const other of ["arrival", "checklist"] as const) {
  it(`refuses a cross-queue ${other} ID collision before any write`, async () => {
    const { db, shop, event: captured } = await capturedEvent("diver");
    const event = await proveMeeting(captured, shop.id);
    const common = {
      clientEventId: event.clientEventId.toUpperCase(),
      snapshotId: event.snapshotId,
      snapshotSavedAt: event.snapshotSavedAt,
      tripId: event.tripId,
      occurredAt: event.occurredAt,
    };
    const body =
      other === "arrival"
        ? {
            events: [event],
            arrivalEvents: [{ ...common, bookingId: event.bookingId, status: "arrived" }],
          }
        : {
            events: [event],
            checklistEvents: [
              { ...common, checklistItemId: crypto.randomUUID(), status: "checked", note: null },
            ],
          };
    const response = await POST(postRequest(body, true));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_events" });
    const rows = await db
      .select()
      .from(rollCallEvents)
      .where(
        and(
          eq(rollCallEvents.shopId, shop.id),
          eq(rollCallEvents.clientEventId, event.clientEventId),
        ),
      );
    expect(rows).toEqual([]);
  });
}

for (const kind of ["diver", "crew", "checklist", "arrived", "cleared"] as const) {
  it(`returns a whole-request 401 if staff is revoked before the ${kind} writer`, async () => {
    const { db, shop, staffPersonId, event } = await capturedEvent(
      kind === "crew" ? "crew" : "diver",
    );
    const common = {
      clientEventId: event.clientEventId,
      snapshotId: event.snapshotId,
      snapshotSavedAt: event.snapshotSavedAt,
      tripId: event.tripId,
      occurredAt: event.occurredAt,
    };
    const body =
      kind === "diver" || kind === "crew"
        ? { events: [await proveMeeting(event, shop.id)] }
        : kind === "checklist"
          ? {
              events: [],
              checklistEvents: [
                {
                  ...common,
                  checklistItemId: crypto.randomUUID(),
                  status: "checked",
                  note: "test observation",
                },
              ],
            }
          : {
              events: [],
              arrivalEvents: [{ ...common, bookingId: event.bookingId, status: kind }],
            };
    const request = postRequest(body, true);
    const read = request.json.bind(request);
    // The route checks live roles before reading JSON; revoke at that request
    // boundary to exercise the writer's independent live check with real DB state.
    Object.defineProperty(request, "json", {
      value: async () => {
        await db.delete(personRoles).where(eq(personRoles.personId, staffPersonId));
        return read();
      },
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "authentication_required" });
    const table =
      kind === "diver" || kind === "crew"
        ? rollCallEvents
        : kind === "checklist"
          ? preDepartureCheckEvents
          : bookingArrivalEvents;
    const rows = await db
      .select({ id: table.clientEventId })
      .from(table)
      .where(eq(table.clientEventId, event.clientEventId));
    expect(rows).toEqual([]);
  });
}

it("retries an earlier committed mark after a mid-request staff refusal", async () => {
  const { db, shop, staffPersonId, event: captured } = await capturedEvent("diver");
  const first = await proveMeeting(captured, shop.id);
  expect(await send(first)).toMatchObject({ status: "applied" });
  const second = {
    ...first,
    clientEventId: crypto.randomUUID(),
    status: "boarded",
    observedEvidenceIds: [clientRollCallEvidenceId(first.clientEventId)],
  };
  const request = postRequest({ events: [first, second] }, true);
  const read = request.json.bind(request);
  Object.defineProperty(request, "json", {
    value: async () => {
      await db.delete(personRoles).where(eq(personRoles.personId, staffPersonId));
      return read();
    },
  });
  expect((await POST(request)).status).toBe(401);
  await db.insert(personRoles).values({ personId: staffPersonId, role: "owner" });
  const retry = await POST(postRequest({ events: [first, second] }, true));
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({ clientEventId: first.clientEventId, status: "duplicate" }),
      expect.objectContaining({ clientEventId: second.clientEventId, status: "applied" }),
    ],
  });
});
for (const role of ["diver", "crew"] as const) {
  it(`keeps a pre-generation ${role} proof unresolved instead of applying it`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const [day] = await db
      .select()
      .from(tripScheduleDays)
      .where(and(eq(tripScheduleDays.tripId, event.tripId), eq(tripScheduleDays.dayNumber, 1)));
    if (!day || !authSecret) throw new Error("meeting or signing secret missing");
    const starts = day.startsAt.getTime().toString(36);
    const ends = day.endsAt.getTime().toString(36);
    const tag = signPayload(
      deriveLabelKey(authSecret, "diveday-offline-meeting-identity-v1"),
      JSON.stringify([shop.id, event.tripId, event.snapshotId, 0, day.id, starts, ends]),
    );
    const legacy = { ...event, meetingIdentityProof: `${day.id}.0.${starts}.${ends}.${tag}` };
    expect(await send(legacy)).toMatchObject({
      status: "unresolved",
      reason: "meeting_identity_unverified",
    });
    expect(
      await db
        .select()
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.shopId, shop.id),
            eq(rollCallEvents.clientEventId, event.clientEventId),
          ),
        ),
    ).toEqual([]);
    const response = await POST(postRequest({ events: [legacy] }));
    expect(response.status).toBe(409);
  });
  it(`retains an unproven ${role} event without blocking an independent proven event`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const independent = await proveMeeting(
      { ...event, clientEventId: crypto.randomUUID() },
      shop.id,
    );
    const response = await POST(postRequest({ events: [event, independent] }, true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({
          clientEventId: event.clientEventId,
          status: "unresolved",
          reason: "meeting_identity_unverified",
        }),
        expect.objectContaining({ clientEventId: independent.clientEventId, status: "applied" }),
      ]),
    });
    const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
    expect(rows.some((row) => row.clientEventId === event.clientEventId)).toBe(false);
    expect(rows.some((row) => row.clientEventId === independent.clientEventId)).toBe(true);
  });
  it(`does not apply a ${role} correction that depends on an unresolved event`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const dependent = await proveMeeting(
      {
        ...event,
        clientEventId: crypto.randomUUID(),
        status: "cleared",
        note: "private observation",
        observedEvidenceIds: [clientRollCallEvidenceId(event.clientEventId)],
        retractsClientEventId: event.clientEventId,
      },
      shop.id,
    );
    const response = await POST(postRequest({ events: [dependent, event] }, true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ clientEventId: event.clientEventId, status: "unresolved" }),
        expect.objectContaining({
          clientEventId: dependent.clientEventId,
          status: "unresolved",
          noteDisposition: "discarded_unverified_snapshot",
        }),
      ]),
    });
    const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
    expect(rows.some((row) => row.clientEventId === dependent.clientEventId)).toBe(false);
  });
  it(`keeps an unproven legacy meeting event pending for ${role}`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const response = await POST(postRequest({ events: [event] }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "meeting_identity_unverified" });
    expect(
      await db
        .select()
        .from(rollCallEvents)
        .where(
          and(
            eq(rollCallEvents.shopId, shop.id),
            eq(rollCallEvents.clientEventId, event.clientEventId),
          ),
        ),
    ).toEqual([]);
  });
  it(`still defers a ${role} correction after its refused predecessor leaves the pending batch`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const predecessorId = clientRollCallEvidenceId(crypto.randomUUID());
    const dependent = await proveMeeting(
      { ...event, status: "cleared", observedEvidenceIds: [predecessorId] },
      shop.id,
    );
    const response = await POST(
      postRequest({ events: [dependent], refusedEvidenceIds: [predecessorId] }, true),
    );
    expect(response.status).toBe(200);
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
  it(`refuses a changed day over real offline sync but accepts an unchanged retry for ${role}`, async () => {
    const { db, shop, trip, event } = await capturedEvent(role);
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));
    const start = nowDate().getTime();
    await db.insert(tripScheduleDays).values(
      [0, 1].map((day) => ({
        tripId: trip.id,
        dayNumber: day + 1,
        startsAt: new Date(start + day * 86_400_000),
        endsAt: new Date(start + day * 86_400_000 + 3_600_000),
      })),
    );
    const proven = await proveMeeting(event, shop.id);
    expect(await send(proven)).toMatchObject({ status: "applied" });
    expect(await send(proven)).toMatchObject({ status: "duplicate" });
    expect(await send({ ...proven, meetingDay: 1 })).toMatchObject({
      status: "unresolved",
      reason: "client_event_conflict",
    });
    const rows = await db
      .select()
      .from(rollCallEvents)
      .where(
        and(
          eq(rollCallEvents.shopId, shop.id),
          eq(rollCallEvents.clientEventId, event.clientEventId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meetingDay: 0, captureContext: { meetingDay: 0 } });
  });
  it(`refuses a changed client undo target over real offline sync and preserves both marks for ${role}`, async () => {
    const { db, shop, event: captured } = await capturedEvent(role);
    const event = await proveMeeting(captured, shop.id);
    const other = { ...event, clientEventId: crypto.randomUUID() };
    expect(await send(event)).toMatchObject({ status: "applied" });
    expect(await send(other)).toMatchObject({ status: "applied" });
    const undo = {
      ...event,
      clientEventId: crypto.randomUUID(),
      status: "cleared",
      observedEvidenceIds: [event.clientEventId, other.clientEventId].map(clientRollCallEvidenceId),
      retractsClientEventId: event.clientEventId,
    };
    expect(await send(undo)).toMatchObject({ status: "applied" });
    expect(await send(undo)).toMatchObject({ status: "duplicate" });
    expect(await send({ ...undo, retractsClientEventId: other.clientEventId })).toMatchObject({
      status: "unresolved",
      reason: "client_event_conflict",
    });
    const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
    const first = rows.find((row) => row.clientEventId === event.clientEventId);
    const second = rows.find((row) => row.clientEventId === other.clientEventId);
    const retraction = rows.filter((row) => row.clientEventId === undo.clientEventId);
    expect(first?.statementStatus).toBe("not_boarded");
    expect(second?.statementStatus).toBe("not_boarded");
    expect(retraction).toHaveLength(1);
    expect(retraction[0]).toMatchObject({
      statementStatus: "cleared",
      retractsEventId: first?.id,
      captureContext: { meetingDay: 0, retractsClientEventId: event.clientEventId },
    });
    const manifest = await getTripManifest(db, shop.id, event.tripId, "after_dive_1");
    const row =
      role === "diver"
        ? manifest?.divers.find((item) => item.bookingId === event.bookingId)
        : manifest?.crew.find((item) => item.id === event.crewPersonId);
    expect(row?.rollCall?.state).toBe("not_boarded");
  });
}

it("returns the arrival receipt even when an unrelated old roll-call tap is unresolved", async () => {
  const { db, shop, booking, diverName, event } = await capturedEvent("diver");
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
  if (!issued.ok) throw new Error("fixture waiver request refused");
  await completeWaiver(db, issued.key, {
    signerName: diverName,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  const arrival = {
    clientEventId: crypto.randomUUID(),
    snapshotId: event.snapshotId,
    snapshotSavedAt: event.snapshotSavedAt,
    tripId: event.tripId,
    bookingId: booking.id,
    status: "arrived",
    occurredAt: event.occurredAt,
  };
  const response = await POST(postRequest({ events: [event], arrivalEvents: [arrival] }, true));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    results: expect.arrayContaining([
      expect.objectContaining({ clientEventId: event.clientEventId, status: "unresolved" }),
      expect.objectContaining({ clientEventId: arrival.clientEventId, status: "applied" }),
    ]),
  });
});

it("returns a note disposal receipt for an unverified unresolved tap", async () => {
  const { event } = await capturedEvent("diver");
  const response = await POST(
    postRequest({ events: [{ ...event, note: "private observation" }] }, true),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: event.clientEventId,
        status: "unresolved",
        reason: "meeting_identity_unverified",
        noteDisposition: "discarded_unverified_snapshot",
      }),
    ],
  });
});

it("accepts a queued event with old proofs during a planned key rotation", async () => {
  const { db, shop, event: captured } = await capturedEvent("diver");
  const event = {
    ...(await proveMeeting(captured, shop.id)),
    erasureEpochToken: signOfflineErasureEpoch({
      shopId: shop.id,
      tripId: captured.tripId,
      snapshotId: captured.snapshotId,
      epoch: shop.offlineErasureEpoch,
      snapshotRevision: 1,
    }),
    note: "Observed at the ladder",
  };
  const priorKeys = receiptSecrets.offlineReceiptSecrets();
  const keys = vi
    .spyOn(receiptSecrets, "offlineReceiptSecrets")
    .mockReturnValue(["new key", ...priorKeys]);
  try {
    const first = await POST(postRequest({ events: [event] }, true));
    expect(await first.json()).toMatchObject({
      results: [expect.objectContaining({ status: "applied" })],
    });
    const [stored] = await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, event.clientEventId));
    expect(stored?.note).toBe(event.note);
    const retry = await POST(postRequest({ events: [event] }, true));
    const body = await retry.json();
    expect(body.results[0]).toMatchObject({ status: "duplicate" });
    expect(body.results[0].noteDisposition).toBeUndefined();
  } finally {
    keys.mockRestore();
  }
});

it("repeats a stored note-disposal receipt after the first response is lost", async () => {
  const { db, shop, event } = await capturedEvent("diver");
  const submitted = { ...event, note: "private observation" };
  const first = await POST(postRequest({ events: [submitted] }, true));
  expect(await first.json()).toMatchObject({
    results: [
      expect.objectContaining({
        status: "unresolved",
        noteDisposition: "discarded_unverified_snapshot",
      }),
    ],
  });
  const retry = await POST(postRequest({ events: [{ ...event, note: null }] }, true));
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({
        status: "unresolved",
        noteDisposition: "discarded_unverified_snapshot",
      }),
    ],
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
  expect(JSON.stringify(claim)).not.toContain("private observation");
});

it("keeps raw capture disabled while the unresolved event remains on the device", async () => {
  const { db, shop, event } = await capturedEvent("diver");
  expect(await send(event)).toMatchObject({
    status: "unresolved",
    reason: "meeting_identity_unverified",
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
    state: "unresolved",
    unresolvedObservation: null,
    unresolvedRecordedByPersonId: null,
  });
});

it("durably hands off an ambiguous tap once and rejects a different intent under its identity", async () => {
  const { db, shop, event } = await capturedEvent("diver");
  const request = () => postRequest({ events: [event] }, true);
  const first = await POST(request());
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    results: [
      expect.objectContaining({ clientEventId: event.clientEventId, status: "handed_off" }),
    ],
  });
  const retry = await POST(request());
  expect(retry.status).toBe(200);
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({ clientEventId: event.clientEventId, status: "handed_off" }),
    ],
  });
  const conflict = await POST(postRequest({ events: [{ ...event, status: "boarded" }] }, true));
  expect(await conflict.json()).toMatchObject({
    results: [
      expect.objectContaining({
        clientEventId: event.clientEventId,
        status: "unresolved",
        reason: "client_event_conflict",
      }),
    ],
  });
  const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
  expect(rows.some((row) => row.clientEventId === event.clientEventId)).toBe(false);
});

for (const role of ["diver", "crew"] as const) {
  it(`rechecks the same ${role} claim when a delayed predecessor arrives`, async () => {
    const { shop, event: captured } = await capturedEvent(role);
    const predecessor = await proveMeeting(captured, shop.id);
    const dependent = {
      ...predecessor,
      clientEventId: crypto.randomUUID(),
      status: "boarded",
      observedEvidenceIds: [clientRollCallEvidenceId(predecessor.clientEventId)],
    };
    const first = await POST(postRequest({ events: [dependent] }, true));
    expect(await first.json()).toMatchObject({
      results: [
        expect.objectContaining({
          clientEventId: dependent.clientEventId,
          status: "unresolved",
          reason: "unresolved_predecessor",
        }),
      ],
    });
    expect(await send(predecessor)).toMatchObject({ status: "applied" });
    expect(await send(dependent)).toMatchObject({ status: "applied" });
    expect(await send(dependent)).toMatchObject({ status: "duplicate" });
  });
  it(`does not let a later proven ${role} event reuse an ambiguous identity for different intent`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const handoff = await POST(postRequest({ events: [event] }, true));
    expect(handoff.status).toBe(200);
    expect(await handoff.json()).toMatchObject({
      results: [expect.objectContaining({ clientEventId: event.clientEventId })],
    });
    const changed = await proveMeeting({ ...event, status: "boarded" }, shop.id);
    const replay = await POST(postRequest({ events: [changed] }, true));
    expect(await replay.json()).toMatchObject({
      results: [
        expect.objectContaining({
          clientEventId: event.clientEventId,
          status: "unresolved",
          reason: "client_event_conflict",
        }),
      ],
    });
    const olderClient = await POST(postRequest({ events: [changed] }));
    expect(olderClient.status).toBe(409);
    const dependent = {
      ...changed,
      clientEventId: crypto.randomUUID(),
      observedEvidenceIds: [clientRollCallEvidenceId(event.clientEventId)],
    };
    const later = await POST(postRequest({ events: [dependent] }, true));
    expect(await later.json()).toMatchObject({
      results: [
        expect.objectContaining({
          status: "unresolved",
          reason: "unresolved_predecessor",
        }),
      ],
    });
    const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
    expect(rows.some((row) => row.clientEventId === event.clientEventId)).toBe(false);
    expect(rows.some((row) => row.clientEventId === dependent.clientEventId)).toBe(false);
  });

  it(`does not let a ${role} retry substitute a different meeting proof`, async () => {
    const { shop, event } = await capturedEvent(role);
    const first = await POST(postRequest({ events: [event] }, true));
    expect(await first.json()).toMatchObject({
      results: [expect.objectContaining({ status: "unresolved" })],
    });
    const changed = await proveMeeting(event, shop.id);
    const retry = await POST(postRequest({ events: [changed] }, true));
    expect(await retry.json()).toMatchObject({
      results: [
        expect.objectContaining({
          clientEventId: event.clientEventId,
          status: "unresolved",
          reason: "client_event_conflict",
        }),
      ],
    });
  });
}
