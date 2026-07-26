import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { publishManifestEvent } from "@/db/manifest-events";
import { getShopBySlug } from "@/db/shops";
import { upcomingTripsWithCounts } from "@/db/trips";
import { seededTestDb } from "@/test/db";

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
const { GET } = await import("./route");

function manifestEventsRequest(tripId: string, signal?: AbortSignal) {
  return new Request(`http://localhost/api/trips/${tripId}/manifest-events`, { signal });
}

async function seededContext() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
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

async function readOneChunk(
  response: Response,
  timeoutMs = 2000,
): Promise<string | typeof STREAM_CLOSED | typeof READ_TIMED_OUT> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("expected a streamed body");
  const timeout = new Promise<typeof READ_TIMED_OUT>((resolve) =>
    setTimeout(() => resolve(READ_TIMED_OUT), timeoutMs),
  );
  const next = reader
    .read()
    .then((result) => (result.done ? STREAM_CLOSED : new TextDecoder().decode(result.value)));
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
