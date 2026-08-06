import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectAndListen,
  LISTEN_IDLE_CLOSE_MS,
  manifestSubscriberCount,
  type NotifyClient,
  subscribeManifestEvents,
} from "./manifest-events";

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

/**
 * The module parks its listener set and its connection lifecycle on
 * `globalThis` so they survive a dev server's HMR (see the `globalForManifestEvents`
 * comment in manifest-events.ts). A module reset therefore does *not* reset
 * them, and neither does moving to the next test: without this, one case's
 * still-"running" connection makes the next case's first subscriber a
 * *second* subscriber, which is exactly the state the idle close is about.
 */
function resetInstanceState(): void {
  const global = globalThis as unknown as {
    divedayManifestListeners?: unknown;
    divedayManifestListen?: unknown;
  };
  global.divedayManifestListeners = undefined;
  global.divedayManifestListen = undefined;
}

/**
 * The module narrates its connection lifecycle deliberately — those lines are
 * the only handle an operator has on how many Neon direct connections this
 * feature is holding (docs/engineering/realtime-manifest-events-runbook.md).
 * These suites drive it dozens of times, so the lines are captured rather than
 * printed, and read back where a test is actually about one.
 */
function captureLogLines() {
  const spies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
  ];
  return {
    restore: () => {
      for (const spy of spies) spy.mockRestore();
    },
    events: () =>
      spies
        .flatMap((spy) => spy.mock.calls as unknown[][])
        .map((call) => JSON.parse(String(call[0])) as Record<string, unknown>),
  };
}

describe("connectAndListen", () => {
  let quiet: ReturnType<typeof captureLogLines>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetInstanceState();
    quiet = captureLogLines();
  });

  afterEach(() => {
    vi.useRealTimers();
    quiet.restore();
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

  it("names the SQLSTATE when Postgres refuses the connection, so the connection ceiling is not a silent failure", async () => {
    const refused = new FakeClient();
    // What Neon answers once every warm instance's direct connection is
    // spoken for: 53300 too_many_connections. Before this line the refusal
    // was invisible — push simply stopped working on this instance.
    refused.connectError = Object.assign(new Error("too many connections"), { code: "53300" });
    const succeeding = new FakeClient();
    const clients = [refused, succeeding];
    let created = 0;

    await connectAndListen(2000, () => asNotifyClient(clients[created++] as FakeClient));

    expect(quiet.events()).toContainEqual(
      expect.objectContaining({
        event: "manifest_events.listen_connect_failed",
        level: "warn",
        sqlstate: "53300",
        retryInMs: 2000,
      }),
    );
  });
});

/**
 * OPS-8. 20260726-manifest-push-refresh opened this connection on the first
 * subscriber and then *never closed it*, so a warm instance that served one
 * manifest stream at 8am still held a Neon direct connection at 6pm while
 * serving nothing but bookings. These cases are about the closing half
 * (ADR 20260806-manifest-listen-connection-ceiling).
 *
 * They drive `connectAndListen` directly rather than letting
 * `subscribeManifestEvents` open the connection, because the open path takes
 * no injectable client — reaching it would dial a real `pg.Client`. Driving it
 * directly puts the instance in exactly the state the open path leaves it in
 * (running, with a live client), which is what the close path acts on.
 */
describe("the shared LISTEN connection's lifetime", () => {
  let quiet: ReturnType<typeof captureLogLines>;

  beforeEach(() => {
    vi.useFakeTimers();
    resetInstanceState();
    quiet = captureLogLines();
  });

  afterEach(() => {
    vi.useRealTimers();
    quiet.restore();
    resetInstanceState();
  });

  it("holds the connection while a viewer is subscribed and closes it once the idle window elapses", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));
    expect(quiet.events()).toContainEqual(
      expect.objectContaining({ event: "manifest_events.listen_opened" }),
    );

    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => {});
    expect(manifestSubscriberCount()).toBe(1);

    // A subscriber is holding it: no amount of time closes it.
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS * 3);
    expect(client.ended).toBe(false);

    unsubscribe();
    expect(manifestSubscriberCount()).toBe(0);
    // The linger is the point — leaving is not itself a close, or a viewer's
    // own four-minute stream retirement would churn the connection.
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS - 1);
    expect(client.ended).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.ended).toBe(true);
    expect(quiet.events()).toContainEqual(
      expect.objectContaining({ event: "manifest_events.listen_closed", reason: "idle" }),
    );
  });

  it("keeps the connection when a viewer reconnects inside the idle window", async () => {
    const clients = [new FakeClient(), new FakeClient()];
    let created = 0;
    await connectAndListen(2000, () => asNotifyClient(clients[created++] as FakeClient));

    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => {});
    unsubscribe();
    // The route retires each stream at 240s and the client returns ~2s later,
    // which is the churn the 120s linger exists to absorb.
    await vi.advanceTimersByTimeAsync(2_000);
    const again = subscribeManifestEvents("shop-a", "trip-1", () => {});

    // Well past the window the abandoned close would have fired in.
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS * 2);
    expect(clients[0]?.ended).toBe(false);
    // And nothing dialled a second connection to serve the returning viewer.
    expect(created).toBe(1);

    again();
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS);
    expect(clients[0]?.ended).toBe(true);
  });

  it("delivers to a viewer that arrived during the idle window, rather than to a connection that closes underneath it", async () => {
    const client = new FakeClient();
    await connectAndListen(2000, () => asNotifyClient(client));

    const first = subscribeManifestEvents("shop-a", "trip-1", () => {});
    first();
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS / 2);

    const received: string[] = [];
    const second = subscribeManifestEvents("shop-a", "trip-1", () => received.push("fired"));
    try {
      // Past when the first subscriber's idle close would have landed.
      await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS);
      client.emit("notification", {
        channel: "manifest_events",
        payload: JSON.stringify({ shopId: "shop-a", tripId: "trip-1" }),
      });
      expect(received).toEqual(["fired"]);
    } finally {
      second();
    }
  });

  it("stops retrying a connection it cannot open once the last viewer has gone", async () => {
    // Every dial is refused — an instance whose LISTEN cannot connect at all.
    // This is precisely the connection-ceiling case, and the last thing a
    // database that is out of connections needs is warm instances retrying
    // forever on behalf of nobody. Before the close existed they did exactly
    // that, for the life of the instance.
    const created: FakeClient[] = [];
    const createClient = () => {
      const client = new FakeClient();
      client.connectError = Object.assign(new Error("too many connections"), { code: "53300" });
      created.push(client);
      return asNotifyClient(client);
    };

    await connectAndListen(2000, createClient);
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => {});
    unsubscribe();

    // Through the linger the instance is still trying, because a viewer could
    // come back at any moment and this is the connection they would use.
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS);
    const attemptsAtClose = created.length;
    expect(attemptsAtClose).toBeGreaterThan(1);

    // Past the close, the pending retry is abandoned rather than left to fire
    // and revive a connection nobody is listening on.
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS * 10);
    expect(created).toHaveLength(attemptsAtClose);
  });

  it("re-opens on the next subscriber after an idle close", async () => {
    const clients = [new FakeClient(), new FakeClient()];
    let created = 0;
    const createClient = () => asNotifyClient(clients[created++] as FakeClient);

    await connectAndListen(2000, createClient);
    subscribeManifestEvents("shop-a", "trip-1", () => {})();
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS);
    expect(clients[0]?.ended).toBe(true);

    // `subscribeManifestEvents` can't be handed a fake client, so this stands
    // in for the re-open it triggers: what matters is that the module accepts
    // one, rather than believing it is still connected.
    await connectAndListen(2000, createClient);
    expect(created).toBe(2);
    expect(clients[1]?.queries).toEqual(["LISTEN manifest_events"]);
  });

  it("arms nothing in the in-process (PGlite) mode, where no connection was ever dialled", async () => {
    // No connectAndListen: this is dev/test, where subscribeManifestEvents
    // dispatches in-process and there is nothing to close.
    const unsubscribe = subscribeManifestEvents("shop-a", "trip-1", () => {});
    expect(manifestSubscriberCount()).toBe(1);
    unsubscribe();
    expect(manifestSubscriberCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(LISTEN_IDLE_CLOSE_MS * 2);
    expect(quiet.events()).toEqual([]);
  });

  it("counts only live subscribers, since that count is what the route's ceiling is read from", () => {
    const release = [
      subscribeManifestEvents("shop-a", "trip-1", () => {}),
      subscribeManifestEvents("shop-a", "trip-2", () => {}),
      subscribeManifestEvents("shop-b", "trip-3", () => {}),
    ];
    expect(manifestSubscriberCount()).toBe(3);
    release[0]?.();
    expect(manifestSubscriberCount()).toBe(2);
    // Unsubscribing twice must not double-count downward, or the ceiling drifts
    // open over the life of a warm instance.
    release[0]?.();
    expect(manifestSubscriberCount()).toBe(2);
    for (const stop of release) stop();
    expect(manifestSubscriberCount()).toBe(0);
  });
});
