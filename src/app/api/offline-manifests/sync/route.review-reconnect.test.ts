// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { bookings, rollCallEvents } from "@/db/schema";
import { getTripRoster } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { buildOfflineManifestCopies } from "@/features/boarding/offline-manifest-snapshots";
import { anonymizeDiver } from "@/features/records/anonymize";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import {
  appendOfflineRollCall,
  loadOfflineManifest,
  saveOfflineManifest,
  syncOfflineManifest,
} from "@/lib/offline-manifest-store";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
import { ROLL_CALL_WITNESS_HEADERS } from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const { POST } = await import("./route");
const context = fileScopedShopContext();
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
afterEach(
  () =>
    new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("diveday-offline-manifests");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    }),
);
it("keeps an unavailable observation for review and syncs the independent observation with the real route", async () => {
  const { db, shop } = context;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (item) => item.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("trip missing");
  const [first, second] = await getTripRoster(db, shop.id, trip.id);
  if (!first || !second) throw new Error("two divers required");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue({
    user: {
      personId,
      shopId: shop.id,
      shopSlug: shop.slug,
      name: "Synthetic",
      email: "synthetic@example.com",
      roles: ["owner"],
    },
  } as DiveDaySession);
  const initial = await buildOfflineManifestCopies(db, shop, personId, [trip.id]);
  const payload = initial.payloads[0];
  if (!payload) throw new Error("snapshot missing");
  await saveOfflineManifest(payload);
  const firstCopy = await appendOfflineRollCall(trip.id, {
    bookingId: first.booking.id,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    note: "synthetic note",
    snapshotId: payload.snapshotId,
    snapshotSavedAt: nowDate().toISOString(),
    erasureEpochToken: "invalid",
  });
  const firstEvent = firstCopy.events[0];
  const beforeCollision = await db
    .select()
    .from(rollCallEvents)
    .where(eq(rollCallEvents.tripId, trip.id));
  const collision = await POST(
    new Request("http://localhost/api/offline-manifests/sync", {
      method: "POST",
      headers: { ...ROLL_CALL_WITNESS_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({
        events: [],
        reviewEvents: [firstEvent],
        arrivalEvents: [{ ...firstEvent, status: "arrived" }],
      }),
    }),
  );
  expect(collision.status).toBe(400);
  expect(await db.select().from(rollCallEvents).where(eq(rollCallEvents.tripId, trip.id))).toEqual(
    beforeCollision,
  );
  const secondCopy = await appendOfflineRollCall(trip.id, {
    bookingId: second.booking.id,
    checkpoint: "after_dive_1",
    status: "not_boarded",
  });
  const secondEvent = secondCopy.events[1];
  const thirdCopy = await appendOfflineRollCall(trip.id, {
    bookingId: first.booking.id,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    note: "another synthetic note",
  });
  const thirdEvent = thirdCopy.events[2];
  await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, first.booking.id));
  let requests = 0;
  let started!: () => void, release!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const requestGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.post("/api/offline-manifests/sync", async ({ request }) => {
      requests++;
      const body = await request.json();
      if (requests === 1) {
        started();
        await requestGate;
      }
      const response = await POST(
        new Request("http://localhost/api/offline-manifests/sync", {
          method: "POST",
          headers: { ...ROLL_CALL_WITNESS_HEADERS, "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      return new HttpResponse(await response.text(), {
        status: response.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  const inFlight = syncOfflineManifest(trip.id, shop.slug);
  await requestStarted;
  const withDependent = await appendOfflineRollCall(trip.id, {
    bookingId: first.booking.id,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    note: "dependent synthetic note",
    observedEvidenceIds: [clientRollCallEvidenceId(firstEvent.clientEventId)],
  });
  const dependent = withDependent.events[3];
  release();
  const result = await inFlight;
  expect(result?.events[0]).toMatchObject({
    clientEventId: firstEvent.clientEventId,
    syncStatus: "pending",
    reviewRequired: true,
    rejectionReason: "booking_unavailable",
    note: null,
    noteDisposition: "discarded_unverified_snapshot",
  });
  expect(result?.events[1]).toMatchObject({
    clientEventId: secondEvent.clientEventId,
    syncStatus: "applied",
  });
  expect(result?.events[2]).toMatchObject({
    clientEventId: thirdEvent.clientEventId,
    syncStatus: "pending",
    reviewRequired: true,
    note: "another synthetic note",
  });
  expect(result?.events[3]).toMatchObject({
    clientEventId: dependent.clientEventId,
    syncStatus: "pending",
    reviewRequired: true,
    note: "dependent synthetic note",
  });
  expect((await loadOfflineManifest(trip.id))?.events).toEqual(result?.events);
  expect(
    await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, firstEvent.clientEventId)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, secondEvent.clientEventId)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, dependent.clientEventId)),
  ).toHaveLength(0);
  const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  expect(manifest?.divers.find((diver) => diver.bookingId === first.booking.id)).toBeUndefined();
  expect(
    manifest?.divers.find((diver) => diver.bookingId === second.booking.id)?.rollCall,
  ).toMatchObject({
    state: "not_boarded",
  });
  expect(
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: first.booking.personId,
      actorPersonId: personId,
    }),
  ).toMatchObject({ ok: true });
  const afterErasure = await syncOfflineManifest(trip.id, shop.slug);
  expect(afterErasure?.events[2]).toMatchObject({
    clientEventId: thirdEvent.clientEventId,
    syncStatus: "pending",
    reviewRequired: true,
    note: null,
    noteDisposition: "discarded_erasure_cutoff",
  });
  expect(afterErasure?.events[3]).toMatchObject({
    clientEventId: dependent.clientEventId,
    syncStatus: "pending",
    reviewRequired: true,
    note: null,
    noteDisposition: "discarded_erasure_cutoff",
  });
  await syncOfflineManifest(trip.id, shop.slug);
  expect(requests).toBe(2);
});
