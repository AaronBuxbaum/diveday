import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { departureCounts } from "./departure-counts";
import {
  getTripManifest,
  listBoardedAtAnyCheckpointByTrip,
  listDepartureRollCallByTrip,
  listUnaccountedForByTrip,
} from "./manifests";
import { bookings, people, rollCallEvents, tripScheduleDays, trips } from "./schema";
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
  const mark = (checkpoint: string, status: "boarded" | "not_boarded", occurredAt: string) =>
    db.insert(rollCallEvents).values({
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
      status,
      checkpoint,
      occurredAt: new Date(occurredAt),
    });
  return { db, shopId: shop.id, trip, bookingId: booking.id, mark };
}

describe("the roll call a course's manifest shows on its second Saturday", () => {
  it("keeps the first Saturday's record after that day, and starts the second empty", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("departure", "boarded", "2026-08-01T12:45:00Z");
    await mark("after_dive_1", "boarded", "2026-08-01T15:00:00Z");
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

    await mark("departure", "boarded", "2026-08-15T12:45:00Z");
    expect(await seat("departure")).toBe("boarded");
    expect(await seat("after_dive_1")).toBeUndefined();
  });

  it("still names a diver not back aboard on the first Saturday as unaccounted for", async () => {
    const { db, shopId, trip, bookingId, mark } = await course();
    await mark("departure", "boarded", "2026-08-01T12:45:00Z");
    await mark("after_dive_1", "not_boarded", "2026-08-01T15:00:00Z");
    vi.stubEnv("DIVEDAY_CLOCK", "2026-08-15T18:30:00Z");
    expect(
      (await listUnaccountedForByTrip(db, shopId, [trip.id])).get(trip.id)?.has(bookingId),
    ).toBe(true);
  });
});
