import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getBookingReadiness, listTripReadiness } from "./readiness";
import { waiverRecords } from "./schema";
import { listStaff } from "./trips";
import { completeWaiver } from "./waivers-completion";
import { recordInPersonWaiver } from "./waivers-in-person";
import {
  hasUnansweredMedicalHold,
  recordMedicalEvaluation,
  retireMedicalRefusal,
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

/** Retiring a refusal (issue #1252's sequel): split from `waivers-medical.test.ts`. */
describe("physician medical clearance: retiring a refusal", () => {
  /** After the referral was signed (`now`), and not in the future. */
  const EVALUATED_ON = "2026-07-18";

  async function heldContext() {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now,
    });
    const staff = await staffPerson(db, shop.id);
    return { ...context, staff };
  }

  async function staffPerson(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [staff] = await listStaff(db, shopId);
    if (!staff) throw new Error("demo staff missing");
    return staff.person;
  }

  describe("retiring a refusal so the seat takes a fresh release", () => {
    const later = new Date(now.getTime() + 120_000);
    const signedLater = new Date(now.getTime() + 180_000);

    async function staffWithRole(
      db: Awaited<ReturnType<typeof waiverContext>>["db"],
      shopId: string,
      role: string,
    ) {
      const staff = (await listStaff(db, shopId)).find((row) => row.roles.includes(role));
      if (!staff) throw new Error(`demo ${role} missing`);
      return staff.person;
    }

    /**
     * The shape that makes retiring dangerous: the diver signed a clean,
     * current release *before* the disclosure the physician then refused.
     * Retire the refusal naively and sign-once falls straight back to it.
     */
    async function refusedOverAnOlderCleanRelease() {
      const context = await waiverContext();
      const { db, shop, booking, person } = context;
      const earlier = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const standing = await issueWaiverRequest(db, {
        shopId: shop.id,
        personId: person.id,
        now: earlier,
      });
      if (!standing.ok) throw new Error(`the earlier release was refused: ${standing.reason}`);
      await completeWaiver(db, standing.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        now: earlier,
      });
      const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
      if (!issued.ok) throw new Error("expected a waiver link");
      await completeWaiver(db, issued.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: medicalReferralAnswers,
        now,
      });
      const owner = await staffWithRole(db, shop.id, "owner");
      await recordMedicalEvaluation(db, {
        outcome: "not_cleared",
        shopId: shop.id,
        timeZone: shop.timezone,
        personId: person.id,
        recordedByPersonId: owner.id,
        evaluatedOn: EVALUATED_ON,
        physicianName: "Dr. Imani Reyes",
        now: new Date(now.getTime() + 60_000),
      });
      return { ...context, owner };
    }

    it("keeps the seat blocked as not cleared until the new release is signed", async () => {
      const { db, shop, booking, owner } = await refusedOverAnOlderCleanRelease();
      expect(
        await retireMedicalRefusal(db, {
          shopId: shop.id,
          bookingId: booking.id,
          actorPersonId: owner.id,
          now: later,
        }),
      ).toMatchObject({ ok: true });

      // The safety property: the clean release from the day before does not
      // stand over a physician's later "no".
      const pending = await getBookingReadiness(db, shop.id, booking.id);
      expect(pending?.status).toBe("blocked");
      expect(pending?.blockers).toContainEqual(
        expect.objectContaining({ code: "medical_not_cleared" }),
      );

      // And the seat can now carry a new link at all.
      const fresh = await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        now: later,
      });
      expect(fresh).toMatchObject({ ok: true, reused: false });
      const stillPending = await getBookingReadiness(db, shop.id, booking.id);
      expect(stillPending?.blockers).toContainEqual(
        expect.objectContaining({ code: "medical_not_cleared" }),
      );
    });

    it("parks a new yes for a new physician's evaluation", async () => {
      const { db, shop, booking, person, owner } = await refusedOverAnOlderCleanRelease();
      await retireMedicalRefusal(db, {
        shopId: shop.id,
        bookingId: booking.id,
        actorPersonId: owner.id,
        now: later,
      });
      const fresh = await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        now: later,
      });
      if (!fresh.ok) throw new Error(`the new release was refused: ${fresh.reason}`);
      await completeWaiver(db, fresh.token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: medicalReferralAnswers,
        now: signedLater,
      });
      const referred = await getBookingReadiness(db, shop.id, booking.id);
      expect(referred?.blockers).toContainEqual(
        expect.objectContaining({ code: "medical_review" }),
      );
      expect(referred?.blockers).not.toContainEqual(
        expect.objectContaining({ code: "medical_not_cleared" }),
      );
      // The new disclosure is open to a new evaluation; the old answer is not
      // what it writes over.
      expect(await hasUnansweredMedicalHold(db, shop.id, person.id)).toBe(true);
    });

    it("boards a clean new release without a physician, and warns with the refused record", async () => {
      const { db, shop, booking, person, owner } = await refusedOverAnOlderCleanRelease();
      await retireMedicalRefusal(db, {
        shopId: shop.id,
        bookingId: booking.id,
        actorPersonId: owner.id,
        now: later,
      });
      const fresh = await issueWaiverRequest(db, {
        shopId: shop.id,
        bookingId: booking.id,
        now: later,
      });
      if (!fresh.ok) throw new Error(`the new release was refused: ${fresh.reason}`);
      // Every answer "no", after a physician said no: allowed (Aaron,
      // 2026-10-07, issue #2158), and never silent.
      expect(
        await completeWaiver(db, fresh.token, {
          signerName: person.fullName,
          agreed: true,
          medicalAnswers: clearAnswers,
          now: signedLater,
        }),
      ).toMatchObject({ ok: true, status: "completed" });
      const boarded = await getBookingReadiness(db, shop.id, booking.id);
      expect(boarded?.blockers).not.toContainEqual(
        expect.objectContaining({ code: "medical_not_cleared" }),
      );
      expect(boarded?.blockers).not.toContainEqual(
        expect.objectContaining({ code: "medical_review" }),
      );

      const [refused] = await db
        .select()
        .from(waiverRecords)
        .where(
          and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
        );
      const row = (await listTripReadiness(db, shop.id, booking.tripId, signedLater)).find(
        (candidate) => candidate.booking.id === booking.id,
      );
      expect(row?.overriddenRefusal).toEqual({
        recordId: refused.id,
        personId: person.id,
        at: refused.medicalClearanceDeclinedAt,
        evaluatedOn: refused.medicalClearanceEvaluatedOn ?? null,
      });
    });

    it("takes a paper waiver after a refusal, with the same warning", async () => {
      const { db, shop, booking, owner } = await refusedOverAnOlderCleanRelease();
      await retireMedicalRefusal(db, {
        shopId: shop.id,
        bookingId: booking.id,
        actorPersonId: owner.id,
        now: later,
      });
      expect(
        await recordInPersonWaiver(db, {
          shopId: shop.id,
          subject: { bookingId: booking.id },
          recordedByPersonId: owner.id,
          medicalAttested: true,
          now: signedLater,
        }),
      ).toMatchObject({ ok: true });
      const readiness = await getBookingReadiness(db, shop.id, booking.id);
      expect(readiness?.blockers).not.toContainEqual(
        expect.objectContaining({ code: "medical_not_cleared" }),
      );
      const row = (await listTripReadiness(db, shop.id, booking.tripId, signedLater)).find(
        (candidate) => candidate.booking.id === booking.id,
      );
      expect(row?.overriddenRefusal).not.toBeNull();
    });

    it("lets any staffer record paper after a refusal (H-98)", async () => {
      const { db, shop, booking, owner } = await refusedOverAnOlderCleanRelease();
      await retireMedicalRefusal(db, {
        shopId: shop.id,
        bookingId: booking.id,
        actorPersonId: owner.id,
        now: later,
      });
      const divemaster = await staffWithRole(db, shop.id, "divemaster");
      expect(
        await recordInPersonWaiver(db, {
          shopId: shop.id,
          subject: { bookingId: booking.id },
          recordedByPersonId: divemaster.id,
          medicalAttested: true,
          now: signedLater,
        }),
      ).toMatchObject({ ok: true });
      expect((await getBookingReadiness(db, shop.id, booking.id))?.blockers).not.toContainEqual(
        expect.objectContaining({ code: "medical_not_cleared" }),
      );
    });

    it("leaves the refusal on file, untouched but for its seat", async () => {
      const { db, shop, booking, owner } = await refusedOverAnOlderCleanRelease();
      await retireMedicalRefusal(db, {
        shopId: shop.id,
        bookingId: booking.id,
        actorPersonId: owner.id,
        now: later,
      });
      const [refused] = await db
        .select()
        .from(waiverRecords)
        .where(
          and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
        );
      expect(refused.supersededAt).toEqual(later);
      expect(refused.medicalClearedAt).toBeNull();
      expect(refused.medicalClearanceDeclinedAt).not.toBeNull();
      expect(refused.medicalClearanceEvaluatedOn).toBe(EVALUATED_ON);
    });

    it("is refused to staff who are not an owner or manager", async () => {
      const { db, shop, booking } = await refusedOverAnOlderCleanRelease();
      const divemaster = await staffWithRole(db, shop.id, "divemaster");
      expect(
        await retireMedicalRefusal(db, {
          shopId: shop.id,
          bookingId: booking.id,
          actorPersonId: divemaster.id,
          now: later,
        }),
      ).toEqual({ ok: false, reason: "not_authorized" });
      expect(
        await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now: later }),
      ).toEqual({ ok: false, reason: "already_completed" });
    });

    it("has nothing to retire on a seat nobody refused", async () => {
      const { db, shop, booking } = await heldContext();
      const owner = await staffWithRole(db, shop.id, "owner");
      expect(
        await retireMedicalRefusal(db, {
          shopId: shop.id,
          bookingId: booking.id,
          actorPersonId: owner.id,
          now: later,
        }),
      ).toEqual({ ok: false, reason: "no_refusal" });
    });
  });
});
