import { and, eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import { rollCallEvents, tripScheduleDays } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { clientRollCallEvidenceId } from "@/lib/roll-call-causality";
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

type Event = {
  tripId: string;
  checkpoint: string;
  snapshotId: string;
  snapshotSavedAt: string;
  occurredAt: string;
  clientEventId: string;
  bookingId?: string;
  crewPersonId?: string;
  status: string;
  observedEvidenceIds: string[];
  meetingDay: number;
  retractsClientEventId?: string;
};
async function send(event: Event) {
  const response = await POST(postRequest({ events: [event] }));
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    results: { clientEventId: string; status: string; reason?: string }[];
  };
  expect(body.results).toHaveLength(1);
  return body.results[0];
}
async function capturedEvent(role: "diver" | "crew") {
  const fixture = await seededContext();
  const { db, shop, trip, booking, staffPersonId } = fixture;
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const crewId = (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.crew[0]?.id;
  if (!crewId) throw new Error("fixture missing assigned crew");
  const event: Event = {
    tripId: trip.id,
    checkpoint: "after_dive_1",
    snapshotId: crypto.randomUUID(),
    snapshotSavedAt: nowDate().toISOString(),
    occurredAt: nowDate().toISOString(),
    clientEventId: crypto.randomUUID(),
    ...(role === "diver" ? { bookingId: booking.id } : { crewPersonId: crewId }),
    status: "not_boarded",
    observedEvidenceIds: [],
    meetingDay: 0,
  };
  return { ...fixture, event };
}
for (const role of ["diver", "crew"] as const) {
  it(`refuses a changed day over real offline sync but accepts an unchanged retry for ${role}`, async () => {
    const { db, shop, trip, event } = await capturedEvent(role);
    await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, trip.id));
    const start = nowDate().getTime();
    await db.insert(tripScheduleDays).values(
      [0, 1].map((day) => ({
        tripId: trip.id,
        dayNumber: day + 1,
        startsAt: new Date(start + day * 86_400_000),
        endsAt: new Date(start + day * 86_400_000 + 3_600_000),
      })),
    );
    expect(await send(event)).toMatchObject({ status: "applied" });
    expect(await send(event)).toMatchObject({ status: "duplicate" });
    expect(await send({ ...event, meetingDay: 1 })).toMatchObject({
      status: "rejected",
      reason: "client_event_conflict",
    });
    const rows = await db
      .select()
      .from(rollCallEvents)
      .where(
        and(
          eq(rollCallEvents.shopId, shop.id),
          eq(rollCallEvents.clientEventId, event.clientEventId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ meetingDay: 0, captureContext: { meetingDay: 0 } });
  });
  it(`refuses a changed client undo target over real offline sync and preserves both marks for ${role}`, async () => {
    const { db, shop, event } = await capturedEvent(role);
    const other = { ...event, clientEventId: crypto.randomUUID() };
    expect(await send(event)).toMatchObject({ status: "applied" });
    expect(await send(other)).toMatchObject({ status: "applied" });
    const undo = {
      ...event,
      clientEventId: crypto.randomUUID(),
      status: "cleared",
      observedEvidenceIds: [event.clientEventId, other.clientEventId].map(clientRollCallEvidenceId),
      retractsClientEventId: event.clientEventId,
    };
    expect(await send(undo)).toMatchObject({ status: "applied" });
    expect(await send(undo)).toMatchObject({ status: "duplicate" });
    expect(await send({ ...undo, retractsClientEventId: other.clientEventId })).toMatchObject({
      status: "rejected",
      reason: "client_event_conflict",
    });
    const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.shopId, shop.id));
    const first = rows.find((row) => row.clientEventId === event.clientEventId);
    const second = rows.find((row) => row.clientEventId === other.clientEventId);
    const retraction = rows.filter((row) => row.clientEventId === undo.clientEventId);
    expect(first?.statementStatus).toBe("not_boarded");
    expect(second?.statementStatus).toBe("not_boarded");
    expect(retraction).toHaveLength(1);
    expect(retraction[0]).toMatchObject({
      statementStatus: "cleared",
      retractsEventId: first?.id,
      captureContext: { meetingDay: 0, retractsClientEventId: event.clientEventId },
    });
    const manifest = await getTripManifest(db, shop.id, event.tripId, "after_dive_1");
    const row =
      role === "diver"
        ? manifest?.divers.find((item) => item.bookingId === event.bookingId)
        : manifest?.crew.find((item) => item.id === event.crewPersonId);
    expect(row?.rollCall?.state).toBe("not_boarded");
  });
}
