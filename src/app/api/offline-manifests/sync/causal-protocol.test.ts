import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { rollCallEvents } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { ROLL_CALL_CAUSAL_HEADERS } from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
vi.mock("@/db/client", async (original) => ({
  ...(await original<typeof import("@/db/client")>()),
  getDb: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
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

it("requires the causal protocol without reading or settling an older request body", async () => {
  const { db, shop, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const request = postRequest({ events: [] });
  request.headers.delete("x-diveday-roll-call-protocol");
  const response = await POST(request);
  expect(response.status).toBe(426);
  expect(request.bodyUsed).toBe(false);
  expect(await response.json()).toEqual({ error: "offline_update_required" });
});

it("accepts older opaque queued diver and crew evidence through the updated protocol", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  const crewId = manifest?.crew[0]?.id;
  if (!crewId) throw new Error("fixture missing assigned crew");
  const common = {
    tripId: trip.id,
    checkpoint: "after_dive_1",
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: nowDate().toISOString(),
    occurredAt: nowDate().toISOString(),
    status: "not_boarded",
  };
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const response = await POST(
    postRequest({
      events: [
        { ...common, clientEventId: ids[0], bookingId: booking.id },
        { ...common, clientEventId: ids[1], crewPersonId: crewId },
      ],
    }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { results: { status: string }[] };
  expect(body.results.map((row) => row.status)).toEqual(["applied", "applied"]);
  for (const id of ids) {
    const [event] = await db
      .select()
      .from(rollCallEvents)
      .where(and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.clientEventId, id)));
    expect(event).toMatchObject({
      statementStatus: "not_boarded",
      observedEvidenceIds: null,
      status: "not_boarded",
    });
    expect(event.causalFrontier).toContain(`client:${id}`);
  }
});

it("rejects an unauthenticated caller without touching the database", async () => {
  // The live-roles re-check below needs a database, so this ordering is a
  // property worth pinning rather than an accident: a caller with no session
  // at all must never reach the pool. Only an authenticated caller whose token
  // *might* be stale pays for the lookup.
  vi.mocked(getDb).mockClear();
  vi.mocked(auth).mockResolvedValue(null);
  const response = await POST(postRequest({ events: [] }));
  expect(response.status).toBe(401);
  expect(getDb).not.toHaveBeenCalled();
});
