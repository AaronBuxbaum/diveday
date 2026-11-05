import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { recordCrewRollCall, recordRollCall } from "./manifests";
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
