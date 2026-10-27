import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { describePostgres, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { recordRollCall } from "./manifests";
import { certifications, people, rollCallEvents } from "./schema";
import { seedDemo } from "./seed";
import { getShopBySlug } from "./shops";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

describePostgres("boarding certification capture and concurrent erasure", () => {
  it("does not capture a reviewer's erased name when the boarding waits for their erasure", async () => {
    const pg = await postgresTestDb();
    await seedDemo(pg.db);
    const shop = await getShopBySlug(pg.db, "blue-mantis");
    if (!shop) throw new Error("shop missing");
    const reef = (await upcomingTripsWithCounts(pg.db, shop.id, new Date(0))).find((trip) =>
      trip.title.startsWith("Two-Tank Reef — Molasses"),
    );
    if (!reef) throw new Error("trip missing");
    const [seat] = await getTripRoster(pg.db, shop.id, reef.id);
    const [staff] = await listStaff(pg.db, shop.id);
    if (!seat || !staff) throw new Error("seat or staff missing");
    const [reviewer] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Old name" })
      .returning();
    if (!reviewer) throw new Error("reviewer missing");
    await pg.db.insert(certifications).values({
      shopId: shop.id,
      personId: seat.person.id,
      agency: "padi",
      level: "rescue",
      identifier: "RACE-CARD",
      status: "verified",
      reviewedAt: nowDate(),
      reviewedByPersonId: reviewer.id,
    });
    const issued = await issueWaiverRequest(pg.db, { shopId: shop.id, bookingId: seat.booking.id });
    if (!issued.ok) throw new Error("waiver missing");
    await completeWaiver(pg.db, issued.token, {
      signerName: seat.person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
    });
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const erasure = pg.connect().transaction(async (tx) => {
      await tx
        .update(people)
        .set({ fullName: "Erased", deletedAt: nowDate(), anonymizedAt: nowDate() })
        .where(eq(people.id, reviewer.id));
      locked();
      await hold;
    });
    await Promise.race([acquired, erasure]);
    const boarding = recordRollCall(pg.connect(), {
      shopId: shop.id,
      tripId: reef.id,
      bookingId: seat.booking.id,
      recordedByPersonId: staff.person.id,
      status: "boarded",
    });
    try {
      await waitForLockWaiters(pg.db, 1);
    } finally {
      release();
      await erasure;
    }
    const outcome = await boarding;
    expect(outcome).toMatchObject({ ok: true });
    if (!outcome.ok) throw new Error("boarding refused");
    const [event] = await pg.db
      .select()
      .from(rollCallEvents)
      .where(
        and(eq(rollCallEvents.shopId, shop.id), eq(rollCallEvents.id, outcome.eventId)),
      );
    expect(
      event?.certificationSnapshot?.find((card) => card.identifier === "RACE-CARD"),
    ).toMatchObject({ reviewedByPersonId: null, reviewedByName: null });
  });
});
