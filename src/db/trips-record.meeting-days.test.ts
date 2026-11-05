import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people, rollCallEvents } from "./schema";
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
  const countOn = (window: { startsAt: Date }) =>
    db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
      checkpoint: "departure",
      occurredAt: new Date(window.startsAt.getTime() - 10 * 60_000),
    });
  const save = (windows: readonly { startsAt: Date; endsAt: Date }[]) =>
    editTripSection(db, shop.id, trip.id, {
      startsAt: windows[0]?.startsAt,
      endsAt: windows.at(-1)?.endsAt,
      scheduleDays: days(windows),
    });
  const stored = async () =>
    (await listTripScheduleDays(db, shop.id, trip.id)).map((row) => row.startsAt.toISOString());
  return { trip, countOn, save, stored };
}

describe("editing the meeting days of a course with a roll call on file", () => {
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
    await c.countOn(SATS[0] as (typeof SATS)[number]);
    expect(await c.save([SATS[0], SATS[2]] as typeof SATS)).toMatchObject({ ok: true });
    expect(await c.save([SATS[0], SATS[2], day("2031-05-24")] as typeof SATS)).toMatchObject({
      ok: true,
    });
    expect(await c.stored()).toHaveLength(3);
  });
});
