import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { trips } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { verifyOfflineErasureEpoch } from "@/lib/offline-erasure-epoch";
import type { OfflineManifestUpcomingResponse } from "@/lib/offline-manifests";
import { ROLL_CALL_CAUSAL_HEADERS } from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());
const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const { POST } = await import("./route");
function postRequest(body: unknown) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { ...ROLL_CALL_CAUSAL_HEADERS, "content-type": "application/json" },
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

for (const role of ["diver", "crew"] as const) {
  for (const remoteStatus of ["not_boarded", "boarded"] as const) {
    it(`returns a fenced current ${role} frontier after sync with independent ${remoteStatus} evidence`, async () => {
      const { db, shop, trip, booking, staffPersonId } = await seededContext();
      vi.mocked(getDb).mockResolvedValue(db);
      auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
      const crewId = (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.crew[0]?.id;
      if (!crewId) throw new Error("fixture crew missing");
      const event = (status: "boarded" | "not_boarded") => ({
        clientEventId: crypto.randomUUID(),
        snapshotId: crypto.randomUUID(),
        snapshotSavedAt: nowDate().toISOString(),
        occurredAt: nowDate().toISOString(),
        tripId: trip.id,
        ...(role === "diver" ? { bookingId: booking.id } : { crewPersonId: crewId }),
        checkpoint: "after_dive_1",
        status,
        observedEvidenceIds: [],
        meetingDay: 0,
      });
      const remote = event(remoteStatus),
        queued = event("boarded");
      expect((await POST(postRequest({ events: [remote] }))).status).toBe(200);
      const response = await POST(
        postRequest({ events: [queued], includeCausalSnapshots: true, refreshTripId: trip.id }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      const receipt = (await response.json()) as {
        refreshedManifests: OfflineManifestUpcomingResponse;
        results: { status: string }[];
      };
      expect(receipt.results[0].status).toBe("applied");
      const fresh = receipt.refreshedManifests.payloads[0];
      expect(receipt.refreshedManifests.shop.slug).toBe(shop.slug);
      expect(receipt.refreshedManifests.viewer.personId).toBe(staffPersonId);
      expect(typeof receipt.refreshedManifests.mayHoldMedicalAlertWords[trip.id]).toBe("boolean");
      expect(
        verifyOfflineErasureEpoch({
          token: fresh.erasureEpochToken,
          shopId: shop.id,
          tripId: trip.id,
          snapshotId: fresh.snapshotId,
        }),
      ).not.toBeNull();
      const manifest = fresh.manifests.find((item) => item.checkpoint === "after_dive_1");
      const row =
        role === "diver"
          ? manifest?.divers.find((item) => item.bookingId === booking.id)
          : manifest?.crew.find((item) => item.id === crewId);
      expect(row?.rollCallContext).toMatchObject({
        conflict: remoteStatus === "not_boarded",
        orderingUnknown: false,
      });
      expect(row?.rollCallContext?.observedEvidenceIds).toEqual(
        expect.arrayContaining([
          `client:${remote.clientEventId}`,
          `client:${queued.clientEventId}`,
        ]),
      );
      expect(row?.rollCall).toMatchObject({
        state: remoteStatus === "not_boarded" ? "not_boarded" : "boarded",
      });
    });
  }
}

it("refreshes a quiet saved trip outside the upcoming window and refuses an unknown requested trip", async () => {
  const { db, shop, trip, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  await db
    .update(trips)
    .set({
      startsAt: new Date(nowDate().getTime() - 5 * 86_400_000),
      endsAt: new Date(nowDate().getTime() - 4 * 86_400_000),
    })
    .where(eq(trips.id, trip.id));
  const response = await POST(
    postRequest({ events: [], includeCausalSnapshots: true, refreshTripId: trip.id }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    refreshedManifests: OfflineManifestUpcomingResponse;
    results: unknown[];
  };
  expect(body.results).toEqual([]);
  expect(body.refreshedManifests.payloads[0].manifests[0].trip.id).toBe(trip.id);
  expect(
    (
      await POST(
        postRequest({
          events: [],
          includeCausalSnapshots: true,
          refreshTripId: crypto.randomUUID(),
        }),
      )
    ).status,
  ).toBe(404);
});
