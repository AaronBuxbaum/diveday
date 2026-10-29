// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { people, personRoles, rollCallEvents, shops, userAccounts } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  purgeOfflineManifestsExceptShop,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import type { OfflineManifestPayload } from "@/lib/offline-manifests";
import { fileScopedShopContext } from "@/test/db";
import { POST } from "./route";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));

const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const fileCtx = fileScopedShopContext();
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(() => {
  vi.mocked(getDb).mockReset();
  vi.mocked(auth).mockReset();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("diveday-offline-manifests");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("failed to reset IndexedDB"));
    }),
);

async function otherShopStaff(db: AppDb) {
  const [shop] = await db
    .insert(shops)
    .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
    .returning();
  if (!shop) throw new Error("failed to create second shop");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Synthetic Shop B Staff" })
    .returning();
  if (!person) throw new Error("failed to create second-shop staff");
  await db.insert(personRoles).values({ personId: person.id, role: "owner" });
  await db.insert(userAccounts).values({
    personId: person.id,
    email: `shop-b-${crypto.randomUUID()}@example.com`,
    hashedPassword: "x",
    status: "active",
  });
  return { shop, person };
}

function staffSession(shop: { id: string; slug: string }, personId: string): DiveDaySession {
  return {
    user: {
      personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: "Synthetic staff",
      email: "staff@example.com",
      roles: ["owner"],
    },
  } as DiveDaySession;
}

describe("offline sync when the authenticated tenant changes in flight", () => {
  it("refuses the whole batch and keeps Shop A's event pending through Shop B purge", async () => {
    const { db, shop: shopA } = fileCtx;
    const [trip] = (await upcomingTripsWithCounts(db, shopA.id)).filter(
      (candidate) => candidate.title === "Two-Tank Reef — Molasses & French",
    );
    if (!trip) throw new Error("seeded test trip missing");
    const [diver] = await getTripRoster(db, shopA.id, trip.id);
    if (!diver) throw new Error("seeded test diver missing");
    const { shop: shopB, person: staffB } = await otherShopStaff(db);
    vi.mocked(getDb).mockResolvedValue(db);
    // The request starts while A is the verified shop; the server handles it
    // after the authenticated session has switched to B.
    vi.mocked(auth).mockResolvedValue(staffSession(shopB, staffB.id));

    const payload: OfflineManifestPayload = {
      shop: {
        slug: shopA.slug,
        name: shopA.name,
        timezone: shopA.timezone,
        emergencyReference: { lines: [], vessel: "", shoreContact: "", plan: "" },
      },
      manifests: [
        {
          trip: {
            id: trip.id,
            title: trip.title,
            startsAt: trip.startsAt.toISOString(),
            endsAt: trip.endsAt.toISOString(),
            plannedDives: trip.plannedDives,
          },
          checkpoint: "departure",
          crew: [],
          divers: [
            {
              bookingId: diver.booking.id,
              fullName: diver.person.fullName,
              email: null,
              emergencyContactName: null,
              emergencyContactPhone: null,
              readiness: { status: "ready", blockers: [] },
              rentalFit: { state: "not_recorded" },
              nitroxRequested: false,
              rollCall: undefined,
            },
          ],
          summary: {
            totalDivers: 1,
            ready: 1,
            blocked: 0,
            boarded: 0,
            notBoarded: 0,
            notBackAboard: 0,
            awaiting: 1,
            unaccountedFor: 1,
            overCapacity: 0,
            notHere: 0,
          },
        },
      ],
    };
    await saveOfflineManifest(payload);
    const queued = await appendOfflineRollCall(trip.id, {
      bookingId: diver.booking.id,
      checkpoint: "departure",
      status: "not_boarded",
    });
    const eventId = queued.events[0]?.clientEventId;
    if (!eventId) throw new Error("offline event missing");

    let requestStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    let releaseRoute: () => void = () => {};
    const routeGate = new Promise<void>((resolve) => {
      releaseRoute = resolve;
    });
    server.use(
      http.post("/api/offline-manifests/sync", async ({ request }) => {
        const body = await request.json();
        expect(body).toMatchObject({ expectedShopSlug: shopA.slug });
        requestStarted();
        await routeGate;
        const response = await POST(
          new Request("http://localhost/api/offline-manifests/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
        );
        return new HttpResponse(await response.text(), {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const sync = syncOfflineManifest(trip.id, shopA.slug);
    await started;
    await purgeOfflineManifestsExceptShop(shopB.slug);
    expect((await loadOfflineManifest(trip.id))?.events[0]?.syncStatus).toBe("pending");
    releaseRoute();

    await expect(sync).rejects.toMatchObject({ code: "shop_changed" });
    expect((await loadOfflineManifest(trip.id))?.events[0]).toMatchObject({
      clientEventId: eventId,
      syncStatus: "pending",
    });
    expect(
      await db
        .select({ id: rollCallEvents.id })
        .from(rollCallEvents)
        .where(eq(rollCallEvents.clientEventId, eventId)),
    ).toHaveLength(0);

    // Older cached clients may omit the comparison field, so ownership of all
    // named trips is independently required by the server before any writer.
    const unhinted = await POST(
      new Request("http://localhost/api/offline-manifests/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          events: [queued.events[0]],
        }),
      }),
    );
    expect(unhinted.status).toBe(404);

    // A repeated purge under B must still retain A's only local evidence.
    await purgeOfflineManifestsExceptShop(shopB.slug);
    expect((await loadOfflineManifest(trip.id))?.events[0]?.syncStatus).toBe("pending");
  });
});
