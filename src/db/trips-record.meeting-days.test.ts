import { describe, expect, it } from "vitest";
import { seedRollCallEvidence } from "@/db/seed-roll-call-evidence";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people } from "./schema";
import { createTrip, editTripSection, listStaff, listTripScheduleDays } from "./trips";

/**
 * **A meeting day that already has a roll call stays where it is** (#2557
 * review). Results are filed to a meeting day by when they were taken, so
 * moving or removing a counted day would re-file its count onto another day,
 * or onto none. Refused like a dive count below the recorded history.
 */
const ctx = fileScopedShopContext();

// Saturdays 2031-05-03, 2031-05-10 and 2031-05-17, 09:00 to 13:00 EDT.
const day = (date: string) => ({
  startsAt: new Date(`${date}T13:00:00.000Z`),
  endsAt: new Date(`${date}T17:00:00.000Z`),
});
const SATS = [day("2031-05-03"), day("2031-05-10"), day("2031-05-17")];
const days = (windows: readonly { startsAt: Date; endsAt: Date }[]) =>
  windows.map((window, index) => ({ dayNumber: index + 1, ...window }));
const versionOf = (rows: readonly { id: string; startsAt: Date; endsAt: Date }[]) =>
  JSON.stringify(rows.map((row) => [row.id, row.startsAt.toISOString(), row.endsAt.toISOString()]));

async function course(windows = SATS.slice(0, 2)) {
  const { db, shop } = ctx;
  const trip = await createTrip(db, {
    shopId: shop.id,
    title: "Open Water, Saturdays",
    startsAt: windows[0]?.startsAt ?? SATS[0].startsAt,
    endsAt: windows.at(-1)?.endsAt ?? SATS[0].endsAt,
    capacity: 6,
    scheduleDays: days(windows),
  });
  if (!trip) throw new Error("course not created");
  const [person] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "Ana Ruiz" })
    .returning();
  const [staff] = await listStaff(db, shop.id);
  if (!person || !staff) throw new Error("fixture people missing");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  const countOn = (window: { startsAt: Date }, meetingDay?: number) =>
    seedRollCallEvidence(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      meetingDay,
      occurredAt: new Date(window.startsAt.getTime() - 10 * 60_000),
    });
  const clearOn = (window: { startsAt: Date }, meetingDay: number) =>
    seedRollCallEvidence(
      db,
      {
        shopId: shop.id,
        tripId: trip.id,
        bookingId: booking.id,
        recordedByPersonId: staff.person.id,
        status: "cleared",
        checkpoint: "departure",
        meetingDay,
        occurredAt: new Date(window.startsAt.getTime() - 9 * 60_000),
      },
      { observesPrevious: true },
    );
  const save = async (windows: readonly { startsAt: Date; endsAt: Date }[]) => {
    const current = await listTripScheduleDays(db, shop.id, trip.id);
    return editTripSection(db, shop.id, trip.id, {
      startsAt: windows[0]?.startsAt,
      endsAt: windows.at(-1)?.endsAt,
      scheduleDays: days(windows).map((window, index) => ({
        ...window,
        ...(current[index] ? { id: current[index].id } : {}),
      })),
      expectedScheduleDayIds: current.map((row) => row.id),
      expectedScheduleVersion: versionOf(current),
    });
  };
  const stored = async () =>
    (await listTripScheduleDays(db, shop.id, trip.id)).map((row) => row.startsAt.toISOString());
  return { trip, countOn, clearOn, save, stored };
}

describe("editing the meeting days of a course with a roll call on file", () => {
  it("allows correcting the time of a counted single meeting without replacing its identity", async () => {
    const c = await course([SATS[0]]);
    await c.countOn(SATS[0], 0);
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(await c.save([day("2031-05-04")])).toMatchObject({ ok: true });
    const after = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(after[0].id).toBe(before[0].id);
  });
  it("keeps a meeting with retracted roll-call history attached to that history", async () => {
    const c = await course();
    await c.countOn(SATS[1], 1);
    await c.clearOn(SATS[1], 1);
    expect(await c.save([SATS[0], SATS[2]])).toMatchObject({
      ok: false,
      reason: "meeting_day_has_roll_call",
      detail: { dayNumber: 2 },
    });
  });
  it("refuses to move the explicitly captured day even when the event clock says another day", async () => {
    const c = await course();
    await c.countOn(SATS[0], 1);
    expect(await c.save([SATS[0], SATS[2]])).toMatchObject({
      ok: false,
      reason: "meeting_day_has_roll_call",
      detail: { dayNumber: 2 },
    });
  });
  it("refuses an old request that omits the schedule version", async () => {
    const c = await course();
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(
      await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
        scheduleDays: days(SATS.slice(0, 2)),
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id)).toEqual(before);
  });

  it("refuses a same-window identity swap", async () => {
    const c = await course();
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    const expectedScheduleDayIds = before.map((row) => row.id);
    const scheduleDays = SATS.slice(0, 2).map((window, index) => ({
      ...window,
      dayNumber: index + 1,
      id: before[1 - index].id,
    }));
    expect(
      await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
        expectedScheduleDayIds,
        expectedScheduleVersion: versionOf(before),
        scheduleDays,
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id)).toEqual(before);
  });
  it("keeps explicitly identified meetings when inserting a day", async () => {
    const c = await course();
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(before).toHaveLength(2);
    const scheduleDays = [
      { ...SATS[0], dayNumber: 1, id: before[0].id },
      { ...day("2031-05-06"), dayNumber: 2 },
      { ...SATS[1], dayNumber: 3, id: before[1].id },
    ];
    const expectedScheduleDayIds = before.map((row) => row.id);
    expect(
      await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
        scheduleDays,
        expectedScheduleDayIds,
        expectedScheduleVersion: versionOf(before),
      }),
    ).toMatchObject({
      ok: true,
    });
    const after = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(after.map((row) => row.id)).toEqual([before[0].id, expect.any(String), before[1].id]);
  });

  it("refuses a foreign, stale or duplicate meeting identity without changing the schedule", async () => {
    const c = await course();
    const other = await course();
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    const foreign = await listTripScheduleDays(ctx.db, ctx.shop.id, other.trip.id);
    for (const ids of [
      [foreign[0].id, before[1].id],
      [before[0].id, before[0].id],
      ["00000000-0000-4000-8000-000000000001", before[1].id],
    ]) {
      const scheduleDays = SATS.slice(0, 2).map((window, index) => ({
        ...window,
        dayNumber: index + 1,
        id: ids[index],
      }));
      const expectedScheduleDayIds = before.map((row) => row.id);
      expect(
        await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
          scheduleDays,
          expectedScheduleDayIds,
          expectedScheduleVersion: versionOf(before),
        }),
      ).toMatchObject({ ok: false, reason: "invalid" });
      expect(await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id)).toEqual(before);
    }
  });
  it("refuses a stale editor after another save changes the meeting set", async () => {
    const c = await course();
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    const expectedScheduleDayIds = before.map((row) => row.id);
    const original = SATS.slice(0, 2).map((window, index) => ({
      ...window,
      dayNumber: index + 1,
      id: before[index].id,
    }));
    expect(
      await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
        expectedScheduleDayIds,
        expectedScheduleVersion: versionOf(before),
        scheduleDays: [...original, { ...SATS[2], dayNumber: 3 }],
      }),
    ).toMatchObject({ ok: true });
    const after = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(
      await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
        expectedScheduleDayIds,
        expectedScheduleVersion: versionOf(before),
        scheduleDays: original,
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id)).toEqual(after);
  });
  it("refuses a stale editor when another save changed a window without changing IDs", async () => {
    const c = await course();
    const before = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(await c.save([SATS[0], SATS[2]])).toMatchObject({ ok: true });
    const after = await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id);
    expect(after.map((row) => row.id)).toEqual(before.map((row) => row.id));
    const scheduleDays = before.map((row) => ({
      id: row.id,
      dayNumber: row.dayNumber,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
    }));
    expect(
      await editTripSection(ctx.db, ctx.shop.id, c.trip.id, {
        scheduleDays,
        expectedScheduleDayIds: before.map((row) => row.id),
        expectedScheduleVersion: versionOf(before),
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await listTripScheduleDays(ctx.db, ctx.shop.id, c.trip.id)).toEqual(after);
  });
  it("refuses to move a meeting day that already has a roll call, and keeps the days as they were", async () => {
    const c = await course();
    await c.countOn(SATS[1] as (typeof SATS)[number]);
    const before = await c.stored();
    expect(await c.save([SATS[0], SATS[2]] as typeof SATS)).toMatchObject({
      ok: false,
      reason: "meeting_day_has_roll_call",
      detail: { dayNumber: 2 },
    });
    expect(await c.stored()).toEqual(before);
  });

  it("refuses to remove a meeting day that already has a roll call", async () => {
    const c = await course();
    await c.countOn(SATS[1] as (typeof SATS)[number]);
    expect(await c.save([SATS[0]] as typeof SATS)).toMatchObject({
      ok: false,
      reason: "meeting_day_has_roll_call",
      detail: { dayNumber: 2 },
    });
  });

  it("refuses a new day that would take an earlier day's count as its own", async () => {
    const c = await course();
    await c.countOn(SATS[1] as (typeof SATS)[number]);
    // A day slipped in before the counted one renumbers it.
    expect(await c.save([SATS[0], day("2031-05-06"), SATS[1]] as typeof SATS)).toMatchObject({
      ok: false,
      reason: "meeting_day_has_roll_call",
    });
  });

  it("still moves a day nobody has counted, and adds a day after the counted ones", async () => {
    const c = await course();
    await c.countOn(SATS[0] as (typeof SATS)[number], 0);
    expect(await c.save([SATS[0], SATS[2]] as typeof SATS)).toMatchObject({ ok: true });
    expect(await c.save([SATS[0], SATS[2], day("2031-05-24")] as typeof SATS)).toMatchObject({
      ok: true,
    });
    expect(await c.stored()).toHaveLength(3);
  });
});
