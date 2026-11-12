import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import { log } from "@/lib/log";
import { manifestContext } from "../test/substrate-fixtures/db/manifests-test-fixtures";
import { getTripManifest, recordCrewRollCall, recordRollCall } from "./manifests";
import { rollCallEvents, tripAssignments, tripScheduleDays } from "./schema";

vi.mock("@/lib/log", () => ({ log: vi.fn() }));

/**
 * **Causal evidence is scoped to the explicitly selected meeting day** (issue #3905,
 * ADR 20261104-roll-call-by-meeting-day). A checkpoint such as `after_dive_1`
 * repeats on every day of a course. Saturday's queued mark stays on Saturday;
 * opposing unknown-order statements on Sunday are retained as a conflict.
 *
 * Two meeting days: day one ended 22 hours ago, day two began 2 hours ago, so
 * the roll-call boundary between them sits 12 hours ago.
 */
const HOUR = 60 * 60 * 1000;

async function shownContext(
  db: Parameters<typeof getTripManifest>[0],
  shopId: string,
  tripId: string,
  bookingId: string,
) {
  const context = (await getTripManifest(db, shopId, tripId, "after_dive_1"))?.divers.find(
    (row) => row.bookingId === bookingId,
  )?.rollCallContext;
  if (!context) throw new Error("expected displayed diver context");
  return context;
}

async function shownCrewContext(
  db: Parameters<typeof getTripManifest>[0],
  shopId: string,
  tripId: string,
  personId: string,
) {
  const context = (await getTripManifest(db, shopId, tripId, "after_dive_1"))?.crew.find(
    (row) => row.id === personId,
  )?.rollCallContext;
  if (!context) throw new Error("expected displayed crew context");
  return context;
}

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
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 1 * HOUR),
    });
    // Saturday's tap, queued offline, synced now.
    await expect(
      recordRollCall(db, {
        meetingDay: 0,
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
        offlineSnapshotSavedAt: new Date(now - 25 * HOUR),
        occurredAt: new Date(now - 23 * HOUR),
      }),
    ).resolves.toMatchObject({ ok: true });
    const row = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
      (item) => item.bookingId === booking.booking.id,
    );
    expect(row?.rollCall).toMatchObject({ state: "not_boarded" });
    expect(row?.rollCallContext?.conflict).toBe(false);
    expect(
      (await db.select().from(rollCallEvents))
        .filter((item) => item.tripId === reef.id)
        .map((item) => item.meetingDay)
        .sort(),
    ).toEqual([0, 1]);
  });

  it("retains an older unknown-order offline mark beside opposing evidence on the same selected day", async () => {
    const { db, shop, reef, booking, staff, now } = await twoDayCourse();
    const base = {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: booking.booking.id,
      recordedByPersonId: staff.id,
      checkpoint: "after_dive_1" as const,
    };
    await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 30 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 90 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    const row = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.divers.find(
      (item) => item.bookingId === booking.booking.id,
    );
    expect(row?.rollCall).toMatchObject({ state: "not_boarded", evidenceConflict: true });
    expect(row?.rollCallContext).toMatchObject({ orderingUnknown: true });
    expect(row?.rollCallContext?.evidence).toHaveLength(2);
    expect(
      (await db.select().from(rollCallEvents))
        .filter((item) => item.tripId === reef.id)
        .map((item) => item.statementStatus)
        .sort(),
    ).toEqual(["boarded", "not_boarded"]);
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
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 1 * HOUR),
    });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 0,
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
        meetingDay: 1,
        ...base,
        status: "boarded",
        source: "offline",
        clientEventId: "dddddddd-2222-4222-8222-dddddddddddd",
        offlineSnapshotSavedAt: new Date(now - 2 * HOUR),
        occurredAt: new Date(now - 90 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    const row = (await getTripManifest(db, shop.id, reef.id, "after_dive_1"))?.crew.find(
      (item) => item.id === staff.id,
    );
    expect(row?.rollCall).toMatchObject({ state: "not_boarded", evidenceConflict: true });
    expect(row?.rollCallContext).toMatchObject({ orderingUnknown: true });
    expect(row?.rollCallContext?.evidence).toHaveLength(2);
    expect(
      (await db.select().from(rollCallEvents))
        .filter((item) => item.tripId === reef.id)
        .map((item) => item.meetingDay)
        .sort(),
    ).toEqual([0, 1, 1]);
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
      meetingDay: 0,
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
    // Independent day-two restatement: it never observed day one's report.
    const dayTwo = await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!dayTwo.ok) throw new Error(dayTwo.reason);
    const beforeUndo = await shownContext(db, base.shopId, base.tripId, base.bookingId);
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayTwo.eventId,
        observedEvidenceIds: beforeUndo?.observedEvidenceIds,
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
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayTwo.eventId,
        occurredAt: new Date(now - 45 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    expect(await shown()).toMatchObject({ state: "not_boarded", eventId: dayOne });
    // The undo of the carried row names it, and takes it back.
    const carried = await shownContext(db, base.shopId, base.tripId, base.bookingId);
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: dayOne,
        observedEvidenceIds: carried?.observedEvidenceIds,
        occurredAt: new Date(now - 40 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await shown()).toBeUndefined();
  });

  it("refuses an undo of the carried row while day two's own mark stands", async () => {
    const { db, base, now, dayOne, shown } = await dayOneMissing();
    const before = await shownContext(db, base.shopId, base.tripId, base.bookingId);
    await recordRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "boarded",
      observedEvidenceIds: before?.observedEvidenceIds,
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
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
        meetingDay: 1,
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
      meetingDay: 1,
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
        meetingDay: 1,
        ...base,
        status: "cleared",
        retractsEventId: crewMark.eventId,
        occurredAt: new Date(now - 50 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, reason: "retraction_superseded" });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
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
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    const dayTwo = await recordCrewRollCall(db, {
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 60 * 60 * 1000),
    });
    if (!dayOne.ok || !dayTwo.ok) throw new Error("crew marks refused");
    for (const [retractsEventId, minutesAgo, outcome] of [
      [dayTwo.eventId, 50, { ok: true }],
      [dayTwo.eventId, 45, { ok: false, reason: "retraction_superseded" }],
    ] as const) {
      const beforeUndo = await shownCrewContext(db, shop.id, reef.id, staff.id);
      await expect(
        recordCrewRollCall(db, {
          meetingDay: 1,
          ...base,
          status: "cleared",
          retractsEventId,
          observedEvidenceIds: beforeUndo?.observedEvidenceIds,
          occurredAt: new Date(now - minutesAgo * 60 * 1000),
        }),
      ).resolves.toMatchObject(outcome);
    }
    expect(await shown()).toMatchObject({ eventId: dayOne.eventId, fromEarlierDay: true });
    const carried = await shownCrewContext(db, shop.id, reef.id, staff.id);
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        observedEvidenceIds: carried.observedEvidenceIds,
        retractsEventId: dayOne.eventId,
        occurredAt: new Date(now - 40 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(await shown()).toBeUndefined();
  });
});

/**
 * An unnamed offline undo supplies no target proof, including when a selected
 * later meeting day is declared. It cannot erase a carried missing report.
 * Retain the legacy absent-basis controls and their refusal/log assertions.
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
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    // Day two: a phone queues a bare `cleared` at the same checkpoint.
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
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
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
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
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
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
        meetingDay: 1,
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
      meetingDay: 0,
      ...base,
      status: "not_boarded",
      occurredAt: new Date(now - 23 * HOUR),
    });
    const bare = {
      ...base,
      status: "cleared" as const,
      meetingDay: 1,
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
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      clientEventId: "78787878-6666-4666-8666-787878787878",
      occurredAt: new Date(now - 90 * 60 * 1000),
    });
    await expect(
      recordCrewRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        clientEventId: "9a9a9a9a-6666-4666-8666-9a9a9a9a9a9a",
        occurredAt: new Date(now - 80 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "departure"))?.crew.find(
        (item) => item.id === staff.id,
      )?.rollCall,
    ).toBeUndefined();
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
      meetingDay: 1,
      ...base,
      status: "not_boarded",
      clientEventId: "abababab-4444-4444-8444-abababababab",
      occurredAt: new Date(now - 90 * 60 * 1000),
    });
    await expect(
      recordRollCall(db, {
        meetingDay: 1,
        ...base,
        status: "cleared",
        clientEventId: "cdcdcdcd-4444-4444-8444-cdcdcdcdcdcd",
        occurredAt: new Date(now - 80 * 60 * 1000),
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(
      (await getTripManifest(db, shop.id, reef.id, "departure"))?.divers.find(
        (item) => item.bookingId === booking.booking.id,
      )?.rollCall,
    ).toBeUndefined();
  });
});
