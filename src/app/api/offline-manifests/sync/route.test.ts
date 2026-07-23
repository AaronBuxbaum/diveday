import { and, eq, inArray } from "drizzle-orm";
import type { Session } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { STAFF_ROLES } from "@/lib/authz";
import { nowDate } from "@/lib/clock";
import { seededTestDb } from "@/test/db";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// Not importOriginal()'d: the real module pulls in next-auth, which this
// preview-track Next/next-auth combo can't resolve outside Next's own
// bundler (see ADR 20260719-msw-offline-sync-only). The route only needs
// `auth`, so a bare mock avoids ever loading the real module. `auth`'s real
// type is NextAuth's overloaded (session-getter | middleware) signature,
// which confuses `vi.mocked()`'s overload resolution — type the mock
// directly as the narrow shape this route actually calls.
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const { POST } = await import("./route");

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function seededContext() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const trip = trips.find((t) => t.title === "Two-Tank Reef — Molasses & French");
  if (!trip) throw new Error("expected seeded trip missing");
  const roster = await getTripRoster(db, shop.id, trip.id);
  const [row] = roster;
  if (!row) throw new Error("expected seeded booking missing");
  const [staff] = await db
    .select({ id: people.id })
    .from(people)
    .innerJoin(personRoles, eq(personRoles.personId, people.id))
    .where(and(eq(people.shopId, shop.id), inArray(personRoles.role, [...STAFF_ROLES])));
  if (!staff) throw new Error("expected seeded staff missing");
  return { db, shop, trip, booking: row.booking, staffPersonId: staff.id };
}

const staffSession = (shopId: string, personId: string): Session => ({
  user: { personId, shopId, shopSlug: "blue-mantis", name: "Dana Reyes", roles: ["owner"] },
  expires: new Date(Date.now() + 60_000).toISOString(),
});

beforeEach(() => {
  vi.mocked(auth).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("POST /api/offline-manifests/sync", () => {
  it("rejects an unauthenticated caller", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    const response = await POST(postRequest({ events: [] }));
    expect(response.status).toBe(401);
  });

  it("rejects a non-staff caller even with a valid session shape", async () => {
    const { db, shop } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue({
      user: { personId: "diver-1", shopId: shop.id, shopSlug: "blue-mantis", roles: ["diver"] },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as Session);

    const response = await POST(postRequest({ events: [] }));
    expect(response.status).toBe(401);
  });

  it("rejects a non-JSON body", async () => {
    const { db, shop, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const response = await POST(postRequest({ events: [] }, { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rejects a malformed event payload", async () => {
    const { db, shop, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const response = await POST(postRequest({ events: [{ status: "boarded" }] }));
    expect(response.status).toBe(400);
  });

  it("applies a valid roll-call event and reports it back by client event id", async () => {
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const clientEventId = crypto.randomUUID();
    const now = nowDate().toISOString();
    const response = await POST(
      postRequest({
        events: [
          {
            clientEventId,
            snapshotId: crypto.randomUUID(),
            snapshotSavedAt: now,
            bookingId: booking.id,
            tripId: trip.id,
            checkpoint: "departure",
            status: "not_boarded",
            note: null,
            occurredAt: now,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ clientEventId: string; status: string }>;
    };
    expect(body.results).toEqual([{ clientEventId, status: "applied" }]);
  });

  it("rejects boarding a diver who isn't ready instead of silently applying it", async () => {
    // Seeded bookings start blocked (no waiver signed yet) — see
    // src/db/manifests.test.ts's "derives every active booking ... blocked".
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const clientEventId = crypto.randomUUID();
    const now = nowDate().toISOString();
    const response = await POST(
      postRequest({
        events: [
          {
            clientEventId,
            snapshotId: crypto.randomUUID(),
            snapshotSavedAt: now,
            bookingId: booking.id,
            tripId: trip.id,
            checkpoint: "departure",
            status: "boarded",
            note: null,
            occurredAt: now,
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      results: Array<{ clientEventId: string; status: string; reason?: string }>;
    };
    expect(body.results).toEqual([{ clientEventId, status: "rejected", reason: "not_ready" }]);
  });

  it("resubmitting the same offline event is idempotent, not a second roll-call record", async () => {
    const { db, shop, trip, booking, staffPersonId } = await seededContext();
    vi.mocked(getDb).mockResolvedValue(db);
    vi.mocked(auth).mockResolvedValue(staffSession(shop.id, staffPersonId));

    const clientEventId = crypto.randomUUID();
    const now = nowDate().toISOString();
    const event = {
      clientEventId,
      snapshotId: crypto.randomUUID(),
      snapshotSavedAt: now,
      bookingId: booking.id,
      tripId: trip.id,
      checkpoint: "departure",
      status: "not_boarded",
      note: null,
      occurredAt: now,
    };

    const first = await POST(postRequest({ events: [event] }));
    const firstBody = (await first.json()) as { results: Array<{ status: string }> };
    expect(firstBody.results).toEqual([{ clientEventId, status: "applied" }]);

    // Same clientEventId again — the boat's connection dropped mid-ack and the
    // device resent it. Must not be recorded twice.
    const second = await POST(postRequest({ events: [event] }));
    const secondBody = (await second.json()) as { results: Array<{ status: string }> };
    expect(secondBody.results).toEqual([{ clientEventId, status: "duplicate" }]);
  });
});
