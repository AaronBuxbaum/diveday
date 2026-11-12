import { withRefreshedSyncFrame } from "@/test/offline-sync-frame";
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { snapshot } from "@/test/substrate-fixtures/lib/offline-manifests-fixtures";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "./offline-manifest-store";
import { OFFLINE_MANIFEST_RECORD_VERSION, type OfflineRollCallEvent } from "./offline-manifests";
import { ROLL_CALL_CAUSAL_PROTOCOL_HEADER } from "./roll-call-protocol";

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

it("retains opaque legacy queues unchanged after a protocol refusal and retries them with capability", async () => {
  const copy = snapshot();
  await saveOfflineManifest({ shop: copy.shop, manifests: copy.manifests });
  const queued = await appendOfflineRollCall("trip-1", {
    bookingId: "ready",
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const original = queued.events[0];
  expect(original.observedEvidenceIds).toBeUndefined();
  server.use(
    http.post("*/api/offline-manifests/sync", () =>
      HttpResponse.json({ error: "offline_update_required" }, { status: 426 }),
    ),
  );
  await expect(syncOfflineManifest("trip-1")).rejects.toThrow();
  const held = await loadOfflineManifest("trip-1");
  expect(held?.snapshot.version).toBe(OFFLINE_MANIFEST_RECORD_VERSION);
  expect(held?.events[0]).toEqual(original);
  expect(held?.events[0].syncStatus).toBe("pending");
  server.use(
    http.post("*/api/offline-manifests/sync", async ({ request }) => {
      expect(request.headers.get(ROLL_CALL_CAUSAL_PROTOCOL_HEADER)).toBe("1");
      const body = (await request.json()) as { events: OfflineRollCallEvent[] };
      expect(body.events[0]).toEqual(original);
      return HttpResponse.json(
        withRefreshedSyncFrame(
          copy,
          {
            results: [{ clientEventId: original.clientEventId, status: "applied" }],
          },
          { events: body.events },
        ),
      );
    }),
  );
  await syncOfflineManifest("trip-1");
  expect((await loadOfflineManifest("trip-1"))?.events[0]).toMatchObject({
    clientEventId: original.clientEventId,
    syncStatus: "applied",
  });
});
