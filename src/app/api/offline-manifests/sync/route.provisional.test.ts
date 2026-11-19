import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { listChecklistItems } from "@/db/pre-departure-check";
import { preDepartureCheckEvents, rollCallEvents, trips } from "@/db/schema";
import { editTripSection, getTripRoster } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { ROLL_CALL_REVIEW_HEADERS } from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("next/headers", async () => (await import("@/test/next-headers")).nextHeadersStub());
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const { POST } = await import("./route");
function postRequest(body: unknown) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { ...ROLL_CALL_REVIEW_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function seededContext() {
  const { db, shop } = fileCtx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("fixture trip missing");
  const [row] = await getTripRoster(db, shop.id, trip.id);
  if (!row) throw new Error("fixture booking missing");
  const staffPersonId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { db, shop, trip, booking: row.booking, staffPersonId };
}
function staffSession(shopId: string, personId: string): DiveDaySession {
  return {
    user: {
      shopId,
      personId,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: "staff@demo.invalid",
      roles: ["owner"],
    },
  };
}

it("does not replay an observation after a schedule edit and revert", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const id = crypto.randomUUID();
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved) throw new Error("snapshot missing");
  const scheduleBefore = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt, revision: trips.revision })
    .from(trips)
    .where(eq(trips.id, trip.id));
  const originalEnd = trip.endsAt;
  const changed = await editTripSection(db, shop.id, trip.id, {
    endsAt: new Date(originalEnd.getTime() + 3_600_000),
  });
  expect(changed.ok).toBe(true);
  const restored = await editTripSection(db, shop.id, trip.id, { endsAt: originalEnd });
  expect(restored.ok).toBe(true);
  const scheduleAfter = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt, revision: trips.revision })
    .from(trips)
    .where(eq(trips.id, trip.id));
  expect(scheduleAfter).toEqual(scheduleBefore);
  const before = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  const response = await POST(
    postRequest({
      events: [
        {
          tripId: trip.id,
          bookingId: booking.id,
          clientEventId: id,
          snapshotId: saved.snapshotId,
          erasureEpochToken: saved.erasureEpochToken,
          snapshotSavedAt: nowDate().toISOString(),
          occurredAt: nowDate().toISOString(),
          checkpoint: "after_dive_1",
          status: "not_boarded",
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  const after = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  expect(after?.divers.find((d) => d.bookingId === booking.id)?.rollCall).toEqual(
    before?.divers.find((d) => d.bookingId === booking.id)?.rollCall,
  );
  expect(body.results).toContainEqual({
    clientEventId: id,
    status: "rejected",
    reason: "review_required",
  });
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id)),
  ).toHaveLength(0);
});

it("does not sign off an old checklist after a schedule edit and revert", async () => {
  const { db, shop, trip, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const item = (await listChecklistItems(db, shop.id))[0];
  if (!saved || !item) throw new Error("snapshot or checklist item missing");
  expect(
    (
      await editTripSection(db, shop.id, trip.id, {
        endsAt: new Date(trip.endsAt.getTime() + 3_600_000),
      })
    ).ok,
  ).toBe(true);
  expect((await editTripSection(db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
  const id = crypto.randomUUID();
  const response = await POST(
    postRequest({
      events: [],
      checklistEvents: [
        {
          tripId: trip.id,
          checklistItemId: item.id,
          clientEventId: id,
          snapshotId: saved.snapshotId,
          erasureEpochToken: saved.erasureEpochToken,
          snapshotSavedAt: nowDate().toISOString(),
          occurredAt: nowDate().toISOString(),
          status: "checked",
          note: null,
        },
      ],
    }),
  );
  expect(response.status).toBe(200);
  expect(
    await db
      .select()
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.clientEventId, id)),
  ).toHaveLength(0);
});
