import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { advanceClock } from "@/test/clock";
import { fileScopedShopContext } from "@/test/db";
import { listTripReadiness } from "./readiness";
import { shops } from "./schema";
import { listStaff } from "./trips";
import { listSignedWaiversByPerson } from "./waivers-audit";
import { completeWaiver } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  recordMedicalEvaluationForShop,
  waiverContextFor,
} from "./waivers-test-fixtures";

const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

async function staffPerson(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
  const [staff] = await listStaff(db, shopId);
  if (!staff) throw new Error("demo staff missing");
  return staff.person;
}

async function heldContext(signedAt: Date) {
  const context = await waiverContext();
  const { db, shop, booking, person } = context;
  const issued = await issueWaiverRequest(db, {
    shopId: shop.id,
    bookingId: booking.id,
    now: signedAt,
  });
  if (!issued.ok) throw new Error("expected a waiver link");
  await completeWaiver(db, issued.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: medicalReferralAnswers,
    now: signedAt,
  });
  const staff = await staffPerson(db, shop.id);
  return { ...context, staff };
}

describe("medical dates use the shop-local calendar", () => {
  it("keeps a Tokyo referral warning when an earlier clearance is on the prior shop day", async () => {
    const { db, shop, trip, booking, person } = await waiverContext();
    await db.update(shops).set({ timezone: "Asia/Tokyo" }).where(eq(shops.id, shop.id));

    const firstReferralAt = new Date("2026-07-17T12:00:00.000Z");
    const firstLink = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: firstReferralAt,
    });
    if (!firstLink.ok) throw new Error("expected the first waiver link");
    await completeWaiver(db, firstLink.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: firstReferralAt,
    });

    const staff = await staffPerson(db, shop.id);
    const clearedAt = new Date("2026-07-18T11:00:00.000Z");
    expect(
      await recordMedicalEvaluationForShop(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: "2026-07-18",
        physicianName: "Dr. Imani Reyes",
        now: clearedAt,
      }),
    ).toMatchObject({ ok: true });

    // 15:30Z is already July 19 at the Tokyo shop. The July 18 evaluation
    // answered only the earlier disclosure, despite sharing its UTC date.
    const laterReferralAt = new Date("2026-07-18T15:30:00.000Z");
    const laterReferralLink = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: laterReferralAt,
    });
    if (!laterReferralLink.ok) throw new Error("expected a fresh referral link");
    await completeWaiver(db, laterReferralLink.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: laterReferralAt,
    });

    const standingAt = new Date("2026-07-19T16:30:00.000Z");
    const standingLink = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: standingAt,
    });
    if (!standingLink.ok) throw new Error("expected a fresh clean-signing link");
    await completeWaiver(db, standingLink.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: standingAt,
    });

    advanceClock(48 * 60 * 60 * 1000);
    const signed = (await listSignedWaiversByPerson(db, shop.id, [person.id])).get(person.id) ?? [];
    const laterReferral = signed.find(
      (record) => record.signedAt?.getTime() === laterReferralAt.getTime(),
    );
    if (!laterReferral) throw new Error("the later referral was not retained in signed history");
    const row = (await listTripReadiness(db, shop.id, trip.id)).find(
      (candidate) => candidate.booking.id === booking.id,
    );

    expect(row?.overriddenReferral).toMatchObject({
      recordId: laterReferral.id,
      personId: person.id,
    });
  });

  it("accepts the signed day when the shop is behind UTC", async () => {
    const { db, shop, booking, staff } = await heldContext(new Date("2026-07-18T01:00:00.000Z"));
    await db.update(shops).set({ timezone: "America/Los_Angeles" }).where(eq(shops.id, shop.id));

    const outcome = await recordMedicalEvaluationForShop(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-07-17",
      physicianName: "Dr. Imani Reyes",
      now: new Date("2026-07-18T12:00:00.000Z"),
    });

    expect(outcome).toMatchObject({ ok: true, alreadyRecorded: false });
  });

  it("does not accept tomorrow when UTC has rolled over but the shop day has not", async () => {
    const { db, shop, booking, staff } = await heldContext(new Date("2026-07-17T12:00:00.000Z"));
    await db.update(shops).set({ timezone: "America/Los_Angeles" }).where(eq(shops.id, shop.id));

    const outcome = await recordMedicalEvaluationForShop(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-07-18",
      physicianName: "Dr. Imani Reyes",
      now: new Date("2026-07-18T01:00:00.000Z"),
    });

    expect(outcome).toEqual({ ok: false, reason: "evaluation_in_future" });
  });

  it("compares the disclosure date in the shop timezone when the shop is ahead of UTC", async () => {
    const signedAt = new Date("2026-07-18T23:30:00.000Z");
    const { db, shop, booking, staff } = await heldContext(signedAt);
    await db.update(shops).set({ timezone: "Asia/Tokyo" }).where(eq(shops.id, shop.id));

    const outcome = await recordMedicalEvaluationForShop(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-07-18",
      physicianName: "Dr. Imani Reyes",
      now: signedAt,
    });

    expect(outcome).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });
  });

  it("accepts the shop's current day after UTC has not reached it yet", async () => {
    const localToday = new Date("2026-07-18T23:30:00.000Z");
    const { db, shop, booking, staff } = await heldContext(localToday);
    await db.update(shops).set({ timezone: "Asia/Tokyo" }).where(eq(shops.id, shop.id));

    const outcome = await recordMedicalEvaluationForShop(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-07-19",
      physicianName: "Dr. Imani Reyes",
      now: localToday,
    });

    expect(outcome).toMatchObject({ ok: true, alreadyRecorded: false });
  });
});
