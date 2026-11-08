import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { log } from "@/lib/log";
import { manifestContext } from "../test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
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
 * **The live undo names the mark it takes back** (issue #3995). It applies
 * only while that mark is the one the manifest shows, so a repeated tap after
 * a same-day undo is refused rather than read as aimed at the carried row, and
 * an undo of the carried row itself reaches its own day.
 */
describe("a live undo across meeting days", () => {
  async function dayOneMissing() {
    const ctx = await twoDayCourse();
    const base = {
      shopId: ctx.shop.id,
      tripId: ctx.reef.id,
      bookingId: ctx.booking.booking.id,
      recordedByPersonId: ctx.staff.id,
      checkpoint: "after_dive_1" as const,
    };
    const dayOne = await recordRollCall(ctx.db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(ctx.now - 23 * HOUR),
    });
    if (!dayOne.ok) throw new Error(dayOne.reason);
    const shown = async () =>
      (await getTripManifest(ctx.db, ctx.shop.id, ctx.reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === ctx.booking.booking.id,
      )?.rollCall;
    return { ...ctx, base, dayOne: dayOne.eventId, shown };
  }

  it("takes the carried row back after day two re-stated the diver and undid that", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    const dayTwo = await recordRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!dayTwo.ok) throw new Error(dayTwo.reason);
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        retractsEventId: dayTwo.eventId,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    // The carried row is back, and says it came over from day one.
    expect(await shown()).toMatchObject({
      state: "not_boarded",
      eventId: dayOne,
      fromEarlierDay: true,
    });
    // A double tap of the same undo is refused: the alarm stays.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        retractsEventId: dayTwo.eventId,
        occurredAt: new Date(now - 45 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "not_boarded", eventId: dayOne });
    // The undo of the carried row names it, and takes it back.
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        retractsEventId: dayOne,
        occurredAt: new Date(now - 40 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await shown()).toBeUndefined();
  });

  it("refuses an undo of the carried row while day two's own mark stands", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    await recordRollCall(db, {
      ...base,
      status: "boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        retractsEventId: dayOne,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "boarded" });
  });

  it("refuses a live undo after a dive that names nothing", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "not_boarded", eventId: dayOne });
  });

  it("refuses an undo naming another diver's mark", async () => {
    const { db, shop, reef, staff, base, now, dayOne } = await dayOneMissing();
    const crewMark = await recordCrewRollCall(db, {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1",
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!crewMark.ok) throw new Error(crewMark.reason);
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        retractsEventId: crewMark.eventId,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    await expect(
      recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        personId: staff.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1",
        status: "cleared",
        retractsEventId: dayOne,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
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
    const shown = async () =>
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
        (entry) => entry.id === staff.id,
      )?.rollCall;
    const dayOne = await recordCrewRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    const dayTwo = await recordCrewRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!dayOne.ok || !dayTwo.ok) throw new Error("crew marks refused");
    for (const [retractsEventId, minutesAgo, outcome] of [
      [dayTwo.eventId, 50, { ok: true }],
      [dayTwo.eventId, 45, { ok: false, reason: "retraction_superseded" }],
    ] as const) {
      await expect(
        recordCrewRollCall(db, {
          ...base,
          status: "cleared",
          retractsEventId,
          occurredAt: new Date(now - minutesAgo * 60 * 1000),
        }),
      ).resolves.toMatchObject(outcome);
    }
    expect(await shown()).toMatchObject({ eventId: dayOne.eventId, fromEarlierDay: true });
    await expect(
      recordCrewRollCall(db, {
        ...base,
        status: "cleared",
        retractsEventId: dayOne.eventId,
        occurredAt: new Date(now - 40 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await shown()).toBeUndefined();
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
    await recordRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
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

  it("treats an empty retractsClientEventId as naming nothing, and refuses it", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_2" as const,
    };
    await recordRollCall(db, {
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    await expect(
      recordRollCall(db, {
        ...base,
        status: "cleared",
        source: "offline",
        clientEventId: "12121212-5555-4555-8555-121212121212",
        retractsClientEventId: "",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_2"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("is refused even when nothing stands at that checkpoint, because it names nothing", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    await expect(
      recordRollCall(db, {
        shopId: shop.id,
        tripId: reef.id,
        bookingId: booking.booking.id,
        recordedByPersonId: staff.id,
        checkpoint: "after_dive_1",
        status: "cleared",
        source: "offline",
        clientEventId: "34343434-5555-4555-8555-343434343434",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 1 * HOUR),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
  });

  it("does not let a replay of the refused event slip through as a duplicate", async () => {
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
      occurredAt: new Date(now - 23 * HOUR),
    });
    const bare = {
      ...base,
      status: "cleared" as const,
      source: "offline" as const,
      clientEventId: "56565656-5555-4555-8555-565656565656",
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
      occurredAt: new Date(now - 1 * HOUR),
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(recordRollCall(db, bare)).resolves.toEqual({
        ok: false,
        reason: "retraction_superseded",
      });
    }
    expect(
      (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
        (diver) => diver.bookingId === booking.booking.id,
      )?.rollCall,
    ).toMatchObject({ state: "not_boarded" });
  });

  it("still applies the crew's own bare cleared at the dock", async () => {
    const { db, shop, reef, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      personId: staff.id,
      recordedByPersonId: staff.id,
      checkpoint: "departure" as const,
      source: "offline" as const,
      offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
    };
    await recordCrewRollCall(db, {
      ...base,
      status: "not_boarded",
      clientEventId: "78787878-6666-4666-8666-787878787878",
      occurredAt: new Date(now - 90 * 60 * 1000),
    });
    await expect(
      recordCrewRollCall(db, {
        ...base,
        status: "cleared",
        clientEventId: "9a9a9a9a-6666-4666-8666-9a9a9a9a9a9a",
        occurredAt: new Date(now - 80 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
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
