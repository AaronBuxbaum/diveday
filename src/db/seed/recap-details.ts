import { and, asc, desc, eq, isNull, lt } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { SAMPLE_PROFILE } from "@/lib/dive-profile-sample";
import type { DbExecutor } from "../client";
import {
  computerDiveProfiles,
  computerDives,
  computerImportBatches,
  executedDives,
  people,
  shops,
  tripAssignments,
  tripRecapPhotos,
  trips,
} from "../schema";
import { liveTrip, notRehearsal } from "../trips-live";

/** Add a little of the crew's closeout to returned demo departures. */
export async function seedRecapDetails(db: DbExecutor, shopId: string, crewId: string) {
  const returned = await db
    .selectDistinct({ id: trips.id, endsAt: trips.endsAt })
    .from(trips)
    .innerJoin(
      executedDives,
      and(eq(executedDives.tripId, trips.id), eq(executedDives.shopId, shopId)),
    )
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        lt(trips.endsAt, nowDate()),
        notRehearsal(),
        liveTrip(),
      ),
    )
    .orderBy(desc(trips.endsAt))
    .limit(6);
  const [shop] = await db
    .select({ timezone: shops.timezone })
    .from(shops)
    .where(eq(shops.id, shopId))
    .limit(1);
  if (!shop) return;
  const notes = [
    "A lovely morning on the reef. Thanks for sharing it with us!",
    "Good visibility and plenty of life along the reef today. See you on the next one!",
    "A relaxed day on the water with a great group. Thanks for diving with us.",
  ];
  for (const [index, trip] of returned.entries()) {
    await db
      .update(trips)
      .set({ recapShoutout: notes[index % notes.length] })
      .where(and(eq(trips.shopId, shopId), eq(trips.id, trip.id), isNull(trips.recapShoutout)));
    await db
      .update(executedDives)
      .set({
        observedConditions: {
          visibility: index % 2 ? "50–60 ft" : "60–80 ft",
          current: index % 2 ? "Light" : "Mild",
        },
      })
      .where(and(eq(executedDives.shopId, shopId), eq(executedDives.tripId, trip.id)));
    const sightings = [
      ["green-sea-turtle", "blue-tang", "southern-stingray"],
      ["nurse-shark", "green-moray", "goliath-grouper"],
      ["blue-tang", "green-sea-turtle", "nurse-shark"],
    ][index % 3];
    await db
      .update(executedDives)
      .set({ observedSpeciesEntries: sightings.map((slug) => ({ slug, name: null })) })
      .where(and(eq(executedDives.shopId, shopId), eq(executedDives.tripId, trip.id)));
    const [member] = await db
      .select({ personId: tripAssignments.personId })
      .from(tripAssignments)
      .innerJoin(people, eq(people.id, tripAssignments.personId))
      .where(eq(tripAssignments.tripId, trip.id))
      .orderBy(asc(tripAssignments.tripRole), asc(people.fullName))
      .limit(1);
    const photos = ["crew-boat.webp", "crew-rinse.webp", "crew-reef.webp"];
    if (index < photos.length) {
      const imageUrl = `/demo-recaps/${photos[index]}`;
      const [existing] = await db
        .select({ id: tripRecapPhotos.id })
        .from(tripRecapPhotos)
        .where(
          and(
            eq(tripRecapPhotos.shopId, shopId),
            eq(tripRecapPhotos.tripId, trip.id),
            eq(tripRecapPhotos.imageUrl, imageUrl),
          ),
        )
        .limit(1);
      if (!existing)
        await db.insert(tripRecapPhotos).values({
          shopId,
          tripId: trip.id,
          uploadedByPersonId: member?.personId ?? crewId,
          imageUrl,
          createdAt: trip.endsAt,
        });
    }
    if (!member) continue;
    const dives = await db
      .select()
      .from(executedDives)
      .where(
        and(
          eq(executedDives.shopId, shopId),
          eq(executedDives.tripId, trip.id),
          isNull(executedDives.deletedAt),
        ),
      );
    for (const dive of dives) {
      if (!dive.enteredAt || !dive.exitedAt || !dive.maxDepthMeters) continue;
      const key = `demo-watch-${dive.id}`;
      const [batch] = await db
        .insert(computerImportBatches)
        .values({
          shopId,
          personId: member.personId,
          requestKey: key,
          selectionHash: key,
          importedCount: 1,
          skippedCount: 0,
        })
        .onConflictDoNothing()
        .returning();
      if (!batch) continue;
      const maxDepth = dive.maxDepthMeters;
      const duration = Math.round((dive.exitedAt.getTime() - dive.enteredAt.getTime()) / 1000);
      const profileDuration = SAMPLE_PROFILE.at(-1)?.seconds ?? 1;
      const profileDepth = Math.max(...SAMPLE_PROFILE.map((sample) => sample.meters));
      const samples = SAMPLE_PROFILE.map((sample) => ({
        seconds: Math.round((sample.seconds * duration) / profileDuration),
        depthMeters: Math.round(((sample.meters * maxDepth) / profileDepth) * 10) / 10,
        temperatureC: sample.meters > 12 ? 26 : 28,
      }));
      const [watch] = await db
        .insert(computerDives)
        .values({
          shopId,
          personId: member.personId,
          batchId: batch.id,
          fingerprint: key,
          record: {
            sourceFormat: "uddf",
            sourceId: key,
            device: "Shearwater Perdix",
            localDate: calendarDateInTimezone(dive.enteredAt, shop.timezone),
            localStart: null,
            startInstant: dive.enteredAt.toISOString(),
            offsetMinutes: null,
            durationSeconds: duration,
            maxDepthMeters: dive.maxDepthMeters,
            gases: [],
            tanks: [],
            warnings: [],
            sourceUnits: { depth: "m", temperature: "C", pressure: null },
          },
        })
        .returning();
      if (watch)
        await db
          .insert(computerDiveProfiles)
          .values({ shopId, personId: member.personId, diveId: watch.id, samples });
    }
  }
}
