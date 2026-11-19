import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { getTripManifest, recordRollCall } from "@/db/manifests";
import { listChecklistItems } from "@/db/pre-departure-check";
import {
  bookings,
  people,
  preDepartureCheckEvents,
  rollCallEvents,
  shops,
  trips,
} from "@/db/schema";
import { editTripSection, getTripRoster } from "@/db/trips";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { anonymizeDiver } from "@/features/anonymize";
import { buildOfflineManifestCopies } from "@/features/offline-manifest-snapshots";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { signRollCallWitness, verifyRollCallWitness } from "@/lib/offline-roll-call-witness";
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
    originalWitness: witness,
    originalSnapshotId: saved.snapshotId,
    originalMeetingDay: saved.rollCallMeetingDay ?? 0,
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

it("refuses to resolve an original observation against a different current person", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const witness = saved?.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
  if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
  const meetingDay = saved.rollCallMeetingDay ?? 0;
  const originalWitness = signRollCallWitness({
    shopId: shop.id,
    tripId: trip.id,
    snapshotId: saved.snapshotId,
    subjectKind: "seat",
    subjectId: booking.id,
    checkpoint: "after_dive_1",
    meetingDay,
    meetingGeneration: 0,
    assignmentGeneration: 0,
    frontier: [],
    originalPersonId: crypto.randomUUID(),
  });
  const confirmationId = crypto.randomUUID();
  const { POST: confirm } = await import("../review/route");
  const response = await confirm(
    new Request("http://localhost/api/offline-manifests/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId: trip.id,
        bookingId: booking.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        snapshotId: saved.snapshotId,
        meetingDay,
        witness,
        originalWitness,
        originalSnapshotId: saved.snapshotId,
        originalMeetingDay: meetingDay,
        confirmationId,
        confirmed: true,
      }),
    }),
  );
  expect(response.status).toBe(409);
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, confirmationId)),
  ).toHaveLength(0);
});

it("never treats an empty review witness as an ordinary live mark", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const confirmationId = crypto.randomUUID();
  const snapshotId = crypto.randomUUID();
  const { POST: confirm } = await import("../review/route");
  const response = await confirm(
    new Request("http://localhost/api/offline-manifests/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId: trip.id,
        bookingId: booking.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        snapshotId,
        meetingDay: 0,
        witness: "",
        originalWitness: "",
        originalSnapshotId: snapshotId,
        originalMeetingDay: 0,
        confirmationId,
        confirmed: true,
      }),
    }),
  );
  expect(response.status).toBe(400);
  expect(
    await recordRollCall(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staffPersonId,
      checkpoint: "after_dive_1",
      status: "boarded",
      source: "live",
      clientEventId: confirmationId,
      reviewWitness: "",
    }),
  ).toMatchObject({ ok: false });
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, confirmationId)),
  ).toHaveLength(0);
});

it("does not create a live confirmation after the represented person was erased", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const witness = saved?.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
  if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
  expect(
    (
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: booking.personId,
        actorPersonId: staffPersonId,
      })
    ).ok,
  ).toBe(true);
  const confirmationId = crypto.randomUUID();
  const { POST: confirm } = await import("../review/route");
  const response = await confirm(
    new Request("http://localhost/api/offline-manifests/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId: trip.id,
        bookingId: booking.id,
        checkpoint: "after_dive_1",
        status: "boarded",
        snapshotId: saved.snapshotId,
        meetingDay: saved.rollCallMeetingDay ?? 0,
        witness,
        originalWitness: witness,
        originalSnapshotId: saved.snapshotId,
        originalMeetingDay: saved.rollCallMeetingDay ?? 0,
        confirmationId,
        confirmed: true,
      }),
    }),
  );
  expect(response.status).toBe(409);
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, confirmationId)),
  ).toHaveLength(0);
});

it("returns an exact durable refusal for a stale confirmation and never later applies its ID", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const witness = saved?.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
  if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
  expect(
    (
      await editTripSection(db, shop.id, trip.id, {
        endsAt: new Date(trip.endsAt.getTime() + 3600000),
      })
    ).ok,
  ).toBe(true);
  const confirmationId = crypto.randomUUID();
  const { POST: confirm } = await import("../review/route");
  const body = {
    tripId: trip.id,
    bookingId: booking.id,
    checkpoint: "after_dive_1",
    status: "boarded",
    snapshotId: saved.snapshotId,
    meetingDay: saved.rollCallMeetingDay ?? 0,
    witness,
    originalWitness: witness,
    originalSnapshotId: saved.snapshotId,
    originalMeetingDay: saved.rollCallMeetingDay ?? 0,
    confirmationId,
    confirmed: true,
  };
  const request = () =>
    new Request("http://localhost/api/offline-manifests/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const first = await confirm(request());
  expect(first.status).toBe(409);
  expect(await first.json()).toMatchObject({ status: "not_applied", confirmationId });
  const retry = await confirm(request());
  expect(await retry.json()).toMatchObject({ status: "not_applied", confirmationId });
  const fresh = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const freshWitness = fresh?.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
  if (!fresh?.snapshotId || !freshWitness) throw new Error("fresh witness missing");
  const refreshedBody = {
    ...body,
    snapshotId: fresh.snapshotId,
    meetingDay: fresh.rollCallMeetingDay ?? 0,
    witness: freshWitness,
  };
  const send = (payload: unknown) =>
    confirm(
      new Request("http://localhost/api/offline-manifests/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  expect(await (await send(refreshedBody)).json()).toMatchObject({
    status: "not_applied",
    confirmationId,
  });
  expect(
    await db.select().from(rollCallEvents).where(eq(rollCallEvents.clientEventId, confirmationId)),
  ).toHaveLength(0);
  expect(
    await (await send({ ...refreshedBody, confirmationId: crypto.randomUUID() })).json(),
  ).toMatchObject({ status: "applied" });
});

it("keeps review private from signed-out, revoked and other-tenant staff", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const { GET, POST: confirm } = await import("../review/route");
  const get = (tripId: string) =>
    new Request(`http://localhost/api/offline-manifests/review?tripId=${tripId}`);
  const post = (body: unknown) =>
    new Request("http://localhost/api/offline-manifests/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  auth.mockResolvedValue(null);
  for (const response of [await GET(get(trip.id)), await confirm(post({}))]) {
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
  }
  auth.mockResolvedValue(staffSession(shop.id, crypto.randomUUID()));
  expect((await GET(get(trip.id))).status).toBe(401);
  expect((await confirm(post({}))).status).toBe(401);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const [otherShop] = await db
    .insert(shops)
    .values({ name: "Synthetic other shop", slug: `other-${crypto.randomUUID()}`, timezone: "UTC" })
    .returning();
  const [otherTrip] = await db
    .insert(trips)
    .values({
      shopId: otherShop.id,
      title: "Other trip",
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      capacity: 4,
      plannedDives: 1,
      priceCents: 0,
    })
    .returning();
  const otherResponse = await GET(get(otherTrip.id));
  expect(otherResponse.status).toBe(404);
  expect(otherResponse.headers.get("cache-control")).toContain("no-store");
  const snapshotId = crypto.randomUUID();
  const witness = signRollCallWitness({
    shopId: otherShop.id,
    tripId: trip.id,
    snapshotId,
    subjectKind: "seat",
    subjectId: booking.id,
    checkpoint: "after_dive_1",
    meetingDay: 0,
    meetingGeneration: 0,
    assignmentGeneration: 0,
    frontier: [],
  });
  const response = await confirm(
    post({
      tripId: trip.id,
      bookingId: booking.id,
      checkpoint: "after_dive_1",
      status: "boarded",
      snapshotId,
      meetingDay: 0,
      witness,
      originalWitness: witness,
      originalSnapshotId: snapshotId,
      originalMeetingDay: 0,
      confirmationId: crypto.randomUUID(),
      confirmed: true,
    }),
  );
  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("opens only the witnessed original person for authorized review, and stops after erasure", async () => {
  const { db, shop, trip, booking, staffPersonId } = await seededContext();
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  const saved = (await buildOfflineManifestCopies(db, shop, staffPersonId, [trip.id])).payloads[0];
  const witness = saved?.rollCallWitnesses?.[`seat:${booking.id}:after_dive_1`];
  if (!saved?.snapshotId || !witness) throw new Error("snapshot witness missing");
  const original = saved.manifests
    .find((manifest) => manifest.checkpoint === "after_dive_1")
    ?.divers.find((diver) => diver.bookingId === booking.id);
  if (!original?.personId) throw new Error("represented identity missing");
  const { POST: identify } = await import("../review/identity/route");
  const body = {
    tripId: trip.id,
    bookingId: booking.id,
    snapshotId: saved.snapshotId,
    checkpoint: "after_dive_1",
    meetingDay: saved.rollCallMeetingDay ?? 0,
    witness,
  };
  const request = (input: unknown = body) =>
    new Request("http://localhost/api/offline-manifests/review/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  auth.mockResolvedValue(null);
  expect((await identify(request())).status).toBe(401);
  auth.mockResolvedValue(staffSession(shop.id, crypto.randomUUID()));
  expect((await identify(request())).status).toBe(401);
  auth.mockResolvedValue(staffSession(shop.id, staffPersonId));
  expect(await (await identify(request())).json()).toEqual({
    name: original.fullName,
    sameAssignment: true,
  });
  const [replacement] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Synthetic replacement" })
    .returning();
  await db.update(bookings).set({ personId: replacement.id }).where(eq(bookings.id, booking.id));
  const before = await identify(request());
  expect(before.headers.get("cache-control")).toContain("no-store");
  expect(await before.json()).toEqual({ name: original.fullName, sameAssignment: false });
  expect(await (await identify(request({ ...body, witness: `${witness}x` }))).json()).toEqual({
    name: null,
    sameAssignment: false,
  });
  expect(
    await (await identify(request({ ...body, bookingId: crypto.randomUUID() }))).json(),
  ).toEqual({ name: null, sameAssignment: false });
  const otherTenantWitness = signRollCallWitness({
    shopId: crypto.randomUUID(),
    tripId: trip.id,
    snapshotId: saved.snapshotId,
    subjectKind: "seat",
    subjectId: booking.id,
    checkpoint: "after_dive_1",
    meetingDay: body.meetingDay,
    meetingGeneration: 0,
    assignmentGeneration: 0,
    frontier: [],
    originalPersonId: original.personId,
  });
  expect(await (await identify(request({ ...body, witness: otherTenantWitness }))).json()).toEqual({
    name: null,
    sameAssignment: false,
  });
  await db.update(people).set({ deletedAt: nowDate() }).where(eq(people.id, original.personId));
  expect(await (await identify(request())).json()).toEqual({ name: null, sameAssignment: false });
  await db
    .update(people)
    .set({
      deletedAt: nowDate(),
      mergedIntoPersonId: replacement.id,
      mergedAt: nowDate(),
      mergedByPersonId: staffPersonId,
    })
    .where(eq(people.id, original.personId));
  expect(await (await identify(request())).json()).toEqual({ name: null, sameAssignment: false });
  await db
    .update(people)
    .set({ deletedAt: null, mergedIntoPersonId: null, mergedAt: null, mergedByPersonId: null })
    .where(eq(people.id, original.personId));
  expect(
    (
      await anonymizeDiver(db, {
        shopId: shop.id,
        personId: original.personId,
        actorPersonId: staffPersonId,
      })
    ).ok,
  ).toBe(true);
  expect(await (await identify(request())).json()).toEqual({ name: null, sameAssignment: false });
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
