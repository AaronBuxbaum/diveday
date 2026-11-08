import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { prepareContactImport } from "@/test/import-fixture";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { commitContactImport } from "@/test/words-wiring";
import { repointHeldBooking } from "../features/identity-repoint/store";
import { physicianReferrals } from "../features/invite-suggestions/store";
import {
  medicalReferralAnswers,
  recordMedicalEvaluationForShop,
  waiverContextFor,
} from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { splitBookingIdentity } from "./bookings";
import { createPerson } from "./people";
import { bookings, waiverRecords } from "./schema";
import { listWaiverIntegrityAudit } from "./waivers-audit";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import { attachDiverMedicalForm, contactOnFile, hasUnansweredMedicalHold } from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";

/**
 * **Every reader of a clearance stamp reads the same answer** (Aaron, 2026-11-06): a recorded
 * clearance, with the staffer and the date on it, lifts the referral everywhere boarding is
 * decided and everywhere it is shown. No recorded clearance, no boarding.
 */
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

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

type Referral = Awaited<ReturnType<typeof referral>>;

async function clearAtTheDesk(ctx: Referral) {
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
  const importWaiver = (ctx: Referral) =>
    commitContactImport(
      ctx.db,
      ctx.shop.id,
      prepareContactImport(
        `full_name,email,waiver_accepted\n${ctx.person.fullName},${ctx.person.email},yes`,
      ),
      ctx.owner,
    );

  it("holds an unanswered referral", async () => {
    const ctx = await referral();
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
  it("shows the clearance once it is recorded", async () => {
    const ctx = await referral();
    const before = await getWaiverForToken(ctx.db, ctx.token);
    if (before.state !== "completed") throw new Error("expected a completed record");
    expect(before.record.medicalClearedAt).toBeNull();

    await clearAtTheDesk(ctx);
    const after = await getWaiverForToken(ctx.db, ctx.token);
    if (after.state !== "completed") throw new Error("expected a completed record");
    expect(after.record.medicalClearedAt).toBeInstanceOf(Date);
  });
});

describe("the invite lists' physician referrals", () => {
  it("count an unanswered referral, and not a cleared one", async () => {
    const ctx = await referral();
    expect(await physicianReferrals(ctx.db, ctx.shop.id, [ctx.person.id])).toEqual(
      new Set([ctx.person.id]),
    );
    await clearAtTheDesk(ctx);
    expect(await physicianReferrals(ctx.db, ctx.shop.id, [ctx.person.id])).toEqual(new Set());
  });
});

describe("the signature log", () => {
  it("calls a recorded clearance cleared", async () => {
    const ctx = await referral();
    const entryFor = async () => {
      const page = await listWaiverIntegrityAudit(ctx.db, ctx.shop.id, { limit: 200 });
      const entry = page.entries.find((row) => row.id === ctx.recordId);
      if (!entry) throw new Error("record missing from the log");
      return entry;
    };
    expect((await entryFor()).medicalClearedAt).toBeNull();
    await clearAtTheDesk(ctx);
    expect((await entryFor()).medicalClearedAt).toBeInstanceOf(Date);
  });
});

describe("the desk's physician answer", () => {
  it("is answerable until a clearance is recorded, and not after", async () => {
    const ctx = await referral();
    expect(await hasUnansweredMedicalHold(ctx.db, ctx.shop.id, ctx.person.id)).toBe(true);
    await clearAtTheDesk(ctx);
    expect(await hasUnansweredMedicalHold(ctx.db, ctx.shop.id, ctx.person.id)).toBe(false);
  });

  it("reports the same answer twice as already recorded", async () => {
    const ctx = await referral();
    expect(await clearAtTheDesk(ctx)).toMatchObject({ ok: true, alreadyRecorded: false });
    expect(await clearAtTheDesk(ctx)).toMatchObject({ ok: true, alreadyRecorded: true });
  });
});

/** The seat held for a name check, as the split and the repoint both require. */
async function holdSeatForNameCheck(ctx: Referral) {
  await ctx.db
    .update(bookings)
    .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: ctx.person.fullName })
    .where(eq(bookings.id, ctx.booking.id));
}

describe("the identity split's medical refusal", () => {
  const split = (ctx: Referral) =>
    splitBookingIdentity(ctx.db, {
      shopId: ctx.shop.id,
      bookingId: ctx.booking.id,
      actorPersonId: ctx.owner,
      fullName: "Ben Quinn",
      adultAttested: true,
    });

  it("refuses an unanswered referral", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
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
  const repoint = async (ctx: Referral) => {
    const other = await createPerson(ctx.db, {
      shopId: ctx.shop.id,
      fullName: ctx.person.fullName,
      email: "namesake-clearance@example.com",
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

  it("refuses an unanswered referral", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
    expect(await repoint(ctx)).toEqual({ ok: false, reason: "medical_hold" });
  });

  it("does not refuse a referral a physician cleared at the desk", async () => {
    const ctx = await referral();
    await holdSeatForNameCheck(ctx);
    await clearAtTheDesk(ctx);
    expect(await repoint(ctx)).toMatchObject({ ok: true });
  });
});

describe("a diver's doctor form", () => {
  const FORM = "https://storage.example/medical/doctors-form-clearance.pdf";

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
