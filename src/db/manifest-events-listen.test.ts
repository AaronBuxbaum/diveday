import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectAndListen, type NotifyClient, subscribeManifestEvents } from "./manifest-events";

/**
 * Stands in for a real `pg.Client` so this suite can drive
 * `connectAndListen`'s LISTEN issuance, notification dispatch/filtering, and
 * reconnect-with-backoff without a real Postgres server — see the
 * `NotifyClient` docblock in manifest-events.ts for why this is the one thing
 * PGlite (this repo's dev/test database) can never exercise directly.
 */
class FakeClient extends EventEmitter {
  queries: string[] = [];
  ended = false;
  connectError: Error | null = null;

  async connect(): Promise<void> {
    if (this.connectError) throw this.connectError;
  }

  async query(text: string): Promise<void> {
    this.queries.push(text);
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

function asNotifyClient(client: FakeClient): NotifyClient {
  return client as unknown as NotifyClient;
}

describe("connectAndListen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues LISTEN on the manifest_events channel once connected", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));
    expect(client.queries).toEqual(["LISTEN manifest_events"]);
  });

  it("dispatches a notification to a subscriber matching its shopId and tripId", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));
    const received: unknown[] = [];
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => received.push("fired"));
    try {
      client.emit("notification", {
        channel: "manifest_events",
        payload: JSON.stringify({ shopId: "shop-a", tripId: "trip-1" }),
      });
      expect(received).toEqual(["fired"]);
    } finally {
      unsubscribe();
    }
  });

  it("ignores a notification for a different trip", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));
    const received: unknown[] = [];
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => received.push("fired"));
    try {
      client.emit("notification", {
        channel: "manifest_events",
        payload: JSON.stringify({ shopId: "shop-a", tripId: "trip-2" }),
      });
      expect(received).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("ignores a notification on an unrelated channel", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));
    const received: unknown[] = [];
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => received.push("fired"));
    try {
      client.emit("notification", {
        channel: "some_other_channel",
        payload: JSON.stringify({ shopId: "shop-a", tripId: "trip-1" }),
      });
      expect(received).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("drops a malformed payload instead of throwing", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));
    const received: unknown[] = [];
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => received.push("fired"));
    try {
      expect(() => {
        client.emit("notification", { channel: "manifest_events", payload: "not json" });
      }).not.toThrow();
      expect(received).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it("reconnects with backoff when the connection errors after connecting", async () => {
    const clients = [new FakeClient(), new FakeClient()];
    let created = 0;
    const createClient = () => asNotifyClient(clients[created++] as FakeClient);

    await connectAndListen(2000, createClient);
    expect(clients[0]?.queries).toEqual(["LISTEN manifest_events"]);

    clients[0]?.emit("error", new Error("connection reset"));
    await vi.advanceTimersByTimeAsync(2000);

    expect(created).toBe(2);
    expect(clients[0]?.ended).toBe(true);
    expect(clients[1]?.queries).toEqual(["LISTEN manifest_events"]);
  });

  it("resets the backoff to the base delay after a successful LISTEN, not the escalated one it started at", async () => {
    const clients = [new FakeClient(), new FakeClient()];
    let created = 0;
    const createClient = () => asNotifyClient(clients[created++] as FakeClient);

    // Simulate arriving here after several escalations (e.g. 16s) rather
    // than fresh at the base delay.
    await connectAndListen(16_000, createClient);
    expect(clients[0]?.queries).toEqual(["LISTEN manifest_events"]);

    clients[0]?.emit("error", new Error("connection reset"));
    // If the backoff hadn't reset, this reconnect wouldn't fire until 32s.
    await vi.advanceTimersByTimeAsync(2000);

    expect(created).toBe(2);
    expect(clients[1]?.queries).toEqual(["LISTEN manifest_events"]);
  });

  it("retries with backoff when the initial connect() rejects", async () => {
    const failing = new FakeClient();
    failing.connectError = new Error("connection refused");
    const succeeding = new FakeClient();
    const clients = [failing, succeeding];
    let created = 0;
    const createClient = () => asNotifyClient(clients[created++] as FakeClient);

    await connectAndListen(2000, createClient);
    expect(created).toBe(1);
    expect(failing.queries).toEqual([]);

    await vi.advanceTimersByTimeAsync(2000);
    expect(created).toBe(2);
    expect(succeeding.queries).toEqual(["LISTEN manifest_events"]);
  });
});
