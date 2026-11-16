import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { bookings, cards, trips } from "../../db/schema";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../db";
import { prepareWeatherAlternatives } from "./prepare-weather-alternatives";

const context = fileScopedShopContext();
it("prepares one admitted source diver and an empty shore option without canceling or moving", async () => {
  const { db, shop } = context;
  const fact = await prepareWeatherAlternatives(db, shop.id, nowDate());
  const departures = await db
    .select()
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shop.id),
        inArray(trips.id, [fact.sourceTripId, fact.alternativeTripId]),
      ),
    );
  expect(departures).toHaveLength(2);
  expect(departures.find((trip) => trip.id === fact.sourceTripId)).toMatchObject({
    status: "scheduled",
    capacity: 6,
    priceCents: 12000,
    diveMode: "boat",
  });
  expect(departures.find((trip) => trip.id === fact.alternativeTripId)).toMatchObject({
    status: "scheduled",
    capacity: 6,
    priceCents: 8000,
    diveMode: "shore",
  });
  const seats = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.shopId, shop.id),
        inArray(bookings.tripId, [fact.sourceTripId, fact.alternativeTripId]),
      ),
    );
  expect(seats).toHaveLength(1);
  expect(seats[0]).toMatchObject({
    id: fact.bookingId,
    tripId: fact.sourceTripId,
    status: "booked",
    identityUnconfirmedAt: null,
  });
  expect(
    await db
      .select()
      .from(cards)
      .where(and(eq(cards.shopId, shop.id), eq(cards.personId, seats[0].personId))),
  ).toEqual([expect.objectContaining({ level: "open_water", status: "verified" })]);
});
