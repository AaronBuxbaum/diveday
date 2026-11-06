import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { commitContactImport } from "@/test/words-wiring";
import { splitBookingIdentity } from "./bookings";
import { repointHeldBooking } from "./identity-repoint";
import { physicianReferrals } from "./invite-suggestions";
import { createPerson } from "./people";
import { activityEvents, bookings, waiverRecords } from "./schema";
import { listWaiverIntegrityAudit } from "./waivers-audit";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { attachDiverMedicalForm, contactOnFile, hasUnansweredMedicalHold } from "./waivers-medical";
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
  const done = await completeWaiver(db, issued.key, {
    signerName: person.fullName,
    agreed: true,
    medicalAnswers: medicalReferralAnswers,
  });
  if (!done.ok) throw new Error("completion failed");
  const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  return { ...ctx, owner, token: issued.key, recordId: issued.recordId };
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

describe("the invite lists' physician referrals", () => {
  it("count a referral whose clearance stamp carries no seal, and not a sealed answer", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    expect(await physicianReferrals(ctx.db, ctx.shop.id, [ctx.person.id])).toEqual(
      new Set([ctx.person.id]),
    );
    await clearAtTheDesk(ctx);
    expect(await physicianReferrals(ctx.db, ctx.shop.id, [ctx.person.id])).toEqual(new Set());
  });
});

describe("recording the answer again over a wrongly sealed stamp", () => {
  it("is refused, not reported as recorded, because boarding still holds the diver", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    await ctx.db
      .update(waiverRecords)
      .set({ medicalAnswerSeal: "not-the-seal-of-this-answer" })
      .where(eq(waiverRecords.id, ctx.recordId));
    expect(await clearAtTheDesk(ctx)).toEqual({ ok: false, reason: "answer_seal_broken" });
    const [row] = await ctx.db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, ctx.recordId));
    expect(row?.medicalClearancePhysicianName).toBe("Dr. Forged");
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

/** The seat held for a name check, as the split and the repoint both require. */
async function holdSeatForNameCheck(ctx: Awaited<ReturnType<typeof referral>>) {
  await ctx.db
    .update(bookings)
    .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: ctx.person.fullName })
    .where(eq(bookings.id, ctx.booking.id));
}

describe("the identity split's medical refusal", () => {
  const split = (ctx: Awaited<ReturnType<typeof referral>>) =>
    splitBookingIdentity(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      actorPersonId: ctx.owner,
      fullName: "Ben Quinn",
      adultAttested: true,
    });

  it("still refuses a referral whose clearance stamp carries no seal", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
    await forgeStamp(ctx);
    expect(await split(ctx)).toEqual({ ok: false, reason: "medical_hold" });
  });

  it("does not refuse a referral a physician cleared at the desk", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
    await clearAtTheDesk(ctx);
    expect(await split(ctx)).toMatchObject({ ok: true });
  });
});

describe("the repoint's medical refusal", () => {
  const repoint = async (ctx: Awaited<ReturnType<typeof referral>>) => {
    const other = await createPerson(ctx.db, {
      shopId: ctx.shop.id,
      fullName: ctx.person.fullName,
      email: "namesake-3998@example.com",
      phone: null,
      origin: "identity_split",
    });
    return repointHeldBooking(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      actorPersonId: ctx.owner,
      toPersonId: other.id,
    });
  };

  it("still refuses a referral whose clearance stamp carries no seal", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
    await forgeStamp(ctx);
    expect(await repoint(ctx)).toEqual({ ok: false, reason: "medical_hold" });
  });

  it("does not refuse a referral a physician cleared at the desk", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
    await clearAtTheDesk(ctx);
    expect(await repoint(ctx)).toMatchObject({ ok: true });
  });
});

describe("a diver's doctor form over a forged stamp", () => {
  const FORM = "https://storage.example/medical/doctors-form-3998.pdf";

  it("is refused, and leaves no form beside a stamp no desk reader looks at", async () => {
    const ctx = await referral();
    await forgeStamp(ctx);
    const opened = await getWaiverForToken(ctx.db, ctx.token);
    if (opened.state !== "completed") throw new Error("expected a completed record");
    expect(
      await attachDiverMedicalForm(
        ctx.db,
        opened.record,
        FORM,
        await contactOnFile(ctx.db, opened.record),
      ),
    ).toBe("closed");
    const [row] = await ctx.db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, ctx.recordId));
    expect(row?.diverMedicalFormUrl).toBeNull();
  });

  it("is refused once a physician cleared the diver", async () => {
    const ctx = await referral();
    const before = await getWaiverForToken(ctx.db, ctx.token);
    if (before.state !== "completed") throw new Error("expected a completed record");
    await clearAtTheDesk(ctx);
    const [raw] = await ctx.db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, ctx.recordId));
    if (!raw) throw new Error("record missing");
    expect(await attachDiverMedicalForm(ctx.db, raw, FORM, await contactOnFile(ctx.db, raw))).toBe(
      "closed",
    );
    // A page opened before the answer landed cannot write over it either.
    expect(
      await attachDiverMedicalForm(
        ctx.db,
        before.record,
        FORM,
        await contactOnFile(ctx.db, before.record),
      ),
    ).toBe("closed");
  });
});

describe("issuing a person's waiver link over a forged referral", () => {
  const hour = 60 * 60 * 1000;

  /** A clean person release, then a newer seat referral: the clean one must not stand over it. */
  async function cleanThenReferral() {
    const ctx = await waiverContext();
    const { db, shop, booking, person } = ctx;
    const t0 = nowDate();
    const clean = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id, now: t0 });
    if (!clean.ok) throw new Error(`clean link failed: ${clean.reason}`);
    const signedClean = await completeWaiver(db, clean.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now: t0,
    });
    if (!signedClean.ok) throw new Error("clean signature failed");
    const t1 = new Date(t0.getTime() + hour);
    const seat = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now: t1 });
    if (!seat.ok) throw new Error(`seat link failed: ${seat.reason}`);
    const referred = await completeWaiver(db, seat.key, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: t1,
    });
    if (!referred.ok) throw new Error("referral failed");
    const owner = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
    return {
      ...ctx,
      owner,
      token: seat.key,
      recordId: seat.recordId,
      at: new Date(t1.getTime() + hour),
    };
  }

  it("asks for a fresh signature over an unanswered referral", async () => {
    const ctx = await cleanThenReferral();
    const answer = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      now: ctx.at,
    });
    expect(answer).toMatchObject({ ok: true });
  });

  it("does the same over a referral whose clearance stamp carries no seal", async () => {
    const ctx = await cleanThenReferral();
    await forgeStamp(ctx);
    const answer = await issueWaiverRequest(ctx.db, {
      shopId: ctx.shop.id,
      personId: ctx.person.id,
      now: ctx.at,
    });
    expect(answer).toMatchObject({ ok: true });
  });
});
