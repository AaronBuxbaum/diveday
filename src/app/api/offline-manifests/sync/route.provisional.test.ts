import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getTripManifest, recordRollCall } from "@/db/manifests";
import { listChecklistItems } from "@/db/pre-departure-check";
import { preDepartureCheckEvents, rollCallEvents, trips } from "@/db/schema";
import { editTripSection, getTripRoster } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { verifyRollCallWitness } from "@/lib/offline-roll-call-witness";
import { ROLL_CALL_REVIEW_HEADERS, ROLL_CALL_WITNESS_HEADERS } from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const fileCtx = fileScopedShopContext();
beforeAll(() => vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1"));
afterAll(() => vi.unstubAllEnvs());
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
    headers: { ...ROLL_CALL_WITNESS_HEADERS, "content-type": "application/json" },
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

it("refuses a cached review-protocol client before settling a batch", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  const response = await POST(
    new Request("http://localhost/api/offline-manifests/sync", {
      method: "POST",
      headers: { ...ROLL_CALL_REVIEW_HEADERS, "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            tripId: trip.id,
            bookingId: booking.id,
            clientEventId: crypto.randomUUID(),
            snapshotId: saved.snapshotId,
            erasureEpochToken: saved.erasureEpochToken,
            snapshotSavedAt: nowDate().toISOString(),
            occurredAt: nowDate().toISOString(),
            checkpoint: "after_dive_1",
            status: "not_boarded",
          },
        ],
      }),
    }),
  );
  expect(response.status).toBe(426);
});

it("issues a signed snapshot witness for a represented seat", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  expect(saved).toHaveProperty("rollCallWitnesses");
  const witnesses = (saved as typeof saved & { rollCallWitnesses: Record<string, string> })
    .rollCallWitnesses;
  const token = witnesses[`seat:${booking.id}:after_dive_1`];
  expect(
    verifyRollCallWitness(token, {
      shopId: shop.id,
      tripId: trip.id,
      snapshotId: saved.snapshotId,
      subjectKind: "seat",
      subjectId: booking.id,
      checkpoint: "after_dive_1",
      meetingDay: saved.rollCallMeetingDay ?? 0,
    }),
  ).toMatchObject({ meetingGeneration: 0, assignmentGeneration: 0 });
});

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
          rollCallWitness: saved.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`],
          meetingDay: saved.rollCallMeetingDay ?? 0,
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

it("applies an unchanged witnessed seat observation and persists its capture generations", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  expect((await editTripSection(db, shop.id, trip.id, { endsAt: trip.endsAt })).ok).toBe(true);
  const id = crypto.randomUUID();
  const body = {
    events: [
      {
        tripId: trip.id,
        bookingId: booking.id,
        clientEventId: id,
        snapshotId: saved.snapshotId,
        erasureEpochToken: saved.erasureEpochToken,
        rollCallWitness: saved.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`],
        meetingDay: saved.rollCallMeetingDay ?? 0,
        snapshotSavedAt: nowDate().toISOString(),
        occurredAt: nowDate().toISOString(),
        checkpoint: "after_dive_1",
        status: "not_boarded",
      },
    ],
  };
  const response = await POST(postRequest(body));
  expect(response.status).toBe(200);
  expect((await response.json()).results).toContainEqual({ clientEventId: id, status: "applied" });
  expect((await (await POST(postRequest(body))).json()).results).toContainEqual({
    clientEventId: id,
    status: "duplicate",
  });
  const [event] = await db
    .select()
    .from(rollCallEvents)
    .where(eq(rollCallEvents.clientEventId, id));
  expect(event).toMatchObject({
    offlineMeetingGeneration: 0,
    offlineAssignmentGeneration: 0,
    statementStatus: "not_boarded",
  });
  expect(
    (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.divers.find(
      (diver) => diver.bookingId === booking.id,
    )?.rollCall?.state,
  ).toBe("not_boarded");
});

it("keeps an unbound previously recorded observation pending rather than calling it a safe duplicate", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  const id = crypto.randomUUID();
  vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "0");
  try {
    expect(
      await recordRollCall(db, {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: booking.id,
        recordedByPersonId: staffPersonId,
        checkpoint: "after_dive_1",
        status: "not_boarded",
        source: "offline",
        clientEventId: id,
        offlineSnapshotSavedAt: nowDate(),
      }),
    ).toMatchObject({ ok: true });
  } finally {
    vi.stubEnv("DIVEDAY_OFFLINE_ROLL_CALL_WITNESS", "1");
  }
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
  expect((await response.json()).results).toContainEqual({
    clientEventId: id,
    status: "rejected",
    reason: "review_required",
  });
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id)),
  ).toHaveLength(1);
});

it("holds a conflicting seat while applying an unrelated witnessed seat", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const second = (await getTripRoster(db, shop.id, trip.id)).find(
    (row) => row.booking.id !== booking.id,
  )?.booking;
  if (!second) throw new Error("second seat missing");
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staffPersonId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
    }),
  ).toMatchObject({ ok: true });
  const conflictId = crypto.randomUUID();
  const independentId = crypto.randomUUID();
  const event = (bookingId: string, clientEventId: string) => ({
    tripId: trip.id,
    bookingId,
    clientEventId,
    snapshotId: saved.snapshotId,
    erasureEpochToken: saved.erasureEpochToken,
    rollCallWitness: saved.rollCallWitnesses?.[`seat:${bookingId}:after_dive_1`],
    meetingDay: saved.rollCallMeetingDay ?? 0,
    snapshotSavedAt: nowDate().toISOString(),
    occurredAt: nowDate().toISOString(),
    checkpoint: "after_dive_1",
    status: "boarded",
  });
  const response = await POST(
    postRequest({ events: [event(booking.id, conflictId), event(second.id, independentId)] }),
  );
  const body = await response.json();
  expect(body.results).toContainEqual({
    clientEventId: conflictId,
    status: "rejected",
    reason: "review_required",
  });
  expect(body.results).toContainEqual({ clientEventId: independentId, status: "applied" });
  const manifest = await getTripManifest(db, shop.id, trip.id, "after_dive_1");
  expect(manifest?.divers.find((diver) => diver.bookingId === booking.id)?.rollCall?.state).toBe(
    "not_boarded",
  );
  expect(manifest?.divers.find((diver) => diver.bookingId === second.id)?.rollCall?.state).toBe(
    "boarded",
  );
});

it("keeps an unwitnessed crew observation pending for review", async () => {
  const { db, shop, trip, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const crew = saved?.manifests[0]?.crew[0];
  if (!saved?.snapshotId || !crew) throw new Error("snapshot crew missing");
  const id = crypto.randomUUID();
  const response = await POST(
    postRequest({
      events: [
        {
          tripId: trip.id,
          crewPersonId: crew.id,
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
  expect((await response.json()).results).toContainEqual({
    clientEventId: id,
    status: "rejected",
    reason: "review_required",
  });
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id)),
  ).toHaveLength(0);
});

it("records an explicit current live confirmation exactly once", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  if (!saved?.snapshotId) throw new Error("snapshot missing");
  const witness = saved.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
  if (!witness) throw new Error("witness missing");
  const id = crypto.randomUUID();
  const body = {
    tripId: trip.id,
    bookingId: booking.id,
    checkpoint: "after_dive_1",
    status: "boarded",
    snapshotId: saved.snapshotId,
    meetingDay: saved.rollCallMeetingDay ?? 0,
    witness,
    confirmationId: id,
    confirmed: true,
  };
  const { POST: confirm } = await import("../review/route");
  const request = () =>
    new Request("http://localhost/api/offline-manifests/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const first = await confirm(request());
  expect(first.status).toBe(200);
  const firstBody = await first.json();
  expect(firstBody).toMatchObject({ status: "applied", confirmationId: id });
  const retry = await confirm(request());
  expect(await retry.json()).toMatchObject({
    status: "duplicate",
    eventId: firstBody.eventId,
    confirmationId: id,
  });
  const rows = await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, id));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ source: "live", statementStatus: "boarded" });
  expect(
    (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.divers.find(
      (diver) => diver.bookingId === booking.id,
    )?.rollCall?.state,
  ).toBe("boarded");
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
  expect((await response.json()).results).toContainEqual({
    clientEventId: id,
    status: "rejected",
    reason: "review_required",
  });
  expect(
    await db
      .select()
      .from(preDepartureCheckEvents)
      .where(eq(preDepartureCheckEvents.clientEventId, id)),
  ).toHaveLength(0);
});
