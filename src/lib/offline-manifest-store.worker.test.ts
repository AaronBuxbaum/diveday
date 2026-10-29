// @vitest-environment node
// A service worker has IndexedDB and BroadcastChannel but no `window`.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveOfflineManifest } from "./offline-manifest-store";
import type { OfflineManifestPayload } from "./offline-manifests";

class WorkerBroadcastChannel {
  static channels: WorkerBroadcastChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly name: string) {
    WorkerBroadcastChannel.channels.push(this);
  }

  postMessage(data: unknown) {
    for (const peer of WorkerBroadcastChannel.channels) {
      if (peer !== this && peer.name === this.name) peer.onmessage?.({ data });
    }
  }

  close() {
    WorkerBroadcastChannel.channels = WorkerBroadcastChannel.channels.filter(
      (channel) => channel !== this,
    );
  }
}

const tripId = "91111111-1111-1111-1111-111111111111";
const payload = {
  shop: { slug: "worker-test" },
  manifests: [{ trip: { id: tripId, endsAt: "2026-10-29T12:00:00.000Z" }, divers: [] }],
} as unknown as OfflineManifestPayload;

afterEach(() => {
  WorkerBroadcastChannel.channels = [];
  vi.unstubAllGlobals();
});

describe("service-worker manifest invalidation", () => {
  it("broadcasts a trip-keyed invalidation with source metadata after the IndexedDB write without window", async () => {
    expect(typeof window).toBe("undefined");
    vi.stubGlobal("BroadcastChannel", WorkerBroadcastChannel);
    const received: unknown[] = [];
    const page = new WorkerBroadcastChannel("diveday-offline-manifest-changes-v1");
    page.onmessage = ({ data }) => received.push(data);

    await saveOfflineManifest(payload);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ tripId, reason: "snapshot" });
    expect(received[0]).toEqual(expect.objectContaining({ sourceId: expect.any(String) }));
    expect(WorkerBroadcastChannel.channels).toEqual([page]);
    page.close();
  });
});
