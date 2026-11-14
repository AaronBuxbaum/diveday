import { and, eq, sql } from "drizzle-orm";
import { beforeEach, expect, it, vi } from "vitest";
import { getTripManifest } from "@/db/manifests";
import {
  bookingArrivalEvents,
  personRoles,
  preDepartureCheckEvents,
  rollCallEvents,
  tripScheduleDays,
} from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import type { DiveDaySession } from "@/lib/auth";
import { nowDate } from "@/lib/clock";
import { signOfflineMeetingIdentity } from "@/lib/offline-meeting-identity";
import { ROLL_CALL_CAUSAL_HEADERS } from "@/lib/roll-call-protocol";
import { fileScopedShopContext } from "@/test/db";
import { meetingGeneration, meetingIncarnation } from "@/test/meeting-generation";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";

const ctx = fileScopedShopContext();
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

beforeEach(() => {
  vi.mocked(getDb).mockReset();
  auth.mockReset();
});

async function fixture() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (row) => row.title === "Two-Tank Reef — Molasses & French",
  );
  if (!trip) throw new Error("trip missing");
  const [seat] = await getTripRoster(db, shop.id, trip.id);
  const crew = (await getTripManifest(db, shop.id, trip.id, "after_dive_1"))?.crew[0];
  if (!seat || !crew?.id) throw new Error("roster missing");
  const personId = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  vi.mocked(getDb).mockResolvedValue(db);
  auth.mockResolvedValue({
    user: {
      shopId: shop.id,
      personId,
      shopSlug: "blue-mantis",
      name: "Dana Reyes",
      email: "staff@demo.invalid",
      roles: ["owner"],
    },
  });
  return { db, shop, trip, bookingId: seat.booking.id, crewId: crew.id, personId };
}

function request(body: unknown) {
  return new Request("http://localhost/api/offline-manifests/sync", {
    method: "POST",
    headers: { ...ROLL_CALL_CAUSAL_HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function proveMeeting<T extends { tripId: string; snapshotId: string }>(
  event: T,
  shopId: string,
) {
  const [day] = await ctx.db
    .select()
    .from(tripScheduleDays)
    .where(and(eq(tripScheduleDays.tripId, event.tripId), eq(tripScheduleDays.dayNumber, 1)));
  if (!day) throw new Error("fixture meeting missing");
  return {
    ...event,
    meetingDay: 0,
    meetingIdentityProof: signOfflineMeetingIdentity({
      scheduleGeneration: await meetingGeneration(ctx.db, event.tripId),
      datasetIncarnation: await meetingIncarnation(ctx.db, event.tripId),
      shopId,
      tripId: event.tripId,
      snapshotId: event.snapshotId,
      meetingDay: 0,
      meetingId: day.id,
      startsAt: day.startsAt,
      endsAt: day.endsAt,
    }),
  };
}

for (const kind of ["diver", "crew", "checklist", "arrived", "cleared"] as const) {
  it(`preserves the batch if staff is revoked before the ${kind} writer`, async () => {
    const { db, trip, bookingId, crewId, personId } = await fixture();
    const now = nowDate().toISOString();
    const event = {
      clientEventId: crypto.randomUUID(),
      snapshotId: crypto.randomUUID(),
      snapshotSavedAt: now,
      tripId: trip.id,
      occurredAt: now,
    };
    const body =
      kind === "diver" || kind === "crew"
        ? {
            events: [
              {
                ...event,
                ...(kind === "diver" ? { bookingId } : { crewPersonId: crewId }),
                checkpoint: "after_dive_1",
                status: "not_boarded",
              },
            ],
          }
        : kind === "checklist"
          ? {
              events: [],
              checklistEvents: [
                {
                  ...event,
                  checklistItemId: crypto.randomUUID(),
                  status: "checked",
                  note: "test observation",
                },
              ],
            }
          : { events: [], arrivalEvents: [{ ...event, bookingId, status: kind }] };
    const req = request(body);
    const read = req.json.bind(req);
    // JSON is read after the route gate. This changes real DB state between
    // that gate and the writer's independent staff check.
    Object.defineProperty(req, "json", {
      value: async () => {
        await db.delete(personRoles).where(eq(personRoles.personId, personId));
        return read();
      },
    });
    const response = await POST(req);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "authentication_required" });
    const table =
      kind === "diver" || kind === "crew"
        ? rollCallEvents
        : kind === "checklist"
          ? preDepartureCheckEvents
          : bookingArrivalEvents;
    const rows = await db
      .select({ id: table.clientEventId })
      .from(table)
      .where(eq(table.clientEventId, event.clientEventId));
    expect(rows).toEqual([]);
  });
}

it("retries an earlier committed mark after staff access is restored", async () => {
  const { db, shop, trip, bookingId, personId } = await fixture();
  const now = nowDate().toISOString();
  const first = await proveMeeting(
    {
      clientEventId: crypto.randomUUID(),
      snapshotId: crypto.randomUUID(),
      snapshotSavedAt: now,
      tripId: trip.id,
      bookingId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: now,
    },
    shop.id,
  );
  const initial = await POST(request({ events: [first] }));
  expect(await initial.json()).toMatchObject({
    results: [{ clientEventId: first.clientEventId, status: "applied" }],
  });
  const second = { ...first, clientEventId: crypto.randomUUID(), status: "boarded" };
  const req = request({ events: [first, second] });
  const read = req.json.bind(req);
  Object.defineProperty(req, "json", {
    value: async () => {
      await db.delete(personRoles).where(eq(personRoles.personId, personId));
      return read();
    },
  });
  expect((await POST(req)).status).toBe(401);
  await db.insert(personRoles).values({ personId, role: "owner" });
  const retry = await POST(request({ events: [first, second] }));
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({ clientEventId: first.clientEventId, status: "duplicate" }),
      expect.objectContaining({ clientEventId: second.clientEventId, status: "applied" }),
    ],
  });
});

it("retries the whole batch after a role is revoked between two writer commits", async () => {
  const { db, shop, trip, bookingId, personId } = await fixture();
  const now = nowDate().toISOString();
  const first = await proveMeeting(
    {
      clientEventId: crypto.randomUUID(),
      snapshotId: crypto.randomUUID(),
      snapshotSavedAt: now,
      tripId: trip.id,
      bookingId,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: now,
    },
    shop.id,
  );
  const second = { ...first, clientEventId: crypto.randomUUID(), status: "boarded" };
  // A trigger in this isolated test DB revokes the writer's roles in the first
  // insert transaction, forcing the next writer to observe the changed state.
  await db.execute(sql`create function pg_temp.revoke_after_mark() returns trigger language plpgsql as $$
    begin delete from person_roles where person_id = NEW.recorded_by_person_id; return NEW; end $$`);
  await db.execute(sql`create trigger test_revoke_after_mark after insert on ${rollCallEvents}
    for each row execute function pg_temp.revoke_after_mark()`);
  const refused = await POST(request({ events: [first, second] }));
  expect(refused.status).toBe(401);
  const rows = await db
    .select({ clientEventId: rollCallEvents.clientEventId })
    .from(rollCallEvents)
    .where(eq(rollCallEvents.clientEventId, first.clientEventId));
  expect(rows).toHaveLength(1);
  expect(
    await db
      .select({ id: rollCallEvents.id })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.clientEventId, second.clientEventId)),
  ).toHaveLength(0);
  await db.execute(sql`drop trigger test_revoke_after_mark on ${rollCallEvents}`);
  await db.insert(personRoles).values({ personId, role: "owner" });
  const retry = await POST(request({ events: [first, second] }));
  expect(await retry.json()).toMatchObject({
    results: [
      expect.objectContaining({ clientEventId: first.clientEventId, status: "duplicate" }),
      expect.objectContaining({ clientEventId: second.clientEventId, status: "applied" }),
    ],
  });
});
