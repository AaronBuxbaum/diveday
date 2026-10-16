import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { people, waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { getDoctorReferral, recordMedicalEvaluation } from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

/**
 * **What the doctor's page reads off a held release** (fifth-loop ideas,
 * item 17; H-127, ADR 20261016-doctor-referral-page): the diver's name, their
 * date of birth and the numbers of the answers that call for a physician, and
 * nothing for a release that is not waiting on one.
 */
describe("getDoctorReferral", () => {
  async function signed(medicalAnswers: typeof clearAnswers) {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    await db.update(people).set({ dateOfBirth: "1984-03-09" }).where(eq(people.id, person.id));
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers,
      now,
    });
    const state = await getWaiverForToken(db, issued.token, now);
    if (state.state !== "completed") throw new Error("expected a completed record");
    return { ...context, record: state.record };
  }

  it("carries the name, the date of birth and the question numbers, not the answers", async () => {
    const { db, person, record } = await signed(medicalReferralAnswers);
    const referral = await getDoctorReferral(db, record);
    expect(referral).toEqual({
      fullName: person.fullName,
      dateOfBirth: "1984-03-09",
      refs: [{ kind: "question", number: 3 }],
    });
    expect(JSON.stringify(referral)).not.toContain("exercise");
  });

  it("has nothing for a clean release", async () => {
    const { db, record } = await signed(clearAnswers);
    expect(await getDoctorReferral(db, record)).toBeNull();
  });

  it("has nothing once a physician's answer is recorded, either way", async () => {
    const { db, shop, booking, record } = await signed(medicalReferralAnswers);
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    const answered = await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.person.id,
      evaluatedOn: "2026-07-18",
      physicianName: "Dr. Imani Reyes",
      now: new Date(now.getTime() + 60_000),
    });
    expect(answered).toMatchObject({ ok: true });
    const [after] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    if (!after) throw new Error("record missing");
    expect(await getDoctorReferral(db, after)).toBeNull();
  });

  it("has nothing for a removed diver", async () => {
    const { db, person, record } = await signed(medicalReferralAnswers);
    await db.update(people).set({ deletedAt: now }).where(eq(people.id, person.id));
    expect(await getDoctorReferral(db, record)).toBeNull();
  });
});
