import { expect, it } from "vitest";
import { diveIntentTallyAndRetainedSafetyForTrips } from "@/features/dive-intent";
import { getDayCloseout } from "@/features/today";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { retainedSafetyShopWarnings } from "./retained-safety";
import {
  bookings,
  people,
  rollCallEventClaims,
  shops,
  trips,
  unresolvedSafetyScanIncidents,
} from "./schema";

describePostgres("retained safety warnings on PostgreSQL", () => {
  it("decodes existence flags and isolates orphaned incidents by shop", async () => {
    const { db } = await postgresTestDb();
    const [shop, other] = await db
      .insert(shops)
      .values([
        { name: "Safety", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" },
        { name: "Other", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" },
      ])
      .returning();
    expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
      evidence: false,
      alertNeedsReview: false,
    });
    await db.insert(unresolvedSafetyScanIncidents).values({
      outboxId: crypto.randomUUID(),
      generationId: crypto.randomUUID(),
      scanSequence: 1,
      shopId: shop.id,
      tripId: crypto.randomUUID(),
      claimId: crypto.randomUUID(),
    });
    expect(await retainedSafetyShopWarnings(db, shop.id)).toEqual({
      evidence: true,
      alertNeedsReview: true,
    });
    expect(await retainedSafetyShopWarnings(db, other.id)).toEqual({
      evidence: false,
      alertNeedsReview: false,
    });
  });

  it("returns a retained card warning without an intent or seat", async () => {
    const { db } = await postgresTestDb();
    const [shop, other] = await db
      .insert(shops)
      .values([
        { name: "Safety cards", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" },
        { name: "Other cards", slug: `safety-${crypto.randomUUID()}`, timezone: "UTC" },
      ])
      .returning();
    const [trip] = await db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Trip",
        startsAt: new Date("2030-01-01T09:00:00Z"),
        endsAt: new Date("2030-01-01T12:00:00Z"),
        capacity: 8,
      })
      .returning();
    await db.insert(rollCallEventClaims).values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
      retainedSafetyEvidence: {
        version: 1,
        receiptId: crypto.randomUUID(),
        checkpoint: "departure",
        status: "not_boarded",
        occurredAt: "2030-01-01T09:00:00Z",
        meetingDay: null,
        observedEvidenceIds: [],
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        noteRetained: false,
      },
    });
    const result = await diveIntentTallyAndRetainedSafetyForTrips(db, shop.id, [trip.id]);
    expect(result.diveIntents.size).toBe(0);
    expect(result.retainedSafetyTripIds).toEqual(new Set([trip.id]));
    const closeout = await getDayCloseout(db, shop.id, "UTC", new Date("2030-01-01T10:00:00Z"));
    expect(closeout.departures.find((departure) => departure.tripId === trip.id)).toMatchObject({
      retainedSafetyUnresolved: true,
      booked: 0,
    });
    expect(
      (await diveIntentTallyAndRetainedSafetyForTrips(db, other.id, [trip.id]))
        .retainedSafetyTripIds.size,
    ).toBe(0);
    const [person] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Diver" })
      .returning();
    await db.insert(bookings).values({
      shopId: shop.id,
      tripId: trip.id,
      personId: person.id,
      bookedAs: "diver",
      diveIntent: "a_wreck",
    });
    const mixed = await diveIntentTallyAndRetainedSafetyForTrips(db, shop.id, [trip.id]);
    expect(mixed.diveIntents.get(trip.id)).toEqual([{ intent: "a_wreck", count: 1 }]);
    expect(mixed.retainedSafetyTripIds).toEqual(new Set([trip.id]));
  });
});
