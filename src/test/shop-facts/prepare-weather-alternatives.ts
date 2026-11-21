import type { AppDb } from "../../db/client";
import { createPerson } from "../../db/people";
import { createCertification, reviewCertification } from "../../db/readiness";
import { createTrip, listStaff } from "../../db/trips";
import { seatDiver } from "../../features/bookings/seat-diver";
import { HOUR_MS } from "../../lib/clock";

/** Setup only: the browser still selects and cancels through the ordinary weather workspace. */
export async function prepareWeatherAlternatives(db: AppDb, shopId: string, now: Date) {
  const owner = (await listStaff(db, shopId)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("weather alternative fixture needs a shop owner");
  const startsAt = new Date(now.getTime() + 9 * 24 * HOUR_MS);
  const source = await createTrip(db, {
    shopId,
    title: "Weather alternative source",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * HOUR_MS),
    capacity: 6,
    priceCents: 12000,
  });
  const alternativeStart = new Date(startsAt.getTime() + 24 * HOUR_MS);
  const alternative = await createTrip(db, {
    shopId,
    title: "Weather alternative shore",
    startsAt: alternativeStart,
    endsAt: new Date(alternativeStart.getTime() + 2 * HOUR_MS),
    capacity: 6,
    priceCents: 8000,
    diveMode: "shore",
  });
  if (!source || !alternative) throw new Error("weather alternative departures were refused");
  const diver = await createPerson(db, {
    shopId,
    fullName: "Shore Recovery Diver",
    email: null,
    phone: null,
    origin: "counter",
  });
  const card = await createCertification(db, {
    shopId,
    personId: diver.id,
    agency: "padi",
    level: "open_water",
    identifier: "WEATHER-ALTERNATIVE-OW",
  });
  if (!card) throw new Error("weather alternative fixture card refused");
  const reviewed = await reviewCertification(db, {
    shopId,
    certificationId: card.id,
    status: "verified",
    reviewedByPersonId: owner.person.id,
  });
  if (!reviewed.ok) throw new Error("weather alternative fixture card review refused");
  const booking = await seatDiver(db, {
    shopId,
    tripId: source.id,
    actorPersonId: owner.person.id,
    diver: { personId: diver.id },
    entry: "roster",
    refusals: "specific",
  });
  if (!booking.ok) throw new Error(`weather alternative seat refused: ${booking.reason}`);
  return {
    sourceTripId: source.id,
    alternativeTripId: alternative.id,
    bookingId: booking.bookingId,
    personId: diver.id,
  };
}
