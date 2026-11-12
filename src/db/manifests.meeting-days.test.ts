import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedRollCallEvidence } from "@/db/seed-roll-call-evidence";
import { fileScopedShopContext } from "@/test/db";
import { departureCounts } from "../features/departure-counts/store";
import {
  getTripManifest,
  listBoardedAtAnyCheckpointByTrip,
  listDepartureRollCallByTrip,
  listUnaccountedForByTrip,
} from "./manifests";
import { bookings, people, tripScheduleDays, trips } from "./schema";
import { listStaff } from "./trips";
import { livePerson } from "./trips-live";

/**
 * **A course's second Saturday starts its count empty** (#2557). Checkpoints
 * are keyed per booking, not per day, so the manifest, the desk's boarded list
 * and Today's boats-out read used to show the first Saturday's taps as the
 * second's: a crew looking at all green would never count anybody. A diver
 * recorded not back aboard on day one is still unaccounted for on day two
 * until counted again.
 */
const ctx = fileScopedShopContext();
const SAT_ONE = {
  startsAt: new Date("2026-08-01T13:00:00Z"),
  endsAt: new Date("2026-08-01T17:00:00Z"),
};
const SAT_TWO = {
  startsAt: new Date("2026-08-15T13:00:00Z"),
  endsAt: new Date("2026-08-15T17:00:00Z"),
};

afterEach(() => vi.unstubAllEnvs());

async function course() {
  const { db, shop } = ctx;
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: shop.id,
      title: "Open Water, two Saturdays",
      startsAt: SAT_ONE.startsAt,
      endsAt: SAT_TWO.endsAt,
      capacity: 6,
      plannedDives: 1,
    })
    .returning();
  if (!trip) throw new Error("trip insert failed");
  await db.insert(tripScheduleDays).values([
    { tripId: trip.id, dayNumber: 1, ...SAT_ONE },
    { tripId: trip.id, dayNumber: 2, ...SAT_TWO },
  ]);
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), livePerson()))
    .limit(1);
  const [staff] = await listStaff(db, shop.id);
  if (!person || !staff) throw new Error("seed people missing");
  const [booking] = await db
    .insert(bookings)
    .values({ bookedAs: "diver", shopId: shop.id, tripId: trip.id, personId: person.id })
    .returning();
  if (!booking) throw new Error("booking insert failed");
  /** Caller declares the selected day; capture time is audit only. Undo names its exact target. */
  const mark = async (
    checkpoint: string,
    status: "boarded" | "not_boarded" | "cleared",
    meetingDay: 0 | 1,
    occurredAt: string,
    retractsEventId?: string,
  ) => {
    const [row] = await seedRollCallEvidence(db, {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status,
      checkpoint,
      meetingDay,
      occurredAt: new Date(occurredAt),
      retractsEventId,
    }).then((rows) => rows.map(({ id }) => ({ id })));
    if (!row) throw new Error("roll call insert failed");
    return row.id;
  };
  return { db, shopId: shop.id, trip, bookingId: booking.id, recorderId: staff.person.id, mark };
}

describe("the roll call a course's manifest shows on its second Saturday", () => {
  it("keeps the first Saturday's record after that day, and starts the second empty", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("departure", "boarded", 0, "2026-08-01T12:45:00Z");
    await mark("after_dive_1", "boarded", 0, "2026-08-01T15:00:00Z");
    const seat = async (checkpoint: "departure" | "after_dive_1") =>
      (await getTripManifest(db, shopId, trip.id, checkpoint))?.divers.find(
        (diver) => diver.bookingId === bookingId,
      )?.rollCall?.state;

    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-02T14:00:00Z");
    expect(await seat("departure")).toBe("boarded");
    expect(await seat("after_dive_1")).toBe("boarded");

    const back = async (now: string) =>
      (await departureCounts(db, shopId, [trip.id], { now: new Date(now) })).get(trip.id)?.back;
    expect(await back("2026-08-02T14:00:00Z")).toBe(1);
    expect(await back("2026-08-15T12:30:00Z")).toBe(0);

    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-15T12:30:00Z");
    expect(await seat("departure")).toBeUndefined();
    expect(await seat("after_dive_1")).toBeUndefined();
    expect((await listDepartureRollCallByTrip(db, shopId, [trip.id])).get(trip.id)).toBeUndefined();
    expect(
      (await listBoardedAtAnyCheckpointByTrip(db, shopId, [trip.id])).get(trip.id),
    ).toBeUndefined();

    await mark("departure", "boarded", 1, "2026-08-15T12:45:00Z");
    expect(await seat("departure")).toBe("boarded");
    expect(await seat("after_dive_1")).toBeUndefined();
  });

  it("still names a diver not back aboard on the first Saturday as unaccounted for", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("departure", "boarded", 0, "2026-08-01T12:45:00Z");
    await mark("after_dive_1", "not_boarded", 0, "2026-08-01T15:00:00Z");
    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-15T18:30:00Z");
    expect(
      (await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)?.has(bookingId),
    ).toBe(true);
  });

  it("keeps a first-Saturday diver not back aboard on the manifest past the cut, until counted or taken back", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("departure", "boarded", 0, "2026-08-01T12:45:00Z");
    const missing = await mark("after_dive_1", "not_boarded", 0, "2026-08-01T15:00:00Z");
    const seat = async (checkpoint: "departure" | "after_dive_1") =>
      (await getTripManifest(db, shopId, trip.id, checkpoint))?.divers.find(
        (diver) => diver.bookingId === bookingId,
      )?.rollCall?.state;
    // Past the halfway cut: the dock count starts empty, the search does not.
    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-10T12:00:00Z");
    expect(await seat("departure")).toBeUndefined();
    expect(await seat("after_dive_1")).toBe("not_boarded");
    // An unnamed undo cannot withdraw the carried report: the alarm stays.
    await mark("after_dive_1", "cleared", 1, "2026-08-10T12:04:00Z");
    expect(await seat("after_dive_1")).toBe("not_boarded");
    // The crew take the mis-tap back from today's manifest, naming the carried row.
    await mark("after_dive_1", "cleared", 1, "2026-08-10T12:05:00Z", missing);
    expect(await seat("after_dive_1")).toBeUndefined();
    expect((await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)).toBeUndefined();
  });

  it("compares dive numbers within a day: day one's back after dive 2 does not account for day two's dive 1", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("after_dive_1", "boarded", 0, "2026-08-01T14:00:00Z");
    await mark("after_dive_2", "boarded", 0, "2026-08-01T16:00:00Z");
    await mark("after_dive_1", "not_boarded", 1, "2026-08-15T14:00:00Z");
    expect(
      (await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)?.has(bookingId),
    ).toBe(true);
  });

  it("lets a second-Saturday count settle a first-Saturday not-back after a later dive", async () => {
    const { db, shopId, trip, mark } = await course();
    await mark("after_dive_2", "not_boarded", 0, "2026-08-01T16:00:00Z");
    await mark("departure", "boarded", 1, "2026-08-15T12:45:00Z");
    await mark("after_dive_1", "boarded", 1, "2026-08-15T14:00:00Z");
    expect((await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)).toBeUndefined();
  });

  it("keeps a first-Saturday not-back after dive 2 through a second-Saturday tap after dive 1 alone (#4056)", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("after_dive_2", "not_boarded", 0, "2026-08-01T16:00:00Z");
    await mark("after_dive_1", "boarded", 1, "2026-08-15T14:00:00Z");
    const unaccounted = async () =>
      (await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)?.has(bookingId);
    expect(await unaccounted()).toBe(true);
    await mark("departure", "boarded", 1, "2026-08-15T14:05:00Z");
    expect(await unaccounted()).toBeUndefined();
  });
});

it("retains a legacy unknown-day missing report despite a known selected-day return and its capture date", async () => {
  const { db, shopId, trip, bookingId, recorderId, mark } = await course();
  await seedRollCallEvidence(db, {
    shopId,
    tripId: trip.id,
    bookingId,
    recordedByPersonId: recorderId,
    checkpoint: "after_dive_1",
    status: "not_boarded",
    occurredAt: new Date("2026-08-01T15:00Z"),
  });
  vi.stubEnv("DIVEDAY_CLOCK", "2026-08-15T14:00Z");
  await mark("departure", "boarded", 1, "1990-01-01T00:00Z");
  const row = (await getTripManifest(db, shopId, trip.id, "after_dive_1"))?.divers.find(
    (item) => item.bookingId === bookingId,
  );
  expect(row?.rollCall).toMatchObject({ state: "not_boarded" });
  expect(row?.rollCallContext?.unknownMeetingDay).toBe(true);
  expect((await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)?.has(bookingId)).toBe(
    true,
  );
});
