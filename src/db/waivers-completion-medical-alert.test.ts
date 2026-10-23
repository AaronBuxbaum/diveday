import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MEDICAL_ALERT_MAX } from "@/lib/medical-alert";
import { verifyWaiverIntegrity } from "@/lib/waiver-integrity";
import { fileScopedShopContext } from "@/test/db";
import { anonymizeDiver } from "./anonymize";
import { listTripReadiness } from "./readiness";
import { people, personRoles, waiverRecords } from "./schema";
import { completeWaiver, getWaiverForToken, saveWaiverDraft } from "./waivers-completion";
import { issueWaiverRequest } from "./waivers-requests";
import { saveWaiverTemplate } from "./waivers-templates";
import {
  clearAnswers,
  medicalReferralAnswers,
  now,
  waiverContextFor,
} from "./waivers-test-fixtures";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`), as in waivers-completion.test.ts.
const fileCtx = fileScopedShopContext();
const waiverContext = waiverContextFor(fileCtx);

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * **The medical alert for the crew** (glossary *Medical alert for the crew*,
 * issue #2960). Stored and sealed with the signature; it informs and never
 * gates: no status, medical review or readiness moves with what it says.
 */
describe("the medical alert for the crew on the waiver", () => {
  const alert = "Bee-sting allergy. EpiPen in the blue dry bag.";
  /** The bypass the issue names: a heart condition written here, every standard answer No. */
  const bypass = "Stent placed in June, on blood thinners";

  async function link() {
    const context = await waiverContext();
    const { db, shop, booking } = context;
    const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: booking.id, now });
    if (!issued.ok) throw new Error("expected a waiver link");
    return { ...context, token: issued.token };
  }

  async function recordFor(db: Awaited<ReturnType<typeof waiverContext>>["db"], token: string) {
    const state = await getWaiverForToken(db, token, now);
    if (state.state === "unavailable") throw new Error("record missing");
    const [row] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, state.record.id))
      .limit(1);
    if (!row) throw new Error("record missing");
    return row;
  }

  async function readinessOf(
    db: Awaited<ReturnType<typeof waiverContext>>["db"],
    shopId: string,
    tripId: string,
    bookingId: string,
  ) {
    const rows = await listTripReadiness(db, shopId, tripId, now);
    const row = rows.find((candidate) => candidate.booking.id === bookingId);
    if (!row) throw new Error("booking missing from readiness");
    return row.readiness;
  }

  it("stores the alert as written, trimmed, inside the seal", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const { db, person, token } = await link();
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        medicalAlert: `  ${alert}\r\n`,
        now,
      }),
    ).toEqual({ ok: true, status: "completed", idempotent: false });
    const record = await recordFor(db, token);
    expect(record.medicalAlert).toBe(alert);
    expect(verifyWaiverIntegrity(record)).toBe("valid");
    expect(verifyWaiverIntegrity({ ...record, medicalAlert: null })).toBe("invalid");
    expect(verifyWaiverIntegrity({ ...record, medicalAlert: "Asthma" })).toBe("invalid");
  });

  it("stores nothing, never an empty string, when the box is blank or absent", async () => {
    const blank = await link();
    await completeWaiver(blank.db, blank.token, {
      signerName: blank.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: "   \n ",
      now,
    });
    expect((await recordFor(blank.db, blank.token)).medicalAlert).toBeNull();
  });

  /**
   * Adversarial (issue #2960): the questionnaire bypass. A heart condition in
   * the alert with every standard answer No completes as `completed`, with no
   * medical review, and readiness clears exactly as it would without it.
   */
  it("never gates: a heart condition in the alert with every answer No completes and clears readiness", async () => {
    const { db, shop, trip, booking, person, token } = await link();
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        medicalAlert: bypass,
        now,
      }),
    ).toEqual({ ok: true, status: "completed", idempotent: false });
    const record = await recordFor(db, token);
    expect(record.status).toBe("completed");
    expect(record.medicalReviewRequired).toBe(false);
    expect(record.medicalAlert).toBe(bypass);
    const withAlert = await readinessOf(db, shop.id, trip.id, booking.id);
    // The same release with the alert lifted off: readiness must not move.
    await db
      .update(waiverRecords)
      .set({ medicalAlert: null })
      .where(eq(waiverRecords.id, record.id));
    const withoutAlert = await readinessOf(db, shop.id, trip.id, booking.id);
    expect(withAlert).toEqual(withoutAlert);
    // The signature cleared every waiver and medical blocker on the seat.
    expect(
      withAlert.blockers
        .map((blocker) => blocker.code)
        .filter((code) => code.startsWith("waiver") || code.startsWith("medical")),
    ).toEqual([]);
  });

  it("still refers a medical yes to review, alert or not", async () => {
    const { db, person, token } = await link();
    expect(
      await completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: medicalReferralAnswers,
        medicalAlert: alert,
        now,
      }),
    ).toMatchObject({ ok: true, status: "medical_review" });
    expect((await recordFor(db, token)).medicalAlert).toBe(alert);
  });

  it("refuses an alert past the cap or carrying a control character before the record is touched", async () => {
    const { db, person, token } = await link();
    const sign = (medicalAlert: string) =>
      completeWaiver(db, token, {
        signerName: person.fullName,
        agreed: true,
        medicalAnswers: clearAnswers,
        medicalAlert,
        now,
      });
    expect(await sign("a".repeat(MEDICAL_ALERT_MAX + 1))).toEqual({
      ok: false,
      reason: "invalid_medical_alert",
    });
    expect(await sign("Asthma\u0000")).toEqual({ ok: false, reason: "invalid_medical_alert" });
    expect(await sign("Asthma\tinhaler")).toEqual({ ok: false, reason: "invalid_medical_alert" });
    expect(await getWaiverForToken(db, token, now)).toMatchObject({ state: "available" });
    expect((await recordFor(db, token)).medicalAlert).toBeNull();
    expect(await sign("a".repeat(MEDICAL_ALERT_MAX))).toMatchObject({ ok: true });
  });

  it("keeps the draft through Save and finish later, leaves it alone when the field is absent, and clears it on signing", async () => {
    const { db, person, token } = await link();
    expect(
      await saveWaiverDraft(db, token, {
        acknowledged: false,
        medicalAnswers: clearAnswers,
        medicalAlert: ` ${alert} `,
        now,
      }),
    ).toBe(true);
    expect((await recordFor(db, token)).draftMedicalAlert).toBe(alert);
    // A save that did not carry the section leaves the draft as it was.
    await saveWaiverDraft(db, token, { acknowledged: false, medicalAnswers: clearAnswers, now });
    expect((await recordFor(db, token)).draftMedicalAlert).toBe(alert);
    // A draft the signature would refuse is mended, not refused or lost.
    await saveWaiverDraft(db, token, {
      acknowledged: false,
      medicalAnswers: clearAnswers,
      medicalAlert: "a".repeat(MEDICAL_ALERT_MAX + 1),
      now,
    });
    expect((await recordFor(db, token)).draftMedicalAlert).toBe("a".repeat(MEDICAL_ALERT_MAX));
    await saveWaiverDraft(db, token, {
      acknowledged: false,
      medicalAnswers: clearAnswers,
      medicalAlert: alert,
      now,
    });
    await completeWaiver(db, token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: "Diabetic, glucose in my bag",
      now,
    });
    const record = await recordFor(db, token);
    expect(record.draftMedicalAlert).toBeNull();
    expect(record.medicalAlert).toBe("Diabetic, glucose in my bag");
  });

  it("signing again replaces it, including with nothing", async () => {
    const first = await link();
    await completeWaiver(first.db, first.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: alert,
      now,
    });
    // New terms the shop calls material: the signature lapses and the seat
    // takes a fresh one, the ordinary way a diver signs again.
    await saveWaiverTemplate(first.db, {
      shopId: first.shop.id,
      body: `${first.template.body}\n\nNew terms.`,
      material: true,
    });
    const second = await issueWaiverRequest(first.db, {
      shopId: first.shop.id,
      bookingId: first.booking.id,
      now,
    });
    if (!second.ok) throw new Error("expected a second link");
    await completeWaiver(first.db, second.token, {
      signerName: first.person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: "",
      now,
    });
    expect((await recordFor(first.db, second.token)).medicalAlert).toBeNull();
  });

  async function ownerOf(db: Awaited<ReturnType<typeof waiverContext>>["db"], shopId: string) {
    const [owner] = await db
      .select({ id: people.id })
      .from(people)
      .innerJoin(personRoles, eq(personRoles.personId, people.id))
      .where(and(eq(people.shopId, shopId), eq(personRoles.role, "owner")))
      .limit(1);
    if (!owner) throw new Error("expected the seeded owner");
    return owner.id;
  }

  it("is destroyed by erasure, signed and drafted, and the erased release verifies under version 2", async () => {
    vi.stubEnv("WAIVER_INTEGRITY_SECRET", "test-secret");
    const { db, person, shop, token } = await link();
    await completeWaiver(db, token, {
      signerName: person.fullName,
      agreed: true,
      medicalAnswers: clearAnswers,
      medicalAlert: alert,
      now,
    });
    const signed = await recordFor(db, token);
    const owner = await ownerOf(db, shop.id);
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: owner })).ok,
    ).toBe(true);
    const [erased] = await db
      .select()
      .from(waiverRecords)
      .where(eq(waiverRecords.id, signed.id))
      .limit(1);
    if (!erased) throw new Error("record missing");
    expect(erased.medicalAlert).toBeNull();
    expect(erased.draftMedicalAlert).toBeNull();
    expect(erased.integrityVersion).toBe(2);
    expect(verifyWaiverIntegrity(erased)).toBe("valid");
  });

  it("strips an unsigned draft alert on erasure", async () => {
    const { db, person, shop, token } = await link();
    await saveWaiverDraft(db, token, {
      acknowledged: false,
      medicalAnswers: clearAnswers,
      medicalAlert: alert,
      now,
    });
    const owner = await ownerOf(db, shop.id);
    expect(
      (await anonymizeDiver(db, { shopId: shop.id, personId: person.id, actorPersonId: owner })).ok,
    ).toBe(true);
    const rows = await db
      .select({ draft: waiverRecords.draftMedicalAlert, alert: waiverRecords.medicalAlert })
      .from(waiverRecords)
      .where(eq(waiverRecords.personId, person.id));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toEqual({ draft: null, alert: null });
  });
});
