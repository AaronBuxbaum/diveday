import { expect, it } from "vitest";
import { createBooking } from "@/db/bookings";
import { createTrip } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { getTripPersonClashes } from "./store";

const ctx = fileScopedShopContext();

it("reviews collisions on every leg, including one after the first day", async () => {
  const { db, shop } = ctx;
  const course = await createTrip(db, {
    shopId: shop.id,
    title: "Two days",
    capacity: 8,
    startsAt: new Date("2035-08-04T08:00:00Z"),
    endsAt: new Date("2035-08-05T10:00:00Z"),
    scheduleDays: [
      {
        dayNumber: 1,
        startsAt: new Date("2035-08-04T08:00:00Z"),
        endsAt: new Date("2035-08-04T10:00:00Z"),
      },
      {
        dayNumber: 2,
        startsAt: new Date("2035-08-05T08:00:00Z"),
        endsAt: new Date("2035-08-05T10:00:00Z"),
      },
    ],
  });
  const other = await createTrip(db, {
    shopId: shop.id,
    title: "Later departure",
    startsAt: new Date("2035-08-05T09:00:00Z"),
    endsAt: new Date("2035-08-05T11:00:00Z"),
    capacity: 8,
  });
  if (!course || !other) throw new Error("expected departures");
  const person = await createBooking(db, {
    shopId: shop.id,
    tripId: course.id,
    actor: "staff",
    fullName: "Test Diver",
    email: "all-legs@example.test",
  });
  if (!person.ok) throw new Error(person.reason);
  const seat = await createBooking(db, {
    shopId: shop.id,
    tripId: other.id,
    actor: "staff",
    personId: person.personId,
  });
  if (!seat.ok) throw new Error(seat.reason);
  expect(await getTripPersonClashes(db, shop.id, course.id)).toEqual([
    expect.objectContaining({ personName: "Test Diver", otherTitle: "Later departure" }),
  ]);
  expect(await getTripPersonClashes(db, "00000000-0000-4000-8000-000000000099", course.id)).toEqual(
    [],
  );
});
