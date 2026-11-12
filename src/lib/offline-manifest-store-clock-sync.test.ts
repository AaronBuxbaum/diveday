// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { withRefreshedSyncFrame } from "@/test/offline-sync-frame";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  selectOfflineRollCallDay,
  syncOfflineManifest,
} from "./offline-manifest-store";
import type { OfflineRollCallEvent } from "./offline-manifests";

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

it("requests and persists the server instant without changing raw queue time", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const raw = nowDate().toISOString();
  const stored = new Date(nowDate().getTime() + 3 * 60_000).toISOString();
  server.use(
    http.post("*/api/offline-manifests/sync", async ({ request }) => {
      const body = (await request.json()) as {
        includeStoredInstants: boolean;
        includeCausalSnapshots: boolean;
        refreshTripId: string;
        events: OfflineRollCallEvent[];
      };
      expect(body.includeStoredInstants).toBe(true);
      expect(body.includeCausalSnapshots).toBe(true);
      expect(body.refreshTripId).toBe("trip-1");
      expect(body.events[0].occurredAt).toBe(raw);
      return HttpResponse.json(
        withRefreshedSyncFrame(
          copy,
          {
            results: [
              {
                clientEventId: body.events[0].clientEventId,
                status: "applied",
                storedOccurredAt: stored,
              },
            ],
            snapshotRevisions: { "trip-1": 3 },
          },
          { events: body.events, revision: 3 },
        ),
      );
    }),
  );
  await syncOfflineManifest("trip-1");
  expect((await loadOfflineManifest("trip-1"))?.events[0]).toMatchObject({
    occurredAt: raw,
    storedOccurredAt: stored,
    syncStatus: "applied",
    syncedAtRevision: 3,
  });
});

it("keeps the explicitly selected meeting day when the accepted sync replaces the roster", async () => {
  const copy = snapshot();
  copy.rollCallMeetingDay = 0;
  copy.rollCallMeetingDays = [
    { startsAt: "2026-07-20T12:00Z", endsAt: "2026-07-20T16:00Z" },
    { startsAt: "2026-07-21T12:00Z", endsAt: "2026-07-21T16:00Z" },
  ];
  await saveOfflineManifest(copy);
  await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "not_boarded",
    meetingDay: 0,
    observedEvidenceIds: [],
  });
  await selectOfflineRollCallDay("trip-1", 1);
  server.use(
    http.post("*/api/offline-manifests/sync", async ({ request }) => {
      const body = (await request.json()) as { events: OfflineRollCallEvent[] };
      return HttpResponse.json(
        withRefreshedSyncFrame(
          copy,
          {
            results: body.events.map((event) => ({
              clientEventId: event.clientEventId,
              status: "applied",
            })),
          },
          { events: body.events },
        ),
      );
    }),
  );
  const settled = await syncOfflineManifest("trip-1");
  expect(settled?.snapshot.rollCallMeetingDay).toBe(0);
  expect(settled?.selectedRollCallMeetingDay).toBe(1);
  expect((await loadOfflineManifest("trip-1"))?.selectedRollCallMeetingDay).toBe(1);
});

for (const fault of ["absent", "no-trip", "missing-token", "unchanged-revision"] as const) {
  it(`preserves the original pending identity when successful results carry an ${fault} refreshed frame`, async () => {
    const copy = snapshot();
    copy.erasureEpochToken = `0.1.${"a".repeat(43)}`;
    await saveOfflineManifest(copy);
    const queued = await appendOfflineRollCall("trip-1", {
      bookingId: "ready",
      checkpoint: "after_dive_1",
      status: "not_boarded",
    });
    const original = queued.events[0];
    server.use(
      http.post("*/api/offline-manifests/sync", () => {
        const result = withRefreshedSyncFrame(
          copy,
          { results: [{ clientEventId: original.clientEventId, status: "applied" }] },
          { events: queued.events },
        );
        if (fault === "absent") return HttpResponse.json({ results: result.results });
        if (fault === "no-trip") result.refreshedManifests.payloads = [];
        else if (fault === "missing-token")
          delete result.refreshedManifests.payloads[0].erasureEpochToken;
        else result.refreshedManifests.payloads[0].erasureEpochToken = copy.erasureEpochToken;
        return HttpResponse.json(result);
      }),
    );
    await expect(syncOfflineManifest("trip-1")).rejects.toMatchObject({ code: "sync_unreachable" });
    expect((await loadOfflineManifest("trip-1"))?.events[0]).toEqual(original);
    expect((await loadOfflineManifest("trip-1"))?.events[0].syncStatus).toBe("pending");
  });
}
