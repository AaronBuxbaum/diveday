import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import {
  isCleanCompletion,
  isUnresolvedMedicalHold,
  shopWaiverStatus,
  waiverState,
} from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { getBookingReadiness, listTripReadiness } from "./readiness";
import { bookings, people, personRoles, shops, userAccounts, waiverRecords } from "./schema";
import { createTrip, listStaff } from "./trips";
import { listSignedWaiversByPerson } from "./waivers-audit";
import { completeWaiver } from "./waivers-completion";
import {
  getMedicalClearanceDocument,
  hasUnansweredMedicalHold,
  recordMedicalEvaluation,
} from "./waivers-medical";
import { issueWaiverRequest } from "./waivers-requests";
import { getCurrentWaiverTemplate } from "./waivers-templates";
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
 * **The one door out of a medical hold** (issue #1252).
 *
 * A referral parks the release in `medical_review` and readiness refuses to
 * board the diver. Before this the only lift was `recordInPersonWaiver`, whose
 * attestation asserts that *no answer needs physician sign-off* — untrue of
 * exactly the diver holding a signed evaluation. These pin that the new act
 * ends the block, that it never manufactures one, and that everything it
 * refuses, it refuses closed.
 */
describe("physician medical clearance", () => {
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

  it("ends the medical block and records who cleared it, and when", async () => {
    const { db, shop, booking, staff } = await heldContext();
    const before = await getBookingReadiness(db, shop.id, booking.id);
    expect(before?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));

    const clearedAt = new Date(now.getTime() + 60_000);
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: clearedAt,
    });
    expect(outcome).toMatchObject({ ok: true, alreadyRecorded: false });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record).toMatchObject({
      // The status deliberately does not move: the row still says this diver
      // was referred, and the signed evidence keeps its seal.
      status: "medical_review",
      medicalClearedAt: clearedAt,
      medicalClearedByPersonId: staff.id,
      medicalClearanceDocumentUrl: null,
    });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "medical_review" }),
    );
  });

  it("marks a hold the diver re-signed their way past, with no physician in it", async () => {
    // The hole #1282 is about, through the product's own doors: a referred
    // diver is sent a fresh link, answers "no" to everything, and their standing
    // with the shop reads *current* — no doctor anywhere in it.
    //
    // The booking that carries the referral stays blocked (`effectiveWaiverForBooking`
    // returns a booking's own unresolved hold outright), so the exposure is the
    // diver's **next** seat and the shop-wide standing staff read on the record.
    // That is what this pins, and what now carries the mark.
    const { db, shop, person } = await heldContext();

    const later = new Date(now.getTime() + 3_600_000);
    const again = await issueWaiverRequest(db, {
      shopId: shop.id,
      personId: person.id,
      now: later,
    });
    if (!again.ok) throw new Error("expected a fresh person-scoped link");
    await completeWaiver(db, again.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
      now: later,
    });

    const signed = (await listSignedWaiversByPerson(db, shop.id, [person.id])).get(person.id) ?? [];
    const template = await getCurrentWaiverTemplate(db, shop.id);
    const status = shopWaiverStatus({
      personSignedWaivers: signed,
      currentTemplateVersion: template?.materialGeneration ?? null,
      now: later,
    });
    // Cleared — the reproduction, kept by decision (Aaron, 2026-10-09, issue
    // #2195, amending H-20261007-after-physician-says-no). Refusing it would strand a diver who mis-tapped
    // question 3 until a doctor writes a letter.
    expect(status.state).toBe("current");
    // And the standing says what it stood over, so the diver's record and the
    // boat's manifest can both say so, and link to the referral itself.
    const [referral] = await db
      .select({ id: waiverRecords.id })
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.personId, person.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(status).toMatchObject({
      medical: {
        overriddenReferralAt: expect.any(Date),
        overriddenReferral: { recordId: referral?.id, personId: person.id },
      },
    });
  });

  it("leaves the signed evidence verifiable — a clearance is not a tamper", async () => {
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(verifyWaiverIntegrity(record)).toBe("valid");
  });

  it("stores the physician's evaluation when one is handed over", async () => {
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
      now,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDocumentUrl).toBe(
      "https://media.example.com/medical-clearances/abc.pdf",
    );
  });

  /**
   * **The read path's own query** (issue #1283). #1252 shipped the write
   * before the read: the document went in and nothing ever came out, so a shop
   * bought retention liability with no retrieval value. What this pins is that
   * the reader is shop-scoped in its *own* SQL rather than trusting the route
   * to have checked, and that it refuses the two states where reaching for the
   * bytes would be wrong.
   */
  describe("getMedicalClearanceDocument", () => {
    it("hands back the stored evaluation for a cleared record", async () => {
      const { db, shop, booking, staff } = await heldContext();
      const url = "https://media.example.com/medical-clearances/abc.pdf";
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        documentUrl: url,
        now,
      });
      const [record] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, booking.id));

      expect((await getMedicalClearanceDocument(db, shop.id, record.id))?.url).toBe(url);
    });

    it("never reaches another shop's record, on the id alone", async () => {
      // The route scopes by the session's own shop and passes it here; this is
      // the second half of that, in SQL, so a route that one day forgot cannot
      // hand a manager of one shop a diver's medical file from another.
      const { db, shop, booking, staff } = await heldContext();
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
        now,
      });
      const [record] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, booking.id));
      const [other] = await db
        .insert(shops)
        .values({
          name: "Rival Reef",
          slug: "rival-reef-clearance-read",
          timezone: "America/New_York",
        })
        .returning();
      if (!other) throw new Error("second shop insert failed");

      expect(await getMedicalClearanceDocument(db, other.id, record.id)).toBeNull();
    });

    it("says nothing for a record still held, and nothing for an erased one", async () => {
      const { db, shop, booking, staff } = await heldContext();
      const [held] = await db
        .select()
        .from(waiverRecords)
        .where(eq(waiverRecords.bookingId, booking.id));
      // Held: no clearance, so by the schema's own check there can be no
      // document either — and asking anyway would read a column the route's
      // claimed state does not cover.
      expect(await getMedicalClearanceDocument(db, shop.id, held.id)).toBeNull();

      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
        now,
      });
      expect(await getMedicalClearanceDocument(db, shop.id, held.id)).not.toBeNull();

      // Erased: `anonymizeDiver` destroys the file and keeps the stamp, so a
      // read through it would be reaching for bytes that are gone.
      await db
        .update(waiverRecords)
        .set({ anonymizedAt: now })
        .where(eq(waiverRecords.id, held.id));
      expect(await getMedicalClearanceDocument(db, shop.id, held.id)).toBeNull();
    });
  });

  it("is idempotent — a second recording never rewrites who cleared it or when", async () => {
    const { db, shop, booking, staff } = await heldContext();
    const first = new Date(now.getTime() + 60_000);
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: first,
    });
    const second = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: new Date(now.getTime() + 120_000),
    });
    expect(second).toMatchObject({ ok: true, alreadyRecorded: true });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearedAt).toEqual(first);
  });

  it("refuses when nothing of this diver's is in review — never a silent success", async () => {
    const { db, shop, booking, person } = await waiverContext();
    const staff = await staffPerson(db, shop.id);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now,
    });
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_medical_hold" });
  });

  it("refuses a recorder who is not this shop's live staff, failing closed", async () => {
    const { db, shop, booking } = await heldContext();
    const [outsider] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Not Staff", email: `outsider-${randomUUID()}@x.test` })
      .returning();
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: outsider.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "staff_not_found" });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("never reaches another shop's held record", async () => {
    const { db, booking, staff } = await heldContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other", slug: `other-${randomUUID()}`, timezone: "America/New_York" })
      .returning();
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: otherShop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    // Not even far enough to look at the record: the actor is not that shop's staff.
    expect(outcome).toEqual({ ok: false, reason: "staff_not_found" });
  });

  it("refuses a clearance with nothing behind it — a button press is not evidence", async () => {
    const { db, shop, booking, staff } = await heldContext();
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        now,
      }),
    ).toEqual({ ok: false, reason: "evidence_required" });
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: "",
        physicianName: "Dr. Imani Reyes",
        now,
      }),
    ).toEqual({ ok: false, reason: "evaluation_date_required" });
  });

  it("refuses an evaluation that predates the answers it would clear", async () => {
    // A letter written in March cannot clear a stent placed in June. The
    // referral here was signed on 2026-07-18.
    const { db, shop, booking, staff } = await heldContext();
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: "2026-03-01",
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("refuses an evaluation dated after today — that is a typo, not a clearance", async () => {
    const { db, shop, booking, staff } = await heldContext();
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: booking.personId,
        recordedByPersonId: staff.id,
        evaluatedOn: "2027-01-01",
        physicianName: "Dr. Imani Reyes",
        now,
      }),
    ).toEqual({ ok: false, reason: "evaluation_in_future" });
  });

  it("never clears a diver in another shop, even for that shop's own live staff", async () => {
    // The sibling test below stops at `staff_not_found`, which is honest but
    // proves nothing about the query's own shop condition. This one gets a real
    // live staff member of shop B past that gate and still finds nothing.
    const { db, shop, booking } = await heldContext();
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other", slug: `other-${randomUUID()}`, timezone: "America/New_York" })
      .returning();
    const [otherStaff] = await db
      .insert(people)
      .values({
        shopId: otherShop.id,
        fullName: "Other Owner",
        email: `other-owner-${randomUUID()}@x.test`,
      })
      .returning();
    await db.insert(personRoles).values({ personId: otherStaff.id, role: "owner" });
    await db.insert(userAccounts).values({
      personId: otherStaff.id,
      email: `other-owner-${randomUUID()}@x.test`,
      hashedPassword: "x",
      status: "active",
    });

    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: otherShop.id,
      personId: booking.personId,
      recordedByPersonId: otherStaff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(outcome).toEqual({ ok: false, reason: "no_medical_hold" });

    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("records a refusal without lifting the block, and says the answer arrived", async () => {
    // The whole point of issue #1283: before this, a diver whose physician said
    // no was indistinguishable from one nobody had heard from, so the shop kept
    // chasing and the crew never learned the answer.
    const { db, shop, booking, staff } = await heldContext();
    const declinedAt = new Date(now.getTime() + 60_000);
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: declinedAt,
    });
    expect(outcome).toMatchObject({ ok: true, outcome: "not_cleared", alreadyRecorded: false });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record).toMatchObject({
      status: "medical_review",
      // The safety property, pinned: nothing a refusal writes may read as a
      // clearance to the consumers that key off `medicalClearedAt`.
      medicalClearedAt: null,
      medicalClearedByPersonId: null,
      medicalClearanceDeclinedAt: declinedAt,
      medicalClearanceDeclinedByPersonId: staff.id,
      medicalClearanceEvaluatedOn: EVALUATED_ON,
    });
    expect(isUnresolvedMedicalHold(record)).toBe(true);
    expect(isCleanCompletion(record)).toBe(false);
    expect(waiverState(record, declinedAt)).toBe("medical_not_cleared");

    // Fail-closed end to end: readiness still refuses to board them, and the
    // blocker it raises is the one that says why.
    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers).toContainEqual(
      expect.objectContaining({ code: "medical_not_cleared" }),
    );
    expect(after?.blockers).not.toContainEqual(expect.objectContaining({ code: "medical_review" }));
  });

  it("refuses a clearance on a record a physician already refused, in both directions", async () => {
    // A recorded "no" is not erasable from the desk. A diver re-evaluated after
    // a refusal is answering a fresh disclosure, which signs a new release.
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
    };
    await recordMedicalEvaluation(db, { ...base, outcome: "not_cleared", now });
    expect(
      await recordMedicalEvaluation(db, {
        ...base,
        outcome: "cleared",
        now: new Date(now.getTime() + 60_000),
      }),
    ).toEqual({ ok: false, reason: "answer_already_recorded" });

    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearedAt).toBeNull();
    expect(record.medicalClearanceDeclinedAt).not.toBeNull();
  });

  it("refuses a refusal on a record a physician already cleared", async () => {
    // The same rule read the other way, so neither answer is the one that can
    // be quietly overwritten.
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
    };
    await recordMedicalEvaluation(db, { ...base, outcome: "cleared", now });
    expect(
      await recordMedicalEvaluation(db, {
        ...base,
        outcome: "not_cleared",
        now: new Date(now.getTime() + 60_000),
      }),
    ).toEqual({ ok: false, reason: "answer_already_recorded" });
  });

  it("is idempotent on a repeated refusal, and never rewrites who recorded it", async () => {
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      outcome: "not_cleared",
    } as const;
    const first = new Date(now.getTime() + 60_000);
    await recordMedicalEvaluation(db, { ...base, now: first });
    expect(
      await recordMedicalEvaluation(db, { ...base, now: new Date(now.getTime() + 120_000) }),
    ).toMatchObject({ ok: true, outcome: "not_cleared", alreadyRecorded: true });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDeclinedAt).toEqual(first);
  });

  it("applies a refusal the same evidence rules as a clearance", async () => {
    // Same act, same evidence: the refusal is the record of why somebody stayed
    // ashore, so it may not be the cheaper one to write.
    const { db, shop, booking, staff } = await heldContext();
    const base = {
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      outcome: "not_cleared",
      now,
    } as const;
    expect(await recordMedicalEvaluation(db, { ...base, evaluatedOn: EVALUATED_ON })).toEqual({
      ok: false,
      reason: "evidence_required",
    });
    expect(
      await recordMedicalEvaluation(db, { ...base, evaluatedOn: "", physicianName: "Dr. Reyes" }),
    ).toEqual({ ok: false, reason: "evaluation_date_required" });
    expect(
      await recordMedicalEvaluation(db, {
        ...base,
        evaluatedOn: "2026-01-01",
        physicianName: "Dr. Reyes",
      }),
    ).toEqual({ ok: false, reason: "evaluation_predates_disclosure" });
  });

  it("hands back the refused evaluation itself, which a claims reader asks for first", async () => {
    // The document read was narrowed to clearances when it shipped. A refusal's
    // own letter is the one an insurer wants, and storing it with no way back
    // to it is the shape issue #1283 exists to close.
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/refused.pdf",
      now,
    });
    const [held] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(await getMedicalClearanceDocument(db, shop.id, held.id)).toEqual({
      url: "https://media.example.com/medical-clearances/refused.pdf",
      personId: booking.personId,
    });
  });

  it("stops asking for an answer once a refusal has arrived", async () => {
    // `hasUnansweredMedicalHold` and `isUnresolvedMedicalHold` deliberately
    // disagree here, and this is the pair that proves it: no answer is
    // outstanding, and the diver is still blocked.
    const { db, shop, booking, staff } = await heldContext();
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(true);
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(false);
    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.status).toBe("blocked");
  });

  it("erases a refused evaluation the way it erases a cleared one", async () => {
    // The erasure exemption on `..._evidenced` was written for a clearance
    // evidenced only by a document; a refusal reaches the same clause and would
    // otherwise take the whole erasure transaction down with it.
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/refused.pdf",
      now,
    });
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staff.id,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDocumentUrl).toBeNull();
    // The shop's own act survives the erasure, as a clearance's does.
    expect(record.medicalClearanceDeclinedAt).not.toBeNull();
    expect(record.medicalClearanceDeclinedByPersonId).toBe(staff.id);
  });

  it("answers the cheap pre-read the surface runs before it stores an evaluation", async () => {
    // The upload happens only when this says yes, so that a staffer who opens
    // the wrong diver's record never puts a real physician's evaluation into
    // the bucket with no row pointing at it (security review H2).
    const { db, shop, booking, staff } = await heldContext();
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(true);
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now,
    });
    expect(await hasUnansweredMedicalHold(db, shop.id, booking.personId)).toBe(false);
  });

  it("walks a refused diver back to boardable through a new seat, and only through one", async () => {
    // The sentence the desk reads after a refusal now names this walk, so the
    // walk is a test rather than a claim. The person-level release is the
    // locked door it must never point at: a refusal is an unresolved hold, and
    // `issueWaiverRequest` answers `already_completed` to a record-level ask
    // forever after.
    const { db, shop, booking, person, staff } = await heldContext();
    const refusedAt = new Date(now.getTime() + 60_000);
    await recordMedicalEvaluation(db, {
      outcome: "not_cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: refusedAt,
    });

    const [refused] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(isUnresolvedMedicalHold(refused)).toBe(true);
    expect((await getBookingReadiness(db, shop.id, booking.id))?.blockers).toContainEqual(
      expect.objectContaining({ code: "medical_not_cleared" }),
    );

    // The locked door the sentence must not point at: nothing can be sent
    // against the seat that was refused. The record page offers no send at all
    // for a held release (`src/lib/diver-status.ts`), and the writer
    // agrees — this booking already carries a record that is not pending.
    const later = new Date(now.getTime() + 120_000);
    expect(
      await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now: later }),
    ).toEqual({ ok: false, reason: "already_completed" });

    const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const nextTrip = await createTrip(db, {
      shopId: shop.id,
      title: "Re-evaluated reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!nextTrip) throw new Error("trip insert failed");
    const [nextBooking] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: nextTrip.id,
        personId: person.id,
        status: "booked",
      })
      .returning();
    if (!nextBooking) throw new Error("booking insert failed");
    expect((await getBookingReadiness(db, shop.id, nextBooking.id))?.status).toBe("blocked");

    const issued = await issueWaiverRequest(db, {
      shopId: shop.id,
      bookingId: nextBooking.id,
      now: later,
    });
    if (!issued.ok) throw new Error(`the new seat's release was refused: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: later,
    });
    // A clean new release clears the diver without a second physician (Aaron,
    // 2026-10-07, issue #2158); the roster warns instead.
    const boarded = await getBookingReadiness(db, shop.id, nextBooking.id);
    expect(boarded?.status).toBe("ready");
    expect(boarded?.blockers).toEqual([]);

    // The refusal is history, not something the new release erased or amended.
    const [stillRefused] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, refused.id));
    expect(stillRefused.medicalClearedAt).toBeNull();
    expect(stillRefused.medicalClearanceDeclinedAt).toEqual(refusedAt);
    expect((await getBookingReadiness(db, shop.id, booking.id))?.status).toBe("blocked");
  });

  it("clears a referral a rider's fresh link superseded, so the hold it keeps has a way out (H-20261006-medical-holds-every-departure)", async () => {
    // A superseded referral no physician cleared still holds every seat the
    // diver has (`isUnclearedReferral`), so the physician's evaluation must
    // still reach it: otherwise the desk is told "nothing to clear" about a
    // hold it can see, and only a clean re-sign, never the physician, ends it.
    const { db, shop, booking, person, staff } = await heldContext();
    await db
      .update(bookings)
      .set({ participantType: "rider", bookedAs: "rider" })
      .where(eq(bookings.id, booking.id));
    const longAgo = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000);
    await db
      .update(waiverRecords)
      .set({ signedAt: longAgo, completedAt: longAgo, consentedAt: longAgo })
      .where(eq(waiverRecords.bookingId, booking.id));
    const [referral] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    const fresh = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!fresh.ok) throw new Error(`the rider's fresh link was refused: ${fresh.reason}`);
    const [superseded] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, referral.id));
    expect(superseded.supersededAt).toEqual(now);

    const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const diveTrip = await createTrip(db, {
      shopId: shop.id,
      title: "Referral still open reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!diveTrip) throw new Error("trip insert failed");
    const [diving] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: diveTrip.id,
        personId: person.id,
        status: "booked",
      })
      .returning();
    if (!diving) throw new Error("booking insert failed");
    const divingRow = async () =>
      (await listTripReadiness(db, shop.id, diveTrip.id)).find(
        (row) => row.booking.id === diving.id,
      );
    const medicalCodes = async () =>
      ((await divingRow())?.readiness.blockers ?? [])
        .map((blocker) => blocker.code)
        .filter((code) => code.startsWith("medical_"));
    expect(await medicalCodes()).toEqual(["medical_review"]);

    expect(await hasUnansweredMedicalHold(db, shop.id, person.id)).toBe(true);
    const clearedAt = new Date(now.getTime() + 60_000);
    const outcome = await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: person.id,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: clearedAt,
    });
    expect(outcome).toMatchObject({ ok: true, recordId: referral.id, alreadyRecorded: false });
    expect(await hasUnansweredMedicalHold(db, shop.id, person.id)).toBe(false);
    expect(await medicalCodes()).toEqual([]);

    // The rider signs the fresh link clean: the referral it stands over was
    // answered by a physician, so no seat warns that it stood over one.
    const signedAt = new Date(now.getTime() + 120_000);
    await completeWaiver(db, fresh.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      now: signedAt,
    });
    expect((await divingRow())?.overriddenReferral).toBeNull();
  });

  it("answers the seat's live hold before a newer superseded one, so the seat it holds clears (S2)", async () => {
    // An older live hold on one seat and a newer referral superseded off
    // another. The physician's answer must reach the live one first: landing
    // on the superseded record would leave the seat's own hold standing and
    // tell the desk the clearance was recorded.
    const { db, shop, booking, person, staff } = await heldContext();
    const [live] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.bookingId, booking.id));
    if (!live) throw new Error("expected the live hold");

    const startsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const otherTrip = await createTrip(db, {
      shopId: shop.id,
      title: "Second referral reef",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * 60 * 60 * 1000),
      capacity: 8,
      plannedDives: 2,
    });
    if (!otherTrip) throw new Error("trip insert failed");
    const [other] = await db
      .insert(bookings)
      .values({
        bookedAs: "diver",
        shopId: shop.id,
        tripId: otherTrip.id,
        personId: person.id,
        status: "booked",
      })
      .returning();
    if (!other) throw new Error("booking insert failed");
    const later = new Date(now.getTime() + 60 * 60 * 1000);
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: other.id, now });
    if (!issued.ok) throw new Error(`the second link was refused: ${issued.reason}`);
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: medicalReferralAnswers,
      now: later,
    });
    const [newer] = await db
      .update(waiverRecords)
      .set({ supersededAt: new Date(later.getTime() + 60_000) })
      .where(and(eq(waiverRecords.bookingId, other.id), eq(waiverRecords.status, "medical_review")))
      .returning();
    if (!newer) throw new Error("expected the newer referral to supersede");

    const answer = () =>
      recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        physicianName: "Dr. Imani Reyes",
        now: new Date(later.getTime() + 120_000),
      });
    expect(await answer()).toMatchObject({ ok: true, recordId: live.id, alreadyRecorded: false });
    // The newer referral is its own disclosure and still needs its own answer.
    expect(await hasUnansweredMedicalHold(db, shop.id, person.id)).toBe(true);
    expect(await answer()).toMatchObject({ ok: true, recordId: newer.id, alreadyRecorded: false });
    expect(await hasUnansweredMedicalHold(db, shop.id, person.id)).toBe(false);
    const after = await getBookingReadiness(db, shop.id, booking.id);
    expect(after?.blockers ?? []).not.toContainEqual(
      expect.objectContaining({ code: "medical_review" }),
    );
  });

  it("destroys the physician's evaluation when the diver is erased, and keeps the fact", async () => {
    const { db, shop, booking, staff } = await heldContext();
    await recordMedicalEvaluation(db, {
      outcome: "cleared",
      shopId: shop.id,
      personId: booking.personId,
      recordedByPersonId: staff.id,
      evaluatedOn: EVALUATED_ON,
      documentUrl: "https://media.example.com/medical-clearances/abc.pdf",
      now,
    });
    await anonymizeDiver(db, {
      shopId: shop.id,
      personId: booking.personId,
      actorPersonId: staff.id,
    });
    const [record] = await db
      .select()
      .from(waiverRecords)
      .where(
        and(eq(waiverRecords.bookingId, booking.id), eq(waiverRecords.status, "medical_review")),
      );
    expect(record.medicalClearanceDocumentUrl).toBeNull();
    // The shop's own act survives, as the certification sighting does.
    expect(record.medicalClearedAt).not.toBeNull();
    expect(record.medicalClearedByPersonId).toBe(staff.id);
  });
});
