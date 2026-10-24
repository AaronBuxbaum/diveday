import { and, eq, ne } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { recordDiverActivity } from "./operations";
import {
  activityEvents,
  bookings,
  mediaDeletionAttempts,
  people,
  shops,
  trips,
  waiverRecords,
} from "./schema";
import { listStaff } from "./trips";
import { completeWaiver, getWaiverForToken } from "./waivers-completion";
import {
  attachDiverMedicalForm,
  diverMedicalFormOpen,
  getDiverMedicalForm,
  getDiverMedicalFormForHold,
  getDoctorReferral,
  recordMedicalEvaluation,
  rejectDiverMedicalForm,
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

const MEDIA = "https://media.example.com";
const FORM_URL = `${MEDIA}/medical-clearances/diver-form.jpg`;
const STAFF_URL = `${MEDIA}/medical-clearances/staff-letter.pdf`;
/** After the referral was signed (`now`), and not in the future. */
const EVALUATED_ON = "2026-07-18";
const later = new Date(now.getTime() + 60_000);

// A URL only counts as one of DiveDay's own objects, and so only gets a
// deletion row, when media storage is configured (`isManagedStorageUrl`).
beforeEach(() => {
  vi.stubEnv("MEDIA_BUCKET_NAME", "diveday-media");
  vi.stubEnv("MEDIA_AWS_REGION", "us-east-1");
  vi.stubEnv("MEDIA_AWS_ACCESS_KEY_ID", "AKIA-test");
  vi.stubEnv("MEDIA_AWS_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("MEDIA_PUBLIC_URL_BASE", MEDIA);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * **The signed doctor's form a referred diver sends from the doctor's page**
 * (issue #2797, ADR 20261024-diver-sent-doctors-form). One file per release,
 * only while it waits on a physician, read back by shop, and gone from the
 * column once a physician's answer is recorded: used as the evaluation, or
 * deleted.
 */
describe("the doctor's form a diver sends", () => {
  async function signed(medicalAnswers: typeof clearAnswers = medicalReferralAnswers) {
    const context = await waiverContext();
    const { db, shop, booking, person } = context;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    await completeWaiver(db, issued.token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers,
      now,
    });
    const record = await recordFor(db, issued.token);
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("demo staff missing");
    return { ...context, token: issued.token, record, staff: staff.person };
  }

  async function recordFor(db: Awaited<ReturnType<typeof waiverContext>>["db"], token: string) {
    const state = await getWaiverForToken(db, token, now);
    if (state.state !== "completed") throw new Error("expected a completed record");
    return state.record;
  }

  async function deletionsQueued(db: Awaited<ReturnType<typeof waiverContext>>["db"]) {
    return (await db.select({ url: mediaDeletionAttempts.url }).from(mediaDeletionAttempts)).map(
      (row) => row.url,
    );
  }

  it("takes one form for a held release, and says so on the doctor's page", async () => {
    const { db, token, record } = await signed();
    expect(await diverMedicalFormOpen(db, record)).toBe("open");
    expect(await getDoctorReferral(db, record)).toMatchObject({ formSent: false });

    expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("sent");

    const after = await recordFor(db, token);
    expect(after.diverMedicalFormUrl).toBe(FORM_URL);
    expect(after.diverMedicalFormSentAt).toEqual(later);
    expect(await diverMedicalFormOpen(db, after)).toBe("sent");
    expect(await getDoctorReferral(db, after)).toMatchObject({ formSent: true });
  });

  it("never lets a second send replace the first, even from a stale read of the link", async () => {
    const { db, token, record } = await signed();
    expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("sent");
    // The same link again, read before the first send landed: the record the
    // caller holds says nothing was sent, and the write still refuses.
    expect(await attachDiverMedicalForm(db, record, `${MEDIA}/medical-clearances/other.jpg`)).toBe(
      "already",
    );
    expect((await recordFor(db, token)).diverMedicalFormUrl).toBe(FORM_URL);
  });

  it("takes nothing for a clean release", async () => {
    const { db, record } = await signed(clearAnswers);
    expect(await diverMedicalFormOpen(db, record)).toBe("closed");
    expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("closed");
  });

  it("takes nothing once a physician's answer is recorded, either way", async () => {
    for (const outcome of ["cleared", "not_cleared"] as const) {
      const { db, shop, person, staff, token, record } = await signed();
      const answered = await recordMedicalEvaluation(db, {
        outcome,
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        physicianName: "Dr. Imani Reyes",
        now: later,
      });
      expect(answered).toMatchObject({ ok: true });
      // The stale record the link resolved before the answer, and a fresh one.
      expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("closed");
      expect(await diverMedicalFormOpen(db, await recordFor(db, token))).toBe("closed");
      await setAside(db, record.id);
    }
  });

  it("takes nothing for an erased or removed diver, a canceled seat or a departure long over", async () => {
    // The link was read before the erasure: the record in hand still looks
    // held, and the write's own guard refuses it.
    const erased = await signed();
    await erased.db
      .update(waiverRecords)
      .set({ anonymizedAt: later })
      .where(eq(waiverRecords.id, erased.record.id));
    expect(await attachDiverMedicalForm(erased.db, erased.record, FORM_URL, later)).toBe("closed");
    await setAside(erased.db, erased.record.id);

    const removed = await signed();
    await removed.db
      .update(people)
      .set({ deletedAt: later })
      .where(eq(people.id, removed.person.id));
    expect(await attachDiverMedicalForm(removed.db, removed.record, FORM_URL, later)).toBe(
      "closed",
    );
    await removed.db
      .update(people)
      .set({ deletedAt: null })
      .where(eq(people.id, removed.person.id));
    await setAside(removed.db, removed.record.id);

    const { db, booking, record } = await signed();
    await db.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, booking.id));
    expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("closed");
    await db.update(bookings).set({ status: "booked" }).where(eq(bookings.id, booking.id));
    const longAgo = new Date("2020-01-01T12:00:00.000Z");
    await db
      .update(trips)
      .set({ startsAt: new Date(longAgo.getTime() - 3_600_000), endsAt: longAgo })
      .where(eq(trips.id, booking.tripId));
    expect(await attachDiverMedicalForm(db, record, FORM_URL, later)).toBe("closed");
  });

  it("is refused by the database on a clean release or beside a recorded answer", async () => {
    const { db, record } = await signed(clearAnswers);
    // Each refused write in its own savepoint, so the test's transaction lives on.
    await expect(
      db.transaction((tx) =>
        tx
          .update(waiverRecords)
          .set({ diverMedicalFormUrl: FORM_URL, diverMedicalFormSentAt: later })
          .where(eq(waiverRecords.id, record.id)),
      ),
    ).rejects.toThrow();
    await setAside(db, record.id);

    const held = await signed();
    await recordMedicalEvaluation(held.db, {
      outcome: "cleared",
      shopId: held.shop.id,
      personId: held.person.id,
      recordedByPersonId: held.staff.id,
      evaluatedOn: EVALUATED_ON,
      physicianName: "Dr. Imani Reyes",
      now: later,
    });
    await expect(
      held.db.transaction((tx) =>
        tx
          .update(waiverRecords)
          .set({ diverMedicalFormUrl: FORM_URL, diverMedicalFormSentAt: later })
          .where(eq(waiverRecords.id, held.record.id)),
      ),
    ).rejects.toThrow();
  });

  it("is read back only by its own shop, and never through an erased record", async () => {
    const { db, shop, person, record } = await signed();
    await attachDiverMedicalForm(db, record, FORM_URL, later);
    expect(await getDiverMedicalForm(db, shop.id, record.id)).toEqual({
      url: FORM_URL,
      personId: person.id,
    });
    const other = await otherShopId(db);
    expect(await getDiverMedicalForm(db, other, record.id)).toBeNull();
    expect(await getDiverMedicalForm(db, shop.id, "not-a-uuid")).toBeNull();
    expect(await getDiverMedicalFormForHold(db, shop.id, person.id)).toEqual({
      recordId: record.id,
      sentAt: later,
    });
    expect(await getDiverMedicalFormForHold(db, other, person.id)).toBeNull();
    await db
      .update(waiverRecords)
      .set({ anonymizedAt: later })
      .where(eq(waiverRecords.id, record.id));
    expect(await getDiverMedicalForm(db, shop.id, record.id)).toBeNull();
    expect(await getDiverMedicalFormForHold(db, shop.id, person.id)).toBeNull();
  });

  /** The trail line the staff route writes when this staffer opens the form. */
  async function opened(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    shopId: string,
    personId: string,
    actorPersonId: string,
    recordId: string,
  ) {
    expect(
      await recordDiverActivity(db, {
        shopId,
        personId,
        actorPersonId,
        code: "diver_medical_form_opened",
        waiverRecordId: recordId,
      }),
    ).toBe(true);
  }

  async function trail(db: Awaited<ReturnType<typeof waiverContext>>["db"], code: string) {
    return db
      .select({ actor: activityEvents.actorPersonId, subject: activityEvents.subjectPersonId })
      .from(activityEvents)
      .where(eq(activityEvents.code, code));
  }

  it("becomes the evaluation only for a staffer who opened it and typed the physician", async () => {
    const { db, shop, person, staff, token, record } = await signed();
    await attachDiverMedicalForm(db, record, FORM_URL, later);
    const answer = (physicianName: string | null) =>
      recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        diverFormRecordId: record.id,
        physicianName,
        now: later,
      });
    // The tick alone: a photo of anything would clear the diver.
    expect(await answer(null)).toEqual({ ok: false, reason: "diver_form_physician_required" });
    // A name typed without opening the form is not a reading of it.
    expect(await answer("Dr. Imani Reyes")).toEqual({ ok: false, reason: "diver_form_not_opened" });
    // Another staffer's open does not count for this one.
    const [other] = (await listStaff(db, shop.id)).filter((entry) => entry.person.id !== staff.id);
    if (other) {
      await opened(db, shop.id, person.id, other.person.id, record.id);
      expect(await answer("Dr. Imani Reyes")).toEqual({
        ok: false,
        reason: "diver_form_not_opened",
      });
    }
    expect((await recordFor(db, token)).medicalClearedAt).toBeNull();

    await opened(db, shop.id, person.id, staff.id, record.id);
    expect(await answer("Dr. Imani Reyes")).toMatchObject({ ok: true, alreadyRecorded: false });
    const after = await recordFor(db, token);
    expect(after.medicalClearanceDocumentUrl).toBe(FORM_URL);
    expect(after.medicalClearanceDocumentFromDiver).toBe(true);
    expect(after.diverMedicalFormUrl).toBeNull();
    // The fact stays; the file now lives in one column only.
    expect(after.diverMedicalFormSentAt).toEqual(later);
    expect(await deletionsQueued(db)).not.toContain(FORM_URL);
    expect(await getDiverMedicalFormForHold(db, shop.id, person.id)).toBeNull();
    // Who accepted it, on the diver's trail.
    expect(await trail(db, "medical_diver_form_accepted")).toEqual([
      { actor: staff.id, subject: person.id },
    ]);
  });

  it("does not count an open of an earlier form the staffer turned away", async () => {
    const { db, shop, person, staff, token, record } = await signed();
    await attachDiverMedicalForm(db, record, FORM_URL, later);
    await opened(db, shop.id, person.id, staff.id, record.id);
    expect(
      await rejectDiverMedicalForm(db, {
        shopId: shop.id,
        personId: person.id,
        recordId: record.id,
        actorPersonId: staff.id,
      }),
    ).toEqual({ ok: true });
    const resent = new Date("2026-07-22T09:00:00.000Z");
    expect(await attachDiverMedicalForm(db, await recordFor(db, token), STAFF_URL, resent)).toBe(
      "sent",
    );
    expect(
      await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        diverFormRecordId: record.id,
        physicianName: "Dr. Imani Reyes",
        now: resent,
      }),
    ).toEqual({ ok: false, reason: "diver_form_not_opened" });
  });

  it("can be turned away by staff, which deletes it and lets the diver send again", async () => {
    const { db, shop, person, staff, token, record } = await signed();
    await attachDiverMedicalForm(db, record, FORM_URL, later);
    const reject = (input: Partial<Parameters<typeof rejectDiverMedicalForm>[1]>) =>
      rejectDiverMedicalForm(db, {
        shopId: shop.id,
        personId: person.id,
        recordId: record.id,
        actorPersonId: staff.id,
        ...input,
      });
    // Wrong shop, wrong diver, not staff, not a record: nothing moves.
    expect(await reject({ shopId: await otherShopId(db) })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await reject({ actorPersonId: person.id })).toEqual({
      ok: false,
      reason: "not_authorized",
    });
    expect(await reject({ personId: staff.id })).toEqual({ ok: false, reason: "no_form" });
    expect(await reject({ recordId: "not-a-uuid" })).toEqual({ ok: false, reason: "no_form" });
    expect((await recordFor(db, token)).diverMedicalFormUrl).toBe(FORM_URL);

    expect(await reject({})).toEqual({ ok: true });
    const after = await recordFor(db, token);
    expect(after.diverMedicalFormUrl).toBeNull();
    expect(after.diverMedicalFormSentAt).toBeNull();
    expect(await deletionsQueued(db)).toContain(FORM_URL);
    expect(await trail(db, "medical_diver_form_not_used")).toEqual([
      { actor: staff.id, subject: person.id },
    ]);
    expect(await reject({})).toEqual({ ok: false, reason: "no_form" });
    // The slot is open again, for the link only through the page's own gate.
    expect(await diverMedicalFormOpen(db, after)).toBe("open");
    expect(await attachDiverMedicalForm(db, after, STAFF_URL, later)).toBe("sent");
  });

  it("is deleted when the staffer records the answer with evidence of their own", async () => {
    for (const evidence of [{ physicianName: "Dr. Imani Reyes" }, { documentUrl: STAFF_URL }]) {
      const { db, shop, person, staff, token, record } = await signed();
      await attachDiverMedicalForm(db, record, FORM_URL, later);
      const answered = await recordMedicalEvaluation(db, {
        outcome: "not_cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        // A staff file wins over the diver's, ticked or not.
        diverFormRecordId: "documentUrl" in evidence ? record.id : null,
        ...evidence,
        now: later,
      });
      expect(answered).toMatchObject({ ok: true });
      const after = await recordFor(db, token);
      expect(after.diverMedicalFormUrl).toBeNull();
      expect(after.medicalClearanceDocumentUrl).toBe(evidence.documentUrl ?? null);
      expect(await deletionsQueued(db)).toContain(FORM_URL);
      // A form received and not used says so, and who decided.
      expect(await trail(db, "medical_diver_form_not_used")).toEqual([
        { actor: staff.id, subject: person.id },
      ]);
      await setAside(db, record.id);
      await db.delete(mediaDeletionAttempts);
      await db.delete(activityEvents).where(eq(activityEvents.code, "medical_diver_form_not_used"));
    }
  });

  it("never uses another diver's form, or one that is not there", async () => {
    const { db, shop, person, staff, token, record } = await signed();
    // Somebody else's held release at this shop, with a form on it.
    const [stranger] = await db
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.shopId, shop.id), ne(people.id, person.id)))
      .limit(1);
    if (!stranger) throw new Error("expected a second person at the demo shop");
    const [foreign] = await db
      .insert(waiverRecords)
      .values({
        ...withoutIdentity(record),
        personId: stranger.id,
        bookingId: null,
        diverMedicalFormUrl: `${MEDIA}/medical-clearances/stranger.jpg`,
        diverMedicalFormSentAt: later,
      })
      .returning({ id: waiverRecords.id });
    if (!foreign) throw new Error("expected the stranger's release");
    for (const diverFormRecordId of [foreign.id, record.id]) {
      const refused = await recordMedicalEvaluation(db, {
        outcome: "cleared",
        shopId: shop.id,
        personId: person.id,
        recordedByPersonId: staff.id,
        evaluatedOn: EVALUATED_ON,
        diverFormRecordId,
        now: later,
      });
      expect(refused).toEqual({ ok: false, reason: "evidence_required" });
    }
    expect((await recordFor(db, token)).medicalClearedAt).toBeNull();
  });

  it("is destroyed when the diver is erased, and the day it arrived stays", async () => {
    const { db, shop, person, staff, record } = await signed();
    await attachDiverMedicalForm(db, record, FORM_URL, later);
    await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: staff.id });
    const [after] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, record.id));
    expect(after?.diverMedicalFormUrl).toBeNull();
    expect(after?.diverMedicalFormSentAt).toEqual(later);
    expect(await deletionsQueued(db)).toContain(FORM_URL);
  });
});

/** Supersede a release so the same seat can sign again within one test. */
async function setAside(db: Awaited<ReturnType<typeof waiverContext>>["db"], recordId: string) {
  await db
    .update(waiverRecords)
    .set({ supersededAt: new Date(now.getTime() + 30_000) })
    .where(eq(waiverRecords.id, recordId));
}

/** A second shop, so a read scoped to it must find nothing at the first. */
async function otherShopId(db: Awaited<ReturnType<typeof waiverContext>>["db"]) {
  const [other] = await db
    .insert(shops)
    .values({ name: "Other Shop", slug: "other-shop-2797", timezone: "UTC" })
    .returning({ id: shops.id });
  if (!other) throw new Error("expected a second shop");
  return other.id;
}

/** A copy of a release's columns for a second row, without its identity or seal. */
function withoutIdentity(record: typeof waiverRecords.$inferSelect) {
  const {
    id: _id,
    tokenSealed: _sealed,
    integrityHash: _integrity,
    integrityVersion: _version,
    ...rest
  } = record;
  return { ...rest, tokenHash: `stranger-${record.id}` };
}
