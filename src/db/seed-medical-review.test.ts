import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { bookings, people, trips, waiverRecords } from "./schema";
import {
  DEMO_MEDICAL_REVIEW_DIVER,
  DEMO_MEDICAL_REVIEW_TRIP,
  seedMedicalReview,
} from "./seed-medical-review";
import { getCurrentWaiverTemplate } from "./waivers";

describe("seeded medical-review training scenario", () => {
  it("blocks one synthetic, future-trip diver without storing medical answers", async () => {
    const { db, shop } = await seededShopContext();
    const [fixture] = await db
      .select({
        personName: people.fullName,
        tripTitle: trips.title,
        startsAt: trips.startsAt,
        status: waiverRecords.status,
        medicalReviewRequired: waiverRecords.medicalReviewRequired,
        medicalAnswers: waiverRecords.medicalAnswers,
        draftMedicalAnswers: waiverRecords.draftMedicalAnswers,
      })
      .from(waiverRecords)
      .innerJoin(people, eq(people.id, waiverRecords.personId))
      .innerJoin(bookings, eq(bookings.id, waiverRecords.bookingId))
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(eq(waiverRecords.shopId, shop.id), eq(people.fullName, DEMO_MEDICAL_REVIEW_DIVER)),
      );

    expect(fixture).toMatchObject({
      personName: DEMO_MEDICAL_REVIEW_DIVER,
      tripTitle: DEMO_MEDICAL_REVIEW_TRIP,
      status: "medical_review",
      medicalReviewRequired: true,
      medicalAnswers: null,
      draftMedicalAnswers: null,
    });
    expect(fixture?.startsAt.getTime()).toBeGreaterThan(nowMs());
  });

  it("repairs a partial scenario without duplicating its person or booking", async () => {
    const { db, shop } = await seededShopContext();
    const template = await getCurrentWaiverTemplate(db, shop.id);
    const tripRows = await db.select().from(trips).where(eq(trips.shopId, shop.id));
    if (!template) throw new Error("test fixture waiver template missing");

    const [fixturePerson] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, DEMO_MEDICAL_REVIEW_DIVER)));
    if (!fixturePerson) throw new Error("test fixture medical-review diver missing");
    await db
      .delete(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.personId, fixturePerson.id)));

    await seedMedicalReview(db, shop.id, template, tripRows);

    const peopleRows = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), eq(people.fullName, DEMO_MEDICAL_REVIEW_DIVER)));
    const bookingRows = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.shopId, shop.id), eq(bookings.personId, fixturePerson.id)));
    const waiverRows = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(and(eq(waiverRecords.shopId, shop.id), eq(waiverRecords.personId, fixturePerson.id)));
    expect(peopleRows).toHaveLength(1);
    expect(bookingRows).toHaveLength(1);
    expect(waiverRows).toHaveLength(1);
  });
});
