import { and, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { bookings, people, trips, waiverRecords } from "./schema";
import { HELD_DIVER_WAIVER_IDS, seedMedicalReview } from "./seed-medical-review";

// The scenario's fixture names, as seedMedicalReview writes them.
const DEMO_MEDICAL_REVIEW_DIVER = "Morgan Vale";
const DEMO_MEDICAL_REVIEW_TRIP = "Afternoon Two-Tank — French Reef";

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

    // Re-running the scenario names the same reviewer it would have the first
    // time; who that is does not matter to this test, only that it is a real
    // staff row the foreign key accepts.
    await seedMedicalReview(db, shop.id, template, tripRows, fixturePerson.id);

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

/**
 * The flake this scenario caused, pinned so it cannot come back.
 *
 * Both held divers sign at `at(-1, 10)` — the same instant, deliberately. The
 * signature log orders by `signedAt` then `id`, so with `defaultRandom()` ids
 * the two rows swapped on every re-seed, and `staff-waivers`,
 * `staff-waivers-record` and `waiver-materiality-choice` reported 8 changed
 * captures on pull requests that touched no rendering code (#1376). Nothing
 * failed: a visual difference never fails the build, so this cost a reviewer's
 * attention on every unrelated branch instead.
 *
 * The first assertion is the fix; the second is what makes it necessary, and
 * will start failing if somebody gives these divers distinct times — at which
 * point the pinned ids are no longer load-bearing and this test should say so
 * rather than be deleted quietly.
 */
describe("the held divers' waiver rows sort deterministically", () => {
  it("pins an id on every record that ties with another on signedAt", async () => {
    const { db, shop } = await seededShopContext();
    const rows = await db
      .select({ id: waiverRecords.id, signedAt: waiverRecords.signedAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.shopId, shop.id));

    const byInstant = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.signedAt) continue;
      const key = row.signedAt.toISOString();
      byInstant.set(key, [...(byInstant.get(key) ?? []), row.id]);
    }

    // Every group of records sharing one instant is ordered by id alone, so
    // every id in it has to be one the seed chose rather than one Postgres did.
    const pinned = new Set<string>(Object.values(HELD_DIVER_WAIVER_IDS));
    for (const [instant, ids] of byInstant) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        expect(
          pinned.has(id),
          `waiver record ${id} ties with ${ids.length - 1} other(s) at ${instant} but carries a random id, so the signature log's order flips on every re-seed`,
        ).toBe(true);
      }
    }
  });

  it("still seeds the two held divers at the same instant", async () => {
    const { db, shop } = await seededShopContext();
    const held = await db
      .select({ signedAt: waiverRecords.signedAt })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          inArray(waiverRecords.id, Object.values(HELD_DIVER_WAIVER_IDS)),
        ),
      );
    expect(held).toHaveLength(2);
    expect(held[0]?.signedAt?.toISOString()).toBe(held[1]?.signedAt?.toISOString());
  });
});
