import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { log } from "@/lib/log";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { manifestContext } from "./manifests-test-fixtures";
import { tripAssignments, tripScheduleDays } from "./schema";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

/**
 * **Newest wins within one meeting day, not across the run** (issue #3905,
 * ADR 20261104-roll-call-by-meeting-day). A checkpoint such as `after_dive_1`
 * repeats on every day of a course, so a tablet's queued mark for Saturday is
 * not refused because Sunday's count, taken online, is newer.
 *
 * Two meeting days: day one ended 22 hours ago, day two began 2 hours ago, so
 * the roll-call boundary between them sits 12 hours ago.
 */
const HOUR = 60 * 60 * 1000;

async function twoDayCourse() {
  const ctx = await manifestContext();
  const { db, reef, staff } = ctx;
  const now = nowMs();
  await db.delete(tripScheduleDays).where(eq(tripScheduleDays.tripId, reef.id));
  await db.insert(tripScheduleDays).values([
    {
      tripId: reef.id,
      dayNumber: 1,
      startsAt: new Date(now - 26 * HOUR),
      endsAt: new Date(now - 22 * HOUR),
    },
    {
      tripId: reef.id,
      dayNumber: 2,
      startsAt: new Date(now - 2 * HOUR),
      endsAt: new Date(now + 2 * HOUR),
    },
  ]);
  await db
    .insert(tripAssignments)
    .values({ tripId: reef.id, personId: staff.id })
    .onConflictDoNothing();
  return { ...ctx, now };
}

describe("offline roll call across meeting days", () => {
  it("does not refuse a day-one offline mark synced on day two because day two's mark is newer", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    // Sunday, online: the diver is not back.
    await recordRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 1 * HOUR),
    });
    // Saturday's tap, queued offline, synced now.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        offlineSnapshotSavedAt: new Date(now - 25 * HOUR),
        occurredAt: new Date(now - 23 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("still refuses an older offline mark behind a newer one on the same meeting day", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 30 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 90 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "newer_event_exists" });
  });

  it("does the same for the crew's own roll call", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordCrewRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 1 * HOUR),
    });
    await expect(
      recordCrewRollCall(db, {
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "cccccccc-2222-4222-8222-cccccccccccc",
        offlineSnapshotSavedAt: new Date(now - 25 * HOUR),
        occurredAt: new Date(now - 23 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      recordCrewRollCall(db, {
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "dddddddd-2222-4222-8222-dddddddddddd",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 90 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "newer_event_exists" });
  });
});

/**
 * **A retraction that names nothing retracts nothing after a dive** (issue
 * #3951). An earlier day's stated missing person is carried onto every later
 * day, and a `cleared` at the same after-dive checkpoint on a later day takes
 * it back (`standingByDay`). The compare-and-set reads only the retraction's
 * own meeting day, so before this an unnamed offline `cleared` on day two met
 * nothing on its day, applied, and reached back to silence day one's alarm.
 */
describe("an unnamed offline retraction after a dive", () => {
  it("is refused on day two, and day one's missing diver stays on the manifest", async () => {
    vi.mocked(log).mockClear();
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    // Day one: the diver did not come back from dive 1.
    await recordRollCall(db, { ...base, status: "not_boarded", occurredAt: new Date(now - 23 * HOUR) });
    // Day two: a phone queues a bare `cleared` at the same checkpoint.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        source: "offline",
        clientEventId: "eeeeeeee-3333-4333-8333-eeeeeeeeeeee",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(log).toHaveBeenCalledWith("manifest.offline_retraction_superseded", "warn", {
      shopId: shop.id,
      tripId: reef.id,
    });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("is refused for the crew's own roll call too", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordCrewRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    await expect(
      recordCrewRollCall(db, {
        ...base,
        status: "cleared",
        source: "offline",
        clientEventId: "ffffffff-3333-4333-8333-ffffffffffff",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
        (entry) => entry.id === staff.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("still applies at the dock, where a cleared never reaches back to a missing diver", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
    };
    await recordRollCall(db, {
      ...base,
      status: "not_boarded",
      clientEventId: "abababab-4444-4444-8444-abababababab",
      occurredAt: new Date(now - 90 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        clientEventId: "cdcdcdcd-4444-4444-8444-cdcdcdcdcdcd",
        occurredAt: new Date(now - 80 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
  });
});
