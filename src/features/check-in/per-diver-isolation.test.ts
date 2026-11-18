import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { standingArrivalStatus } from "../../db/arrival-provenance";
import { bookingArrivalEvents } from "../../db/schema";
import { getTripRoster, listStaff } from "../../db/trips";
import { upcomingTripsWithCounts } from "../../db/trips-queries.test-support";
import { fileScopedShopContext } from "../../test/db";
import { checkInBooking, listCheckInQueue } from "./store";

const ctx = fileScopedShopContext();

it("checks in only the ready diver without clearing another diver on the trip", async () => {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  const [seat] = await getTripRoster(db, shop.id, reef.id);
  if (!staff || !seat) throw new Error("seeded staff or booking missing");
  const before = await listCheckInQueue(db, shop.id, { tripId: reef.id });
  const blocked = before.find((row) => row.bookingId === seat.booking.id);
  const ready = before.find(
    (row) => row.bookingId !== seat.booking.id && row.readiness.status === "ready",
  );
  if (!ready || !blocked) throw new Error("ready and blocked divers on the trip are required");
  expect(blocked.readiness.status).toBe("blocked");
  const arrivalBefore = await standingArrivalStatus(db, shop.id, reef.id, blocked.bookingId);
  const eventsBefore = await db
    .select()
    .from(bookingArrivalEvents)
    .where(eq(bookingArrivalEvents.bookingId, blocked.bookingId));

  await expect(
    checkInBooking(db, {
      shopId: shop.id,
      bookingId: ready.bookingId,
      recordedByPersonId: staff.person.id,
    }),
  ).resolves.toMatchObject({ ok: true, bookingId: ready.bookingId });
  expect(await standingArrivalStatus(db, shop.id, reef.id, ready.bookingId)).toBe("arrived");

  const after = await listCheckInQueue(db, shop.id, { tripId: reef.id });
  expect(after.find((row) => row.bookingId === blocked.bookingId)?.readiness).toEqual(
    blocked.readiness,
  );
  expect(await standingArrivalStatus(db, shop.id, reef.id, blocked.bookingId)).toEqual(
    arrivalBefore,
  );
  expect(
    await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, blocked.bookingId)),
  ).toEqual(eventsBefore);
  await expect(
    checkInBooking(db, {
      shopId: shop.id,
      bookingId: blocked.bookingId,
      recordedByPersonId: staff.person.id,
    }),
  ).resolves.toMatchObject({ ok: false, reason: "not_ready", tripId: reef.id });
});
