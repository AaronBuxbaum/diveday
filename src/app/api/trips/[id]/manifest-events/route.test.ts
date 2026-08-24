import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import {
  MAX_MANIFEST_SUBSCRIBERS,
  manifestSubscriberCount,
  publishManifestEvent,
  subscribeManifestEvents,
} from "@/db/manifest-events";
import { people, personRoles, shops, userAccounts } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { seededShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Same reasoning as src/app/api/offline-manifests/sync/route.test.ts: a bare
// mock avoids ever loading the real better-auth module outside Next's bundler.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const auth = authModule.auth;
const { GET, maxDuration } = await import("./route");

function manifestEventsRequest(tripId: string, signal?: AbortSignal) {
  return new Request(`http://localhost/api/trips/${tripId}/manifest-events`, { signal });
}

/**
 * The seeded shop, one of its trips, and one of its *real* staff members.
 *
 * The person id has to be real now: the route re-reads roles from
 * `person_roles` (through `loadActiveStaffRoles`, which also insists on a live
 * `user_accounts` row) at every subscribe, so a made-up `personId` would refuse
 * every request and every stream assertion below would go red for a reason that
 * has nothing to do with what it is testing. Dana Reyes is the seeded owner,
 * which is who this file's session has always claimed to be.
 */
async function seededContext() {
  const { db, shop } = await seededShopContext();
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, trip, personId };
}

const staffSession = (
  shopId: string,
  personId: string,
  roles: DiveDaySession["user"]["roles"] = ["owner"],
): DiveDaySession => ({
  user: {
    personId,
    shopId,
    shopSlug: "blue-mantis",
    name: "Dana Reyes",
    email: "staff@demo.invalid",
    roles,
  },
});

let seq = 0;

/**
 * A staff member built to order, so a test can say "their account is disabled"
 * or "they have no roles left" as a fact in the database rather than a claim on
 * a token. Same shape as `src/db/authz.test.ts`'s helper, which is the one
 * `loadActiveStaffRoles` is specified against.
 */
async function makeStaff(
  db: AppDb,
  shopId: string,
  roles: Role[],
  opts: { status?: "active" | "disabled"; deleted?: boolean } = {},
): Promise<string> {
  seq += 1;
  const [person] = await db
    .insert(people)
    .values({
      shopId,
      fullName: `Stream Staff ${seq}`,
      deletedAt: opts.deleted ? new Date("2026-06-01T00:00:00Z") : null,
    })
    .returning();
  if (!person) throw new Error("failed to insert staff");
  if (roles.length > 0) {
    await db.insert(personRoles).values(roles.map((role) => ({ personId: person.id, role })));
  }
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `stream.staff.${seq}@example.com`,
    hashedPassword: "x",
    status: opts.status ?? "active",
  });
  return person.id;
}

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
  it("rejects an unauthenticated caller without touching the database", async () => {
    // The live-roles re-check below needs a database, so this ordering is a
    // property worth pinning rather than an accident: a caller with no session
    // at all must never reach the pool. Only an authenticated caller whose token
    // *might* be stale pays for the lookup.
    vi.mocked(auth).mockResolvedValue(null);
    const response = await GET(manifestEventsRequest("00000000-0000-0000-0000-000000000000"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("rejects a signed-in diver, whose token never claimed staff", async () => {
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId, ["diver"]));

    const response = await GET(manifestEventsRequest(trip.id), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(response.status).toBe(401);
    // Same short-circuit: the token itself never claimed staff, so there is
    // nothing for a live re-check to disagree with.
    expect(getDb).not.toHaveBeenCalled();
  });

  it("404s for a trip that doesn't belong to the caller's shop", async () => {
    const { db, shop, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const otherTripId = "11111111-1111-1111-1111-111111111111";
    const response = await GET(manifestEventsRequest(otherTripId), {
      params: Promise.resolve({ id: otherTripId }),
    });
    expect(response.status).toBe(404);
  });

  it("closes the stream immediately when the request is already aborted before start() runs", async () => {
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

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
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

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
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

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
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

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
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

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
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

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
    const { db, shop, trip, personId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, personId));

    const response = await GET(manifestEventsRequest(trip.id), {
      params: Promise.resolve({ id: trip.id }),
    });
    expect(response.status).toBe(200);

    await publishManifestEvent(db, shop.id, trip.id);
    const chunk = await readOneChunk(response);
    expect(chunk).toContain("event: manifest-changed");
  });

  /**
   * The same window `/api/offline-manifests/identity` and `/upcoming` closed
   * (78ba3c4). The gate used to read the roles baked into the JWT at sign-in,
   * and no `maxAge` is set on the session (src/lib/auth.config.ts) so NextAuth's
   * 30-day default applies. `/api/**` is excluded from the edge gate
   * (src/proxy.ts), so this handler is the only wall — which meant a staffer
   * removed from the shop kept a live push channel onto its boats for a month.
   *
   * This one is a *stream*, so the gate is at subscribe time and the last test
   * in this block says what that does and does not buy. Placement differs from
   * the sibling routes too: they run the live check after their shop-row lookup,
   * because `loadActiveStaffRoles` is shop-scoped and would turn an owed 404
   * into a 401; this route reads no shop row at all, so the check goes first and
   * a revoked caller cannot tell a real trip id from a made-up one.
   */
  describe("live roles, not the ones the token was stamped with", () => {
    it("refuses a caller whose person_roles rows are gone, token still saying owner", async () => {
      const { db, shop, trip } = await seededContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const before = manifestSubscriberCount();
      const response = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(response.status).toBe(401);
      // A refusal, not an event stream: no subscription was taken out, so the
      // caller holds nothing and costs the instance nothing. A refused viewer
      // that still took a slot would ratchet the ceiling shut on a warm
      // instance, which is the failure the capacity test above guards from the
      // other side.
      expect(response.headers.get("Content-Type")).not.toBe("text/event-stream");
      expect(manifestSubscriberCount()).toBe(before);
    });

    it("refuses a caller demoted to diver, token still saying owner", async () => {
      const { db, shop, trip } = await seededContext();
      const demoted = await makeStaff(db, shop.id, ["diver"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, demoted));

      const response = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(response.status).toBe(401);
    });

    it("refuses a disabled account and a deleted person, both still holding a staff token", async () => {
      const { db, shop, trip } = await seededContext();
      const disabled = await makeStaff(db, shop.id, ["owner"], { status: "disabled" });
      const deleted = await makeStaff(db, shop.id, ["owner"], { deleted: true });
      vi.mocked(getDb).mockResolvedValue(db);

      for (const person of [disabled, deleted]) {
        vi.mocked(auth).mockResolvedValue(staffSession(shop.id, person));
        const response = await GET(manifestEventsRequest(trip.id), {
          params: Promise.resolve({ id: trip.id }),
        });
        expect(response.status).toBe(401);
      }
    });

    it("refuses a token whose personId belongs to another shop's staff", async () => {
      // The re-check is shop-scoped, so it stands as a second wall in front of
      // the tenant boundary `shopId` already draws: this shop's id paired with a
      // person who is not theirs finds nothing.
      const { db, shop, trip } = await seededContext();
      const [otherShop] = await db
        .insert(shops)
        .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
        .returning();
      if (!otherShop) throw new Error("insert failed");
      const foreign = await makeStaff(db, otherShop.id, ["owner"]);

      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, foreign));

      const response = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(response.status).toBe(401);
    });

    it("refuses before the trip lookup, so a revoked caller cannot tell a real trip id from a made-up one", async () => {
      // The ordering choice, stated as behaviour. A live staff member still gets
      // 404 for a trip that is not their shop's (test above) — the difference is
      // only ever visible to someone who is still staff.
      const { db, shop, trip } = await seededContext();
      const stripped = await makeStaff(db, shop.id, []);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(staffSession(shop.id, stripped));

      const real = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      const invented = "11111111-1111-1111-1111-111111111111";
      const missing = await GET(manifestEventsRequest(invented), {
        params: Promise.resolve({ id: invented }),
      });
      expect([real.status, missing.status]).toEqual([401, 401]);
      expect(await real.json()).toEqual(await missing.json());
    });

    it("refuses on the next subscribe after the role is revoked, without a re-issued token", async () => {
      // The revocation window itself, measured: the same session object either
      // side of the delete, and the only thing that changed is a row.
      const { db, shop, trip } = await seededContext();
      const person = await makeStaff(db, shop.id, ["captain"]);
      const session = staffSession(shop.id, person, ["captain"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(session);

      const first = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(first.status).toBe(200);
      await first.body?.getReader().cancel();

      await db.delete(personRoles).where(eq(personRoles.personId, person));
      const second = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(second.status).toBe(401);
    });

    /**
     * The deliberate residual, pinned so the next reader knows it was decided
     * rather than missed.
     *
     * A stream already open when the role is revoked keeps running: the check is
     * at subscribe time only, because the alternatives are a role lookup on each
     * 25s heartbeat (ten per stream, times every subscriber on the instance, on
     * the pool the whole app shares) or one inside the shared dispatch loop,
     * where a throw takes out every *other* viewer. What the survivor receives
     * is `event: manifest-changed` with an empty body — a ping, no diver data;
     * every byte behind it is fetched through routes that now refuse them.
     *
     * And the window is bounded without any of that, by machinery the route
     * already has: it retires each stream itself at STREAM_TTL_MS (four minutes,
     * asserted by "retires its own stream well inside the function's duration
     * budget"), and `EventSource` reconnects two seconds later into a fresh GET
     * that runs the whole gate again — which is the second half of this test.
     * Under four minutes of pings, against thirty days of push before the fix.
     */
    it("lets an already-open stream finish, and refuses its reconnect", async () => {
      const { db, shop, trip } = await seededContext();
      const person = await makeStaff(db, shop.id, ["captain"]);
      const session = staffSession(shop.id, person, ["captain"]);
      vi.mocked(getDb).mockResolvedValue(db);
      vi.mocked(auth).mockResolvedValue(session);

      const open = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(open.status).toBe(200);

      await db.delete(personRoles).where(eq(personRoles.personId, person));

      // Still connected, and still pushed to — this is the accepted cost.
      await publishManifestEvent(db, shop.id, trip.id);
      const chunk = await readOneChunk(open);
      expect(chunk).toContain("event: manifest-changed");
      // ...and it carries no roster: the payload is empty by design, so the
      // residual is "something moved on this boat", not anybody's name.
      expect(chunk).toContain("data: {}");

      // The reconnect the retirement forces is where revocation lands.
      const reconnect = await GET(manifestEventsRequest(trip.id), {
        params: Promise.resolve({ id: trip.id }),
      });
      expect(reconnect.status).toBe(401);
    });
  });
});
