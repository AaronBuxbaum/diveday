import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MANIFEST_SUBSCRIBERS,
  manifestSubscriberCount,
  publishManifestEvent,
  subscribeManifestEvents,
} from "@/db/manifest-events";
import { upcomingTripsWithCounts } from "@/db/trips";
import { seededShopContext } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Same reasoning as src/app/api/offline-manifests/sync/route.test.ts: a bare
// mock avoids ever loading the real next-auth module outside Next's bundler.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { GET, maxDuration } = await import("./route");

function manifestEventsRequest(tripId: string, signal?: AbortSignal) {
  return new Request(`http://localhost/api/trips/${tripId}/manifest-events`, { signal });
}

async function seededContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  return { db, shop, trip };
}

const staffSession = (shopId: string): Session => ({
  user: {
    personId: "staff-1",
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    roles: ["owner"],
  },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

// Distinct sentinels rather than a shared `null` — the stream actually
// closing (controller.close() ran) and the stream just not having produced a
// chunk within the timeout are different outcomes, and a regression test for
// "closes immediately" must be able to tell the difference from "hung open".
const STREAM_CLOSED = Symbol("stream-closed");
const READ_TIMED_OUT = Symbol("read-timed-out");

/**
 * The stream opens with a `retry:` preamble (the reconnect delay the route's
 * own stream retirement depends on), so the chunk a test cares about is never
 * the first one. Skipping comment/`retry:` lines rather than counting chunks
 * keeps these assertions about the event that matters, not about how many
 * heartbeats happened to land first.
 */
function isPreamble(chunk: string): boolean {
  return chunk
    .split("\n")
    .every((line) => line === "" || line.startsWith(":") || line.startsWith("retry:"));
}

async function readOneChunk(
  response: Response,
  timeoutMs = 2000,
): Promise<string | typeof STREAM_CLOSED | typeof READ_TIMED_OUT> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("expected a streamed body");
  const timeout = new Promise<typeof READ_TIMED_OUT>((resolve) =>
    setTimeout(() => resolve(READ_TIMED_OUT), timeoutMs),
  );
  const next = (async () => {
    while (true) {
      const result = await reader.read();
      if (result.done) return STREAM_CLOSED;
      const chunk = new TextDecoder().decode(result.value);
      if (!isPreamble(chunk)) return chunk;
    }
  })();
  const outcome = await Promise.race([next, timeout]);
  await reader.cancel().catch(() => undefined);
  return outcome;
}

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("GET /api/trips/[id]/manifest-events", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET(manifestEventsRequest("00000000-0000-0000-0000-000000000000"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(401);
  });

  it("404s for a trip that doesn't belong to the caller's shop", async () => {
    const { db, shop } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const otherTripId = "11111111-1111-1111-1111-111111111111";
    const response = await GET(manifestEventsRequest(otherTripId), {
      params: Promise.resolve({ id: otherTripId }),
    });
    expect(response.status).toBe(404);
  });

  it("closes the stream immediately when the request is already aborted before start() runs", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const controller = new AbortController();
    controller.abort();
    const response = await GET(manifestEventsRequest(trip.id, controller.signal), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(response.status).toBe(200);
    // Before the fix, an abort listener registered after start() ran would
    // never see an abort that already fired — the stream (and its
    // subscription/heartbeat) would stay open indefinitely instead of
    // closing right away, which this asserts by rejecting the "just hasn't
    // produced a chunk yet" outcome, not only the "got no chunk" one.
    expect(await readOneChunk(response)).toBe(STREAM_CLOSED);
  });

  it("unsubscribes when the stream is cancelled directly, without aborting the request", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const first = await GET(manifestEventsRequest(trip.id), {
      params: Promise.resolve({ id: trip.id }),
    });
    const firstReader = first.body?.getReader();
    if (!firstReader) throw new Error("expected a streamed body");
    // The consumer cancels directly — request.signal is never aborted, so
    // only a cancel() hook on the stream's underlying source catches this.
    await firstReader.cancel();

    const second = await GET(manifestEventsRequest(trip.id), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(second.status).toBe(200);

    await publishManifestEvent(db, shop.id, trip.id);
    // Before the fix, the first stream's stale subscription is still
    // registered, and enqueueing onto its already-cancelled controller
    // throws inside the shared dispatch loop — since Sets iterate in
    // insertion order, that stops the loop before it ever reaches this
    // second, still-open subscriber.
    const chunk = await readOneChunk(second);
    expect(chunk).toContain("event: manifest-changed");
  });

  it("opens with a reconnect delay, so a retired stream is replaced without waiting on the browser default", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET(manifestEventsRequest(trip.id), {
      params: Promise.resolve({ id: trip.id }),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("expected a streamed body");
    // First bytes, without waiting for a heartbeat or a notification: this is
    // also what flushes the response so `EventSource` reaches its open state.
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toMatch(/^retry: \d+\n\n$/);
    await reader.cancel();
  });

  it("retires its own stream well inside the function's duration budget", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    vi.useFakeTimers();
    try {
      const response = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      // Drained in the background rather than read on demand: a read that
      // never resolves is exactly the regression under test, and racing it
      // against a timeout isn't available while the clock is frozen.
      const chunks: string[] = [];
      let closed = false;
      const reader = response.body?.getReader();
      if (!reader) throw new Error("expected a streamed body");
      const pump = (async () => {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          chunks.push(new TextDecoder().decode(result.value));
        }
        closed = true;
      })();

      // A minute in, the stream is still up and heartbeating — retirement is
      // about outliving the platform's patience, not about being short-lived.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(closed).toBe(false);
      expect(chunks.some((chunk) => chunk.startsWith(": ping"))).toBe(true);

      // By the time the platform would kill the invocation, this route has
      // already closed the stream itself. Before the fix nothing ever closed
      // it, and the cutoff — a runtime timeout, logged as an error — was the
      // only thing that ended a viewer's stream.
      await vi.advanceTimersByTimeAsync(maxDuration * 1000);
      expect(closed).toBe(true);
      await pump;
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * OPS-8 / ADR 20260806-manifest-listen-connection-ceiling. Every viewer on an
   * instance shares one dispatch loop and one Neon direct connection, so an
   * unbounded subscriber count is a cost every *other* viewer pays. The refusal
   * has to be a valid, immediately-ended event stream: `EventSource` treats a
   * closed stream as a reconnect and a non-200 as a permanent failure it never
   * retries, so an error status would cost that tab its push channel for the
   * life of the page rather than for a minute.
   */
  it("turns a viewer away at the instance ceiling, as a reconnect rather than an error", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const release = Array.from({ length: MAX_MANIFEST_SUBSCRIBERS }, () =>
      subscribeManifestEvents(shop.id, trip.id, () => {}),
    );
    try {
      const response = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/event-stream");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("expected a streamed body");
      const first = await reader.read();
      // A long hint, not the 2s one an ordinary stream opens with: hammering
      // an instance that is already at its ceiling helps nobody.
      expect(new TextDecoder().decode(first.value)).toBe("retry: 60000\n\n");
      expect((await reader.read()).done).toBe(true);

      // The refused viewer must not have taken a slot on the way out — a
      // refusal that still subscribed would ratchet the ceiling permanently
      // shut on a warm instance.
      expect(manifestSubscriberCount()).toBe(MAX_MANIFEST_SUBSCRIBERS);

      const logged = warn.mock.calls.map((call) => JSON.parse(String(call[0])));
      expect(logged).toEqual([
        expect.objectContaining({
          event: "manifest_events.stream_at_capacity",
          level: "warn",
          subscribers: MAX_MANIFEST_SUBSCRIBERS,
          refused: 1,
        }),
      ]);

      // Every turned-away viewer comes back a minute later to be turned away
      // again, so the line is damped and carries the count instead.
      const second = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      await second.body?.getReader().cancel();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      for (const stop of release) stop();
      warn.mockRestore();
    }
  });

  it("admits a viewer while the instance is one below its ceiling", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const release = Array.from({ length: MAX_MANIFEST_SUBSCRIBERS - 1 }, () =>
      subscribeManifestEvents(shop.id, trip.id, () => {}),
    );
    try {
      const response = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error("expected a streamed body");
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("retry: 2000\n\n");
      expect(manifestSubscriberCount()).toBe(MAX_MANIFEST_SUBSCRIBERS);
      await reader.cancel();
    } finally {
      for (const stop of release) stop();
    }
  });

  it("pushes a manifest-changed event through the stream when the trip's roll call changes", async () => {
    const { db, shop, trip } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id));

    const response = await GET(manifestEventsRequest(trip.id), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(response.status).toBe(200);

    await publishManifestEvent(db, shop.id, trip.id);
    const chunk = await readOneChunk(response);
    expect(chunk).toContain("event: manifest-changed");
  });
});
