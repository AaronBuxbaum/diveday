import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { commitContactImport } from "@/test/words-wiring";
import { activityEvents, waiverRecords } from "./schema";
import { listWaiverIntegrityAudit } from "./waivers-audit";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { hasUnansweredMedicalHold } from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";
import {
  medicalReferralAnswers,
  recordMedicalEvaluationForShop,
  waiverContextFor,
} from "./waivers-test-fixtures";

/**
 * **Every reader of a clearance stamp checks its seal** (issue #3987, after #3949): the readers
 * that do not decide boarding (the import's hold check, the token page's completed record, the
 * signature log) used to trust the bare `medical_cleared_at`, so a stamp written straight into
 * the database read as a clearance there while boarding held the diver.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);
const CODE = "medical_unsealed_clearance_replaced";

async function referral() {
  const ctx = await waiverContext();
  const { db, shop, booking, person } = ctx;
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id });
  if (!issued.ok) throw new Error(`issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.token, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: medicalReferralAnswers,
  });
  if (!done.ok) throw new Error("completion failed");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { ...ctx, owner, token: issued.token, recordId: issued.recordId };
}

/** The forgery: a clearance stamp with the seal the desk would have written missing. */
async function forgeStamp(ctx: Awaited<ReturnType<typeof referral>>) {
  await ctx.db
    .update(waiverRecords)
    .set({
      medicalClearedAt: nowDate(),
      medicalClearedByPersonId: ctx.owner,
      medicalClearanceEvaluatedOn: "2026-06-01",
      medicalClearancePhysicianName: "Dr. Forged",
      medicalAnswerSeal: null,
    })
    .where(eq(waiverRecords.id, ctx.recordId));
}

async function clearAtTheDesk(ctx: Awaited<ReturnType<typeof referral>>) {
  return recordMedicalEvaluationForShop(ctx.db, {
    outcome: "cleared",
    shopId: ctx.shop.id,
    personId: ctx.person.id,
    recordedByPersonId: ctx.owner,
    evaluatedOn: calendarDateInTimezone(nowDate(), ctx.shop.timezone),
    physicianName: "Dr. Imani Reyes",
  });
}

describe("the import's hold check", () => {
  const importWaiver = (ctx: Awaited<ReturnType<typeof referral>>) =>
    commitContactImport(
      ctx.db,
      ctx.shop.id,
      prepareContactImport(
        `full_name,email,waiver_accepted\n${ctx.person.fullName},${ctx.person.email},yes`,
      ),
      ctx.owner,
    );

  it("still holds a referral whose clearance stamp carries no seal", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    expect(await importWaiver(ctx)).toMatchObject({
      waiversAdded: 0,
      waiversSkippedMedicalHold: 1,
    });
  });

  it("does not hold a referral a physician cleared at the desk", async () => {
    const ctx = await referral();
    expect(await clearAtTheDesk(ctx)).toMatchObject({ ok: true });
    expect(await importWaiver(ctx)).toMatchObject({ waiversSkippedMedicalHold: 0 });
  });
});

describe("the token page's completed record", () => {
  it("shows no clearance for a stamp with no seal, and one for a sealed answer", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    const forged = await getWaiverForToken(ctx.db, ctx.token);
    if (forged.state !== "completed") throw new Error("expected a completed record");
    expect(forged.record.medicalClearedAt).toBeNull();

    await clearAtTheDesk(ctx);
    const sealed = await getWaiverForToken(ctx.db, ctx.token);
    if (sealed.state !== "completed") throw new Error("expected a completed record");
    expect(sealed.record.medicalClearedAt).toBeInstanceOf(Date);
  });
});

describe("the signature log", () => {
  const entryFor = async (ctx: Awaited<ReturnType<typeof referral>>) => {
    const page = await listWaiverIntegrityAudit(ctx.db, ctx.shop.id, { limit: 200 });
    const entry = page.entries.find((row) => row.id === ctx.recordId);
    if (!entry) throw new Error("record missing from the log");
    return entry;
  };

  it("does not call a stamp with no seal cleared, and does call a sealed answer cleared", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    expect((await entryFor(ctx)).medicalClearedAt).toBeNull();

    await clearAtTheDesk(ctx);
    expect((await entryFor(ctx)).medicalClearedAt).toBeInstanceOf(Date);
  });
});

describe("recording the answer again over an unsealed stamp", () => {
  const trail = (ctx: Awaited<ReturnType<typeof referral>>) =>
    ctx.db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.code, CODE), eq(activityEvents.shopId, ctx.shop.id)));

  it("keeps the diver answerable at the desk while the only stamp is unsealed", async () => {
    const ctx = await referral();
    expect(await hasUnansweredMedicalHold(ctx.db, ctx.shop.id, ctx.person.id)).toBe(true);
    await forgeStamp(ctx);
    expect(await hasUnansweredMedicalHold(ctx.db, ctx.shop.id, ctx.person.id)).toBe(true);
    await clearAtTheDesk(ctx);
    expect(await hasUnansweredMedicalHold(ctx.db, ctx.shop.id, ctx.person.id)).toBe(false);
  });

  it("writes a trail line naming the record before the stamp is overwritten", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    expect(await trail(ctx)).toHaveLength(0);

    expect(await clearAtTheDesk(ctx)).toMatchObject({ ok: true, alreadyRecorded: false });

    const lines = await trail(ctx);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      actorPersonId: ctx.owner,
      subjectPersonId: ctx.person.id,
      params: expect.objectContaining({ record: ctx.recordId }),
    });
  });

  it("writes none for an ordinary first answer", async () => {
    const ctx = await referral();
    expect(await clearAtTheDesk(ctx)).toMatchObject({ ok: true, alreadyRecorded: false });
    expect(await trail(ctx)).toHaveLength(0);
  });
});
