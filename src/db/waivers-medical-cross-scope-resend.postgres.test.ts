import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { bookings, people, personRoles, shops, trips, waiverRecords } from "./schema";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { saveWaiverTemplate } from "./waivers-templates";
import {
  clearAnswers,
  medicalReferralAnswers,
  recordMedicalEvaluationForShop,
} from "./waivers-test-fixtures";

describePostgres("person-scoped waiver issuance against a physician update", () => {
  it("serializes the resend decision with clearing a booking referral", async () => {
    const pg = await postgresTestDb();
    const suffix = randomBytes(4).toString("hex");
    const [shop] = await pg.db
      .insert(shops)
      .values({ name: `Referral race ${suffix}`, slug: `referral-race-${suffix}`, timezone: "UTC" })
      .returning();
    if (!shop) throw new Error("shop insert returned no row");
    const [person] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Referred Diver" })
      .returning();
    const [owner] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Shop Owner" })
      .returning();
    if (!person || !owner) throw new Error("people insert returned no rows");
    await pg.db.insert(personRoles).values({ personId: owner.id, role: "owner" });

    const signedAt = new Date("2026-07-18T12:00:00.000Z");
    const startsAt = new Date(signedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const [trip] = await pg.db
      .insert(trips)
      .values({
        shopId: shop.id,
        title: "Referral race",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
        capacity: 1,
      })
      .returning();
    if (!trip) throw new Error("trip insert returned no row");
    const [booking] = await pg.db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: trip.id, personId: person.id, bookedAs: "diver" })
      .returning();
    if (!booking) throw new Error("booking insert returned no row");
    await saveWaiverTemplate(pg.db, {
      shopId: shop.id,
      title: "Release",
      body: "I understand diving carries risk and release the shop as the law allows.",
    });

    const first = await issueWaiverRequest(pg.db, {
      shopId: shop.id,
      personId: person.id,
      now: signedAt,
    });
    if (!first.ok) throw new Error("expected an initial person-scoped link");
    await completeWaiver(pg.db, first.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: signedAt,
    });

    const referralAt = new Date(signedAt.getTime() + 60_000);
    const referral = await issueWaiverRequest(pg.db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: referralAt,
    });
    if (!referral.ok) throw new Error("expected a booking-scoped link");
    await completeWaiver(pg.db, referral.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: referralAt,
    });

    // Both person-scoped issuance and physician evaluation lock this referral.
    // Holding it makes Postgres observe both contenders parked on the same row.
    const gate = await holdRowLock(
      pg,
      sql`select id from waiver_records where id = ${referral.recordId} for update`,
    );
    const issueAt = new Date(referralAt.getTime() + 60_000);
    const issue = issueWaiverRequest(pg.connect(), {
      shopId: shop.id,
      personId: person.id,
      now: issueAt,
    });
    const evaluationAt = new Date(issueAt.getTime() + 60_000);
    let evaluation: Promise<Awaited<ReturnType<typeof recordMedicalEvaluationForShop>>> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      evaluation = recordMedicalEvaluationForShop(pg.connect(), {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: owner.id,
        evaluatedOn: "2026-07-18",
        physicianName: "Dr. Imani Reyes",
        now: evaluationAt,
      });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await gate.release();
    }

    if (!evaluation) throw new Error("physician evaluation was not started");
    const [issued, cleared] = await Promise.all([issue, evaluation]);
    expect(cleared).toMatchObject({ ok: true });
    expect(issued.ok || issued.reason === "already_completed").toBe(true);
    const [held] = await pg.db
      .select({ medicalClearedAt: waiverRecords.medicalClearedAt })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, referral.recordId));
    expect(held?.medicalClearedAt).not.toBeNull();
  });
});
