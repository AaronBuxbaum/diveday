// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { crewSnapshot, snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  selectOfflineRollCallDay,
  syncOfflineManifest,
} from "./offline-manifest-store";
import {
  latestOfflineCrewRollCall,
  latestOfflineRollCall,
  type OfflineManifestSnapshot,
} from "./offline-manifests";
import { clientRollCallEvidenceId } from "./roll-call-causality";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    }),
);
const token = (revision: number) => `0.${revision}.${"a".repeat(43)}`;

function receivedConflict(
  copy: OfflineManifestSnapshot,
  clientEventId: string,
  role: "diver" | "crew",
) {
  const fresh = role === "crew" ? crewSnapshot() : snapshot();
  fresh.snapshotId = crypto.randomUUID();
  fresh.erasureEpochToken = token(2);
  fresh.rollCallMeetingDay = 0;
  fresh.rollCallMeetingDays = copy.rollCallMeetingDays;
  fresh.rollCallDayBoundaries = copy.rollCallDayBoundaries;
  const manifest = fresh.manifests.find((item) => item.checkpoint === "after_dive_1");
  const row =
    role === "crew"
      ? manifest?.crew.find((item) => item.id === "crew-dana")
      : manifest?.divers.find((item) => item.bookingId === "ready");
  if (!row) throw new Error("fixture subject missing");
  const missing = `server:${crypto.randomUUID()}`,
    aboard = clientRollCallEvidenceId(clientEventId);
  row.rollCallContext = {
    meetingDay: 0,
    observedEvidenceIds: [missing, aboard],
    conflict: true,
    orderingUnknown: false,
    unknownMeetingDay: false,
    evidence: [
      {
        id: missing,
        status: "not_boarded",
        recordedByName: "Other crew",
        occurredAt: copy.savedAt,
        note: "Did not return",
        meetingDay: 0,
        observedEvidenceIds: [],
      },
      {
        id: aboard,
        status: "boarded",
        recordedByName: "This device",
        occurredAt: copy.savedAt,
        note: null,
        meetingDay: 0,
        observedEvidenceIds: [],
      },
    ],
  };
  row.rollCall = {
    state: "not_boarded",
    occurredAt: copy.savedAt,
    recordedByName: "Other crew",
    note: "Did not return",
  };
  return {
    shop: fresh.shop,
    payloads: [fresh],
    viewer: { personId: "current-viewer" },
    mayHoldMedicalAlertWords: { "trip-1": false },
  };
}

for (const role of ["diver", "crew"] as const) {
  it(`receives the server's opposing evidence on the same device after successful ${role} sync`, async () => {
    const copy = role === "crew" ? crewSnapshot() : snapshot();
    copy.erasureEpochToken = token(1);
    copy.rollCallMeetingDay = 0;
    await saveOfflineManifest(copy);
    const queued = await appendOfflineRollCall("trip-1", {
      ...(role === "diver" ? { bookingId: "ready" } : { crewPersonId: "crew-dana" }),
      checkpoint: "after_dive_1",
      status: "boarded",
      meetingDay: 0,
      observedEvidenceIds: [],
    });
    const event = queued.events[0];
    server.use(
      http.post("*/api/offline-manifests/sync", () =>
        HttpResponse.json({
          results: [{ clientEventId: event.clientEventId, status: "applied" }],
          refreshedManifests: receivedConflict(copy, event.clientEventId, role),
        }),
      ),
    );
    const settled = await syncOfflineManifest("trip-1");
    if (!settled) throw new Error("fixture missing saved copy");
    const local =
      role === "diver"
        ? latestOfflineRollCall(settled.snapshot, settled.events, "ready", "after_dive_1")
        : latestOfflineCrewRollCall(settled.snapshot, settled.events, "crew-dana", "after_dive_1");
    expect(local).toMatchObject({ state: "not_boarded", evidenceConflict: true });
    expect(settled.events[0].clientEventId).toBe(event.clientEventId);
    expect((await loadOfflineManifest("trip-1"))?.snapshot.snapshotId).not.toBe(copy.snapshotId);
  });
}

for (const failure of ["missing", "426", "stale", "foreign"] as const) {
  it(`keeps the original queue and old freshness when refresh proof is ${failure}`, async () => {
    const copy = snapshot();
    copy.erasureEpochToken = token(1);
    copy.rollCallMeetingDay = 0;
    await saveOfflineManifest(copy);
    const queued = await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "after_dive_1",
      status: "not_boarded",
      observedEvidenceIds: [],
      meetingDay: 0,
    });
    const original = queued.events[0];
    server.use(
      http.post("*/api/offline-manifests/sync", () => {
        if (failure === "426")
          return HttpResponse.json({ error: "offline_update_required" }, { status: 426 });
        const refreshed = receivedConflict(copy, original.clientEventId, "diver");
        if (failure === "stale") refreshed.payloads[0].erasureEpochToken = token(1);
        if (failure === "foreign")
          refreshed.payloads[0].shop = { ...copy.shop, slug: "another-shop" };
        return HttpResponse.json({
          results: [{ clientEventId: original.clientEventId, status: "applied" }],
          ...(failure === "missing" ? {} : { refreshedManifests: refreshed }),
        });
      }),
    );
    await expect(syncOfflineManifest("trip-1")).rejects.toThrow();
    const held = await loadOfflineManifest("trip-1");
    expect(held?.events[0]).toEqual(original);
    expect(held?.events[0].syncStatus).toBe("pending");
    expect(held?.snapshot.savedAt).toBe(queued.snapshot.savedAt);
    expect(held?.snapshot.snapshotId).toBe(queued.snapshot.snapshotId);
  });
}

it("refreshes a quiet shell to the other device's explicit resolution without purging retained evidence", async () => {
  const copy = snapshot();
  copy.erasureEpochToken = token(1);
  copy.rollCallMeetingDay = 0;
  await saveOfflineManifest(copy);
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "boarded",
    observedEvidenceIds: [],
    meetingDay: 0,
  });
  const event = queued.events[0];
  const conflict = receivedConflict(copy, event.clientEventId, "diver");
  server.use(
    http.post("*/api/offline-manifests/sync", () =>
      HttpResponse.json({
        results: [{ clientEventId: event.clientEventId, status: "applied" }],
        refreshedManifests: conflict,
      }),
    ),
  );
  await syncOfflineManifest("trip-1");
  const resolved = receivedConflict(copy, event.clientEventId, "diver");
  resolved.payloads[0].erasureEpochToken = token(3);
  const row = resolved.payloads[0].manifests
    .find((item) => item.checkpoint === "after_dive_1")
    ?.divers.find((item) => item.bookingId === "ready");
  if (!row?.rollCallContext) throw new Error("fixture context missing");
  const previous = row.rollCallContext.evidence;
  const id = `client:${crypto.randomUUID()}`;
  row.rollCallContext = {
    ...row.rollCallContext,
    conflict: false,
    observedEvidenceIds: [id],
    evidence: [
      {
        id,
        status: "boarded",
        recordedByName: "Crew resolution",
        occurredAt: copy.savedAt,
        note: null,
        meetingDay: 0,
        observedEvidenceIds: previous.map((item) => item.id),
        reconcilesEvidence: true,
      },
    ],
    ancestry: [
      ...previous.map((item) => ({ id: item.id, status: item.status, observed: [] })),
      { id, status: "boarded", observed: previous.map((item) => item.id), reconciles: true },
    ],
  };
  row.rollCall = { state: "boarded", occurredAt: copy.savedAt, recordedByName: "Crew resolution" };
  server.use(
    http.post("*/api/offline-manifests/sync", async ({ request }) => {
      const body = (await request.json()) as {
        events: unknown[];
        refreshTripId: string;
        includeCausalSnapshots: boolean;
      };
      expect(body.events).toEqual([]);
      expect(body.refreshTripId).toBe("trip-1");
      expect(body.includeCausalSnapshots).toBe(true);
      return HttpResponse.json({ results: [], refreshedManifests: resolved });
    }),
  );
  const fresh = await syncOfflineManifest("trip-1", "blue-mantis", undefined, {
    refreshWhenQuiet: true,
  });
  if (!fresh) throw new Error("fixture copy missing");
  expect(
    latestOfflineRollCall(fresh.snapshot, fresh.events, "ready", "after_dive_1"),
  ).toMatchObject({ state: "boarded", evidenceConflict: false });
  expect(fresh.events).toHaveLength(1);
  expect(fresh.events[0].clientEventId).toBe(event.clientEventId);
});

it("merges a tap queued during receipt refresh without adding unseen evidence to its captured basis", async () => {
  const copy = snapshot();
  copy.erasureEpochToken = token(1);
  copy.rollCallMeetingDay = 0;
  await saveOfflineManifest(copy);
  const first = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "boarded",
    observedEvidenceIds: [],
    meetingDay: 0,
  });
  const predecessor = first.events[0];
  let started!: () => void, finish!: () => void;
  const startedRequest = new Promise<void>((resolve) => {
    started = resolve;
  });
  const finishRequest = new Promise<void>((resolve) => {
    finish = resolve;
  });
  server.use(
    http.post("*/api/offline-manifests/sync", async () => {
      started();
      await finishRequest;
      return HttpResponse.json({
        results: [{ clientEventId: predecessor.clientEventId, status: "applied" }],
        refreshedManifests: receivedConflict(copy, predecessor.clientEventId, "diver"),
      });
    }),
  );
  const receipt = syncOfflineManifest("trip-1");
  await startedRequest;
  const appended = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "not_boarded",
    observedEvidenceIds: [clientRollCallEvidenceId(predecessor.clientEventId)],
    meetingDay: 0,
  });
  const later = appended.events[1];
  finish();
  const settled = await receipt;
  expect(settled?.events).toHaveLength(2);
  expect(settled?.events[0].syncStatus).toBe("applied");
  expect(settled?.events[1]).toEqual(later);
  expect(settled?.events[1].observedEvidenceIds).toEqual([
    clientRollCallEvidenceId(predecessor.clientEventId),
  ]);
});

it("preserves an explicit selected day and the queued tap's original day through a full receipt refresh", async () => {
  const copy = snapshot();
  copy.erasureEpochToken = token(1);
  copy.rollCallMeetingDay = 0;
  copy.rollCallMeetingDays = [
    { startsAt: copy.manifests[0].trip.startsAt, endsAt: copy.manifests[0].trip.endsAt },
    { startsAt: "2026-07-21T12:00:00.000Z", endsAt: "2026-07-21T16:00:00.000Z" },
  ];
  await saveOfflineManifest(copy);
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "boarded",
    observedEvidenceIds: [],
    meetingDay: 0,
  });
  await selectOfflineRollCallDay("trip-1", 1);
  const event = queued.events[0];
  server.use(
    http.post("*/api/offline-manifests/sync", () =>
      HttpResponse.json({
        results: [{ clientEventId: event.clientEventId, status: "applied" }],
        refreshedManifests: receivedConflict(copy, event.clientEventId, "diver"),
      }),
    ),
  );
  const fresh = await syncOfflineManifest("trip-1");
  expect(fresh?.selectedRollCallMeetingDay).toBe(1);
  expect(fresh?.events[0].meetingDay).toBe(0);
});

it("honors erased-note disposal even when the fresh causal frame is unusable, without settling the tap", async () => {
  const copy = snapshot();
  copy.erasureEpochToken = token(1);
  await saveOfflineManifest(copy);
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "not_boarded",
    note: "Erased private words",
    observedEvidenceIds: [],
    meetingDay: 0,
  });
  const event = queued.events[0];
  server.use(
    http.post("*/api/offline-manifests/sync", () =>
      HttpResponse.json({
        results: [
          {
            clientEventId: event.clientEventId,
            status: "applied",
            noteDisposition: "discarded_erasure_cutoff",
          },
        ],
      }),
    ),
  );
  await expect(syncOfflineManifest("trip-1")).rejects.toMatchObject({ code: "sync_unreachable" });
  const held = await loadOfflineManifest("trip-1");
  expect(held?.events[0]).toMatchObject({
    clientEventId: event.clientEventId,
    syncStatus: "pending",
    note: null,
    noteDisposition: "discarded_erasure_cutoff",
  });
  expect(held?.snapshot.snapshotId).toBe(queued.snapshot.snapshotId);
});
