import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DOCTOR_UNLOCK_FAILURE_LIMIT } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { bookings, people, trips, waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import {
  doctorPageOpen,
  getDoctorReferral,
  recordMedicalEvaluation,
  revealDoctorReferral,
} from "./waivers-medical";
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
 * item 17; H-127 and ADR 20261016-doctor-referral-page, amended by the layer
 * r5-3 reviews): the diver's name and whether there are answers to unlock,
 * the answers themselves only for the diver's date of birth, and nothing for a
 * release that is not waiting on one or a departure long over.
 */
describe("getDoctorReferral", () => {
  async function signed(
    medicalAnswers: typeof clearAnswers,
    { dateOfBirth = "1984-03-09" as string | null } = {},
  ) {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    await db.update(people).set({ dateOfBirth }).where(eq(people.id, person.id));
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

  it("carries the name and a locked answers section, never the date of birth or an answer", async () => {
    const { db, person, record } = await signed(medicalReferralAnswers);
    const referral = await getDoctorReferral(db, record);
    expect(referral).toEqual({ fullName: person.fullName, answers: "locked", formSent: false });
    expect(JSON.stringify(referral)).not.toContain("1984");
  });

  it("asks for the whole questionnaire when no date of birth is on file to unlock with", async () => {
    const { db, record } = await signed(medicalReferralAnswers, { dateOfBirth: null });
    expect(await getDoctorReferral(db, record)).toMatchObject({ answers: "whole" });
    expect(await revealDoctorReferral(db, record, "1984-03-09")).toBe("whole");
  });

  it("asks for the whole questionnaire on a paper hold, and says unfinished only for an unfinished form", async () => {
    const { db, record } = await signed(medicalReferralAnswers);
    const paper = { ...record, medicalAnswers: null };
    expect(await getDoctorReferral(db, paper)).toMatchObject({ answers: "whole" });
    const partial: Record<string, boolean> = { ...medicalReferralAnswers.responses };
    delete partial.q5;
    const unfinished = {
      ...record,
      medicalAnswers: { ...medicalReferralAnswers, responses: partial },
    };
    expect(await getDoctorReferral(db, unfinished)).toMatchObject({ answers: "unfinished" });
  });

  it("shows the published prompts and the form they came from only for the diver's date of birth", async () => {
    const { db, record } = await signed(medicalReferralAnswers);
    expect(await revealDoctorReferral(db, record, "1984-03-10")).toBe("mismatch");
    expect(await revealDoctorReferral(db, record, "not a date")).toBe("mismatch");
    const shown = await revealDoctorReferral(db, record, "1984-03-09");
    if (!shown || typeof shown === "string") throw new Error("expected the answers");
    expect(shown.items).toHaveLength(1);
    expect(shown.items[0]?.ref).toEqual({ kind: "question", number: 3 });
    expect(shown.items[0]?.prompt).toContain("exercise");
    expect(shown.form).toMatchObject({ productNumber: "10346 EN", versionDate: "2026-01-01" });
  });

  it("closes once the departure has ended and its grace has passed", async () => {
    const { db, booking, record } = await signed(medicalReferralAnswers);
    const [trip] = await db
      .select({ endsAt: trips.endsAt })
      .from(trips)
      .where(eq(trips.id, booking.tripId));
    if (!trip) throw new Error("trip missing");
    const duringTrip = new Date(trip.endsAt.getTime() - 60_000);
    const dayAfter = new Date(trip.endsAt.getTime() + 25 * 60 * 60 * 1000);
    expect(await doctorPageOpen(db, record, duringTrip)).toBe(true);
    expect(await doctorPageOpen(db, record, dayAfter)).toBe(false);
    expect(await getDoctorReferral(db, record, dayAfter)).toBeNull();
    expect(await revealDoctorReferral(db, record, "1984-03-09", dayAfter)).toBeNull();
  });

  it("closes for a canceled seat or a canceled departure", async () => {
    const { db, booking, record } = await signed(medicalReferralAnswers);
    const [trip] = await db
      .select({ endsAt: trips.endsAt })
      .from(trips)
      .where(eq(trips.id, booking.tripId));
    if (!trip) throw new Error("trip missing");
    const at = new Date(trip.endsAt.getTime() - 60_000);
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, booking.tripId));
    expect(await doctorPageOpen(db, record, at)).toBe(false);
    await db.update(trips).set({ status: "scheduled" }).where(eq(trips.id, booking.tripId));
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(await doctorPageOpen(db, record, at)).toBe(false);
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
      timeZone: shop.timezone,
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

  it("compares no date when there is nothing to unlock (a paper hold)", async () => {
    const { db, record } = await signed(medicalReferralAnswers);
    const paper = { ...record, medicalAnswers: null };
    expect(await revealDoctorReferral(db, paper, "1984-03-09")).toBe("whole");
    expect(await revealDoctorReferral(db, paper, "1990-01-01")).toBe("whole");
    const [after] = await db
      .select({ failures: waiverRecords.doctorUnlockFailures })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, record.id));
    expect(after?.failures).toBe(0);
  });

  it("counts only wrong dates, and locks the answers for the rest of the hold at the ceiling", async () => {
    const { db, record } = await signed(medicalReferralAnswers);
    const fresh = async () => {
      const [row] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
      if (!row) throw new Error("record missing");
      return row;
    };
    // A match spends nothing.
    expect(await revealDoctorReferral(db, await fresh(), "1984-03-09")).not.toBe("mismatch");
    expect((await fresh()).doctorUnlockFailures).toBe(0);
    for (let tries = 1; tries < DOCTOR_UNLOCK_FAILURE_LIMIT; tries++) {
      expect(await revealDoctorReferral(db, await fresh(), "1990-01-01")).toBe("mismatch");
    }
    // The last allowed wrong date locks it, and then even the right date shows nothing.
    expect(await revealDoctorReferral(db, await fresh(), "1990-01-01")).toBe("whole");
    expect((await fresh()).doctorUnlockFailures).toBe(DOCTOR_UNLOCK_FAILURE_LIMIT);
    expect(await revealDoctorReferral(db, await fresh(), "1984-03-09")).toBe("whole");
    expect(await getDoctorReferral(db, await fresh())).toMatchObject({ answers: "whole" });
  });
});
