import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { completeWaiver } from "./waivers-completion";
import { recordMedicalEvaluation } from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";
import { clearAnswers, now, waiverContextFor } from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

/**
 * **A physician's letter for an earlier referral, and the re-signed one**
 * (issue #2616). The diver signs in March and answers yes to a heart question, a
 * physician clears them in April, the shop never records it, the terms change
 * and they re-sign the same "yes" in June, and the desk is handed the April
 * letter in July. The letter predates the newer record's answers, and is refused
 * today. It is accepted only when it covers an earlier, still-open referral
 * that flagged everything the open one does, and is itself inside its year.
 * Every other path keeps the refusal.
 */
describe("a physician's letter that predates a re-signed referral", () => {
  const FIRST = now; // 2026-07-18: the first referral
  const SECOND = new Date("2026-10-16T12:00:00.000Z"); // the re-signed one
  const LETTER_BETWEEN = "2026-08-20";

  const answers = (...ids: string[]) => ({
    ...clearAnswers,
    responses: {
      ...clearAnswers.responses,
      ...Object.fromEntries(ids.map((id) => [id, true])),
    },
  });

  async function signBoth(first: string[], second: string[], secondAt: Date = SECOND) {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: FIRST,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers(...first),
      now: FIRST,
    });
    const again = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: secondAt,
    });
    if (!again.ok) throw new Error("expected a fresh person-scoped link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers(...second),
      now: secondAt,
    });
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    return { ...context, staff: staff.person };
  }

  async function record(
    ctx: Awaited<ReturnType<typeof signBoth>>,
    evaluatedOn: string,
    at: Date,
    outcome: "cleared" | "not_cleared" = "cleared",
  ) {
    return recordMedicalEvaluation(ctx.db, {
      outcome,
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      recordedByPersonId: ctx.staff.id,
      evaluatedOn,
      physicianName: "Dr. Imani Reyes",
      now: at,
    });
  }

  async function referrals(ctx: Awaited<ReturnType<typeof signBoth>>) {
    const rows = await ctx.db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.personId, ctx.person.id), eq(waiverRecords.status, "medical_review")),
      );
    return rows.sort((a, b) => (a.signedAt?.getTime() ?? 0) - (b.signedAt?.getTime() ?? 0));
  }

  const TODAY = new Date("2026-10-20T12:00:00.000Z");

  it("clears the re-signed referral with the earlier letter, and only that record", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toMatchObject({ ok: true });

    const [first, second] = await referrals(ctx);
    expect(second?.medicalClearedAt).toEqual(TODAY);
    expect(second?.medicalClearanceEvaluatedOn).toBe(LETTER_BETWEEN);
    // The earlier referral is not cleared by the same letter.
    expect(first?.medicalClearedAt).toBeNull();
  });

  it("accepts a letter for an earlier referral that flagged more than the re-signed one", async () => {
    const ctx = await signBoth(["q3", "q5"], ["q3"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toMatchObject({ ok: true });
  });

  it("still refuses when the re-signed referral flags a prompt the earlier one never did", async () => {
    const ctx = await signBoth(["q3"], ["q3", "q5"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
    const [, second] = await referrals(ctx);
    expect(second?.medicalClearedAt).toBeNull();
  });

  it("still refuses a letter dated before the earliest matching referral", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, "2026-07-17", TODAY)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
  });

  it("accepts a letter dated the day the earliest matching referral was signed", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, "2026-07-18", TODAY)).toMatchObject({ ok: true });
  });

  it("still refuses a letter older than its own year", async () => {
    const secondAt = new Date("2027-08-01T12:00:00.000Z");
    const ctx = await signBoth(["q3"], ["q3"], secondAt);
    const later = new Date("2027-08-20T12:00:00.000Z");
    expect(await record(ctx, "2026-08-01", later)).toEqual({
      ok: false,
      reason: "evaluation_predates_disclosure",
    });
  });

  it("does not count an earlier referral a physician already answered", async () => {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: booking.id,
      now: FIRST,
    });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers("q3"),
      now: FIRST,
    });
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    // A physician refused the first referral.
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "not_cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.person.id,
        evaluatedOn: "2026-07-19",
        physicianName: "Dr. Imani Reyes",
        now: new Date("2026-07-20T12:00:00.000Z"),
      }),
    ).toMatchObject({ ok: true });
    const again = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: SECOND,
    });
    if (!again.ok) throw new Error("expected a fresh person-scoped link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: answers("q3"),
      now: SECOND,
    });
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.person.id,
        evaluatedOn: LETTER_BETWEEN,
        physicianName: "Dr. Imani Reyes",
        now: TODAY,
      }),
    ).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });
  });

  it("applies to a refusal the same way, since it is the same act", async () => {
    const ctx = await signBoth(["q3"], ["q3"]);
    expect(await record(ctx, LETTER_BETWEEN, TODAY, "not_cleared")).toMatchObject({
      ok: true,
      outcome: "not_cleared",
    });
  });
});
