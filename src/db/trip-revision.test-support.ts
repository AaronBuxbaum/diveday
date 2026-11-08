import type { AppDb } from "./client";
import { getTripWithBooked } from "./trips";

export const basePatch = (trip: {
  title: string;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
}) => ({
  title: trip.title,
  startsAt: trip.startsAt,
  endsAt: trip.endsAt,
  capacity: trip.capacity,
  plannedDives: 2,
});

export const revisionOf = async (db: AppDb, shopId: string, tripId: string) =>
  (await getTripWithBooked(db, shopId, tripId))?.revision;
