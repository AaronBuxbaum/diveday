// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";

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
        events: Array<{ clientEventId: string; occurredAt: string }>;
      };
      expect(body.includeStoredInstants).toBe(true);
      expect(body.events[0].occurredAt).toBe(raw);
      return HttpResponse.json({
        results: [
          {
            clientEventId: body.events[0].clientEventId,
            status: "applied",
            storedOccurredAt: stored,
          },
        ],
        snapshotRevisions: { "trip-1": 3 },
      });
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
