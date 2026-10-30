import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import type { GuardianSigner } from "./guardian";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "./medical";
import { localTypedConsentProvider, namesakeAttestationProvider } from "./signatures";
import {
  DEFAULT_WAIVER_BODY,
  effectiveReleaseForRiderSeat,
  effectiveWaiverForBooking,
  isCleanCompletion,
  isCompletedWaiverCurrent,
  isSampleRelease,
  isUnresolvedMedicalHold,
  type MedicalWaiverMark,
  medicalWaiverMark,
  medicalWarningDays,
  needsMedicalReview,
  overriddenReferral,
  overriddenReferralAt,
  overriddenRefusal,
  releaseLapsedForBooking,
  riderMedicalHold,
  shopWaiverStatus,
  WAIVER_SIGNATURE_VALIDITY_MS,
  waiverState,
} from "./waivers";

const clear = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
const firstReferralId = RSTC_QUESTIONNAIRE.questions.find((q) => q.referral)?.id ?? "";

describe("waiver domain rules", () => {
  it("fails medical readiness closed when any referral answer is yes", () => {
    expect(needsMedicalReview(clear)).toBe(false);
    expect(
      needsMedicalReview({ ...clear, responses: { ...clear.responses, [firstReferralId]: true } }),
    ).toBe(true);
    // Unknown questionnaire with a yes fails closed.
    expect(
      needsMedicalReview({
        questionnaireId: "unknown",
        questionnaireVersion: 1,
        responses: { x: true },
      }),
    ).toBe(true);
  });

  it("requires both a real typed name and affirmative consent", () => {
    expect(localTypedConsentProvider.capture({ signerName: "A", agreed: true })).toBeNull();
    expect(
      localTypedConsentProvider.capture({ signerName: "Nora Quinn", agreed: false }),
    ).toBeNull();
    expect(
      localTypedConsentProvider.capture({ signerName: "  Nora Quinn  ", agreed: true }),
    ).toMatchObject({
      method: "typed_consent",
      signerName: "Nora Quinn",
    });
  });

  /**
   * The namesake co-signature's own provider (issue #1573): the same shape and
   * the same two refusals as the attestation it sits beside, distinguished
   * only by the method it writes — which is the whole of what it is for, since
   * nothing branches on the value except the seal and the export bundle.
   */
  it("captures a namesake co-signature under its own method", () => {
    expect(namesakeAttestationProvider.capture({ signerName: "A", agreed: true })).toBeNull();
    expect(
      namesakeAttestationProvider.capture({ signerName: "Nora Quinn", agreed: false }),
    ).toBeNull();
    expect(
      namesakeAttestationProvider.capture({ signerName: "  Nora Quinn  ", agreed: true }),
    ).toMatchObject({
      method: "in_person_attested_namesake",
      signerName: "Nora Quinn",
    });
  });

  it("treats a pending past-deadline record as expired rather than ready", () => {
    const record = {
      status: "pending",
      expiresAt: new Date("2026-07-18T00:00:00.000Z"),
    } as Parameters<typeof waiverState>[0];
    expect(waiverState(record, new Date("2026-07-18T00:00:01.000Z"))).toBe("expired");
  });
});

const SIGN_NOW = new Date("2026-07-18T12:00:00.000Z");

function completedWaiver(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
  return {
    id: "record-1",
    bookingId: "booking-1",
    personId: "person-1",
    status: "completed",
    templateVersion: 1,
    templateGeneration: 1,
    signedAt,
    completedAt: signedAt,
    supersededAt: null,
    expiresAt: new Date(SIGN_NOW.getTime() - 30_000),
    createdAt: new Date(SIGN_NOW.getTime() - 120_000),
    ...overrides,
  } as WaiverRecord;
}

describe("waiver signature currency", () => {
  it("stands only for a clean, current-version, in-window completion", () => {
    expect(isCompletedWaiverCurrent(completedWaiver(), 1, SIGN_NOW)).toBe(true);
    // A shop edit bumps the version: old terms no longer count.
    expect(isCompletedWaiverCurrent(completedWaiver(), 2, SIGN_NOW)).toBe(false);
    // No current template to compare against skips the version gate.
    expect(isCompletedWaiverCurrent(completedWaiver(), null, SIGN_NOW)).toBe(true);
    // Medical-review and superseded records never stand.
    expect(
      isCompletedWaiverCurrent(completedWaiver({ status: "medical_review" }), 1, SIGN_NOW),
    ).toBe(false);
    expect(isCompletedWaiverCurrent(completedWaiver({ supersededAt: SIGN_NOW }), 1, SIGN_NOW)).toBe(
      false,
    );
  });

  it("ages out one validity window after signing", () => {
    const signedAt = new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1);
    const stale = completedWaiver({ signedAt, completedAt: signedAt });
    expect(isCompletedWaiverCurrent(stale, 1, SIGN_NOW)).toBe(false);
    const justInside = completedWaiver({
      signedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS + 1000),
    });
    expect(isCompletedWaiverCurrent(justInside, 1, SIGN_NOW)).toBe(true);
  });

  it("stands today and not on a departure three weeks out, when the year runs out between", () => {
    const signedAt = new Date(
      SIGN_NOW.getTime() + 14 * 24 * 60 * 60 * 1000 - WAIVER_SIGNATURE_VALIDITY_MS,
    );
    const release = completedWaiver({ signedAt, completedAt: signedAt });
    const departure = new Date(SIGN_NOW.getTime() + 21 * 24 * 60 * 60 * 1000);
    expect(isCompletedWaiverCurrent(release, 1, SIGN_NOW)).toBe(true);
    expect(isCompletedWaiverCurrent(release, 1, departure)).toBe(false);
  });

  it("exempts an imported record from the template-version check, but not the age check", () => {
    // Signed against a template version DiveDay never issued — the version
    // gate would always (wrongly) read this as stale if it applied.
    const imported = completedWaiver({ signatureMethod: "imported", templateVersion: 0 });
    expect(isCompletedWaiverCurrent(imported, 1, SIGN_NOW)).toBe(true);
    expect(isCompletedWaiverCurrent(imported, 999, SIGN_NOW)).toBe(true);
    // The real acceptance date still ages it out exactly like any other.
    const staleImported = completedWaiver({
      signatureMethod: "imported",
      templateVersion: 0,
      signedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
    });
    expect(isCompletedWaiverCurrent(staleImported, 1, SIGN_NOW)).toBe(false);
    // Medical-review and superseded still short-circuit an imported record too.
    expect(
      isCompletedWaiverCurrent(
        completedWaiver({ signatureMethod: "imported", status: "medical_review" }),
        1,
        SIGN_NOW,
      ),
    ).toBe(false);
  });
});

describe("medical waiver mark", () => {
  const answers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

  it("marks a digital completion with its questionnaire date", () => {
    const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
    expect(medicalWaiverMark(completedWaiver({ medicalAnswers: answers, signedAt }))).toEqual({
      at: signedAt,
      source: "digital",
      overriddenReferralAt: null,
      overriddenReferral: null,
      overriddenRefusal: null,
      clearance: null,
      guardian: null,
    });
  });

  it("marks a staff paper attestation distinctly, so it never reads as missing", () => {
    const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
    expect(
      medicalWaiverMark(
        completedWaiver({
          medicalAnswers: null,
          signatureMethod: "in_person_attested",
          signedAt,
        }),
      ),
    ).toEqual({
      at: signedAt,
      source: "paper",
      overriddenReferralAt: null,
      overriddenReferral: null,
      overriddenRefusal: null,
      clearance: null,
      guardian: null,
    });
  });

  it("marks an imported acceptance distinctly, even though it carries no questionnaire", () => {
    const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
    expect(
      medicalWaiverMark(
        completedWaiver({ medicalAnswers: null, signatureMethod: "imported", signedAt }),
      ),
    ).toEqual({
      at: signedAt,
      source: "imported",
      overriddenReferralAt: null,
      overriddenReferral: null,
      overriddenRefusal: null,
      clearance: null,
      guardian: null,
    });
  });

  it("surfaces nothing for an in-review, unrecognized, or absent record", () => {
    expect(
      medicalWaiverMark(completedWaiver({ status: "medical_review", medicalAnswers: answers })),
    ).toBeNull();
    // A completion with neither a questionnaire nor the paper method is unknown.
    expect(
      medicalWaiverMark(
        completedWaiver({ medicalAnswers: null, signatureMethod: "typed_consent" }),
      ),
    ).toBeNull();
    expect(medicalWaiverMark(null)).toBeNull();
  });

  it("falls back to completedAt when signedAt is somehow missing", () => {
    const completedAt = new Date(SIGN_NOW.getTime() - 5_000);
    expect(
      medicalWaiverMark(completedWaiver({ medicalAnswers: answers, signedAt: null, completedAt })),
    ).toEqual({
      at: completedAt,
      source: "digital",
      overriddenReferralAt: null,
      overriddenReferral: null,
      overriddenRefusal: null,
      clearance: null,
      guardian: null,
    });
  });
});

describe("effective waiver (sign once per diver)", () => {
  const args = (over: Partial<Parameters<typeof effectiveWaiverForBooking>[0]>) => ({
    bookingWaiver: null,
    personSignedWaivers: [],
    currentTemplateVersion: 1 as number | null,
    now: SIGN_NOW,
    ...over,
  });

  it("carries a current completed release onto a booking with no signature", () => {
    const carried = completedWaiver({ bookingId: "other-booking" });
    const effective = effectiveWaiverForBooking(args({ personSignedWaivers: [carried] }));
    expect(effective).toBe(carried);
    expect(waiverState(effective, SIGN_NOW)).toBe("complete");
  });

  it("does not carry a stale or wrong-version release — the booking still needs one", () => {
    const staleVersion = completedWaiver({
      templateVersion: 0,
      templateGeneration: 0,
      bookingId: "other",
    });
    expect(effectiveWaiverForBooking(args({ personSignedWaivers: [staleVersion] }))).toBeNull();
    // Falls through to not_sent, so staff are prompted to send a fresh link.
    expect(
      waiverState(
        effectiveWaiverForBooking(args({ personSignedWaivers: [staleVersion] })),
        SIGN_NOW,
      ),
    ).toBe("not_sent");
  });

  it("keeps the booking's own medical-review record over a carried clean waiver", () => {
    const ownReview = completedWaiver({ status: "medical_review", bookingId: "booking-1" });
    const carried = completedWaiver({ bookingId: "other" });
    const effective = effectiveWaiverForBooking(
      args({ bookingWaiver: ownReview, personSignedWaivers: [carried] }),
    );
    expect(effective).toBe(ownReview);
    expect(waiverState(effective, SIGN_NOW)).toBe("medical_review");
  });

  it("satisfies a booking whose own link is still pending once a valid release exists", () => {
    const pending = {
      status: "pending",
      expiresAt: new Date(SIGN_NOW.getTime() + 1000),
    } as WaiverRecord;
    const carried = completedWaiver({ bookingId: "other" });
    const effective = effectiveWaiverForBooking(
      args({ bookingWaiver: pending, personSignedWaivers: [carried] }),
    );
    expect(effective).toBe(carried);
  });

  it("picks the most recently signed release when several are on file", () => {
    const older = completedWaiver({
      id: "older",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    const newer = completedWaiver({ id: "newer", signedAt: new Date(SIGN_NOW.getTime() - 10_000) });
    const effective = effectiveWaiverForBooking(args({ personSignedWaivers: [older, newer] }));
    expect(effective?.id).toBe("newer");
  });

  it("does not let a clean signature carry a diver past a newer medical hold", () => {
    const cleanJan = completedWaiver({
      id: "clean-jan",
      bookingId: "a",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    const holdJun = completedWaiver({
      id: "hold-jun",
      bookingId: "c",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 50_000),
      completedAt: new Date(SIGN_NOW.getTime() - 50_000),
    });
    // Booking D has no record of its own; the clean January signature would
    // carry, but the unresolved June hold is newer, so it must block instead.
    const effective = effectiveWaiverForBooking(args({ personSignedWaivers: [cleanJan, holdJun] }));
    expect(effective?.id).toBe("hold-jun");
    expect(waiverState(effective, SIGN_NOW)).toBe("medical_review");
  });

  it("lets a clean signature made after a hold supersede it", () => {
    const holdOld = completedWaiver({
      id: "hold-old",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
      completedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    const cleanNew = completedWaiver({
      id: "clean-new",
      signedAt: new Date(SIGN_NOW.getTime() - 10_000),
    });
    const effective = effectiveWaiverForBooking(args({ personSignedWaivers: [holdOld, cleanNew] }));
    expect(effective?.id).toBe("clean-new");
  });

  it("stops trusting the booking's own signature once it ages out or the release changes", () => {
    const staleOwn = completedWaiver({
      id: "own-stale",
      signedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
      completedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
    });
    expect(effectiveWaiverForBooking(args({ bookingWaiver: staleOwn }))).toBeNull();

    const oldVersionOwn = completedWaiver({
      id: "own-v0",
      templateVersion: 0,
      templateGeneration: 0,
    });
    expect(effectiveWaiverForBooking(args({ bookingWaiver: oldVersionOwn }))).toBeNull();

    // A current own signature still stands.
    const currentOwn = completedWaiver({ id: "own-current" });
    expect(effectiveWaiverForBooking(args({ bookingWaiver: currentOwn }))?.id).toBe("own-current");
  });
});

/**
 * **A signed release that ran out is not one nobody sent** (dive-domain review
 * of the test-suite layer 1). Both block; the words and the fix differ, so the
 * engine needs to know which it is.
 */
describe("releaseLapsedForBooking", () => {
  const lapsedAt = new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1);
  const lapsed = completedWaiver({ signedAt: lapsedAt, completedAt: lapsedAt });
  const resolve = (overrides: Partial<Parameters<typeof releaseLapsedForBooking>[0]>) =>
    releaseLapsedForBooking({
      bookingWaiver: null,
      personSignedWaivers: [],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
      ...overrides,
    });

  it("is false for a diver who never signed here", () => {
    expect(resolve({})).toBe(false);
  });

  it("is true for a release signed on this booking that aged past its year", () => {
    expect(resolve({ bookingWaiver: lapsed, personSignedWaivers: [lapsed] })).toBe(true);
  });

  it("is true for a release signed on another booking that aged out", () => {
    expect(resolve({ personSignedWaivers: [lapsed] })).toBe(true);
  });

  it("is true for a release signed against terms the shop has since changed", () => {
    expect(resolve({ personSignedWaivers: [completedWaiver()], currentTemplateVersion: 2 })).toBe(
      true,
    );
  });

  it("is true for a cleared referral whose physician's evaluation is over a year old", () => {
    const cleared = completedWaiver({
      status: "medical_review",
      medicalClearedAt: SIGN_NOW,
      medicalClearanceEvaluatedOn: "2025-01-02",
    });
    expect(resolve({ personSignedWaivers: [cleared] })).toBe(true);
  });

  it("is false while a current release covers the seat", () => {
    expect(resolve({ personSignedWaivers: [lapsed, completedWaiver({ id: "record-2" })] })).toBe(
      false,
    );
  });

  it("is false once a fresh link is out: the seat reads as awaiting that signature", () => {
    const fresh = completedWaiver({
      id: "record-2",
      status: "pending",
      signedAt: null,
      completedAt: null,
      expiresAt: new Date(SIGN_NOW.getTime() + 60_000),
    });
    expect(resolve({ bookingWaiver: fresh, personSignedWaivers: [lapsed] })).toBe(false);
  });

  it("is false under an open medical hold, which outranks it", () => {
    const hold = completedWaiver({ id: "record-2", status: "medical_review" });
    expect(resolve({ personSignedWaivers: [lapsed, hold] })).toBe(false);
  });

  it("counts a signature a fresh link on another seat superseded (D2)", () => {
    // The evidence carries a superseded clean signature only from the
    // signer's own seat (`listSignedWaiversByPerson`); it still lapsed.
    expect(resolve({ personSignedWaivers: [{ ...lapsed, supersededAt: SIGN_NOW }] })).toBe(true);
  });

  it("reads a rider's lapsed release the same way, held record or not", () => {
    const parked = completedWaiver({
      status: "medical_review",
      signedAt: lapsedAt,
      completedAt: lapsedAt,
    });
    expect(resolve({ personSignedWaivers: [parked], heldToMedical: false })).toBe(true);
    expect(resolve({ personSignedWaivers: [completedWaiver()], heldToMedical: false })).toBe(false);
  });
});

/**
 * The diver record answers "has this person signed?" — a fact about the person
 * and the shop, not about any one booking. Before this, that question could
 * only be answered from inside a booking, so a diver with no booking yet had
 * no answer at all.
 */
describe("shop-level waiver standing", () => {
  const status = (records: WaiverRecord[], version: number | null = 1) =>
    shopWaiverStatus({
      personSignedWaivers: records,
      currentTemplateVersion: version,
      now: SIGN_NOW,
    });

  it("reads as never signed with no evidence at all", () => {
    expect(status([])).toEqual({ state: "none" });
  });

  it("reads a clean, current signature as good, with the date it runs out", () => {
    const record = completedWaiver();
    const result = status([record]);
    expect(result.state).toBe("current");
    if (result.state !== "current") throw new Error("unreachable");
    expect(result.signedAt).toEqual(record.signedAt);
    expect(result.expiresAt.getTime()).toBe(
      (record.signedAt as Date).getTime() + WAIVER_SIGNATURE_VALIDITY_MS,
    );
  });

  it("tells 'signed here before, needs signing again' apart from 'never signed'", () => {
    // Two ways a signature stops standing, and both are the same conversation
    // at the desk: sign again.
    const aged = completedWaiver({
      signedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
    });
    expect(status([aged])).toEqual({ state: "expired", signedAt: aged.signedAt });

    // A shop edit bumps the template: those are terms this diver never agreed to.
    const oldTerms = completedWaiver();
    expect(status([oldTerms], 2)).toEqual({ state: "expired", signedAt: oldTerms.signedAt });
  });

  it("carries the newest signature when several are on file", () => {
    const older = completedWaiver({
      id: "older",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
      completedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    const newer = completedWaiver({ id: "newer" });
    const result = status([older, newer]);
    expect(result.state).toBe("current");
    if (result.state !== "current") throw new Error("unreachable");
    expect(result.signedAt).toEqual(newer.signedAt);
  });

  it("fails closed to a medical hold made at or after the last clean signature", () => {
    const signed = completedWaiver({ id: "signed" });
    const hold = completedWaiver({
      id: "hold",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 30_000),
      completedAt: new Date(SIGN_NOW.getTime() - 30_000),
    });
    const result = status([signed, hold]);
    expect(result.state).toBe("medical_review");
  });

  it("lets a clean signature made *after* a resolved-looking hold stand", () => {
    // The hold is older than the signature, so the diver disclosed, was seen,
    // and signed afterwards. The signature is the later word.
    const hold = completedWaiver({
      id: "hold",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 500_000),
      completedAt: new Date(SIGN_NOW.getTime() - 500_000),
    });
    const signed = completedWaiver({ id: "signed" });
    expect(status([hold, signed]).state).toBe("current");
  });

  it("keeps a superseded referral no physician cleared as a hold (glossary: Medical hold)", () => {
    // Superseding moves the hold off its seat so the seat can take a fresh
    // link; only a clearance or a later clean release ends it.
    const hold = completedWaiver({
      id: "hold",
      status: "medical_review",
      supersededAt: SIGN_NOW,
    });
    expect(status([hold]).state).toBe("medical_review");
    const cleared = completedWaiver({
      id: "cleared",
      status: "medical_review",
      supersededAt: SIGN_NOW,
      medicalClearedAt: SIGN_NOW,
    });
    expect(status([cleared]).state).not.toBe("medical_review");
  });

  it("tells a refused evaluation apart from one nobody has answered", () => {
    // The whole of issue #1283 at the level the diver record reads: same block,
    // different sentence, and the refused letter reachable rather than stored
    // with no door back to it.
    const declinedAt = new Date(SIGN_NOW.getTime() + 60_000);
    const refused = completedWaiver({
      id: "refused",
      status: "medical_review",
      medicalClearanceDeclinedAt: declinedAt,
      medicalClearanceDeclinedByPersonId: "staff-1",
      medicalClearanceEvaluatedOn: "2026-07-18",
      medicalClearanceDocumentUrl: "https://media.example.com/medical-clearances/refused.pdf",
    });
    expect(status([refused])).toMatchObject({
      state: "medical_not_cleared",
      declinedAt,
      evaluation: { recordId: "refused", documentOnFile: true },
    });
    // And the gate is unmoved: a refusal is still an unresolved hold, still not
    // a clean completion, and still never a current release.
    expect(isUnresolvedMedicalHold(refused)).toBe(true);
    expect(isCleanCompletion(refused)).toBe(false);
    expect(isCompletedWaiverCurrent(refused, 1, SIGN_NOW)).toBe(false);
    expect(waiverState(refused, SIGN_NOW)).toBe("medical_not_cleared");
  });

  it("keeps a refusal out of the mark a manifest reads", () => {
    // `medicalWaiverMark` is what prints "cleared by a physician" at the rail.
    // A refusal must never reach it: the crew's line about this diver comes
    // from the blocker, which says the opposite thing.
    const refused = completedWaiver({
      id: "refused",
      status: "medical_review",
      medicalClearanceDeclinedAt: SIGN_NOW,
      medicalClearanceDeclinedByPersonId: "staff-1",
      medicalClearanceEvaluatedOn: "2026-07-18",
      medicalClearancePhysicianName: "Dr. Imani Reyes",
    });
    expect(medicalWaiverMark(refused)).toBeNull();
  });
});

/**
 * **A minor's release is signed twice** (ADR 20260907-guardian-co-signature) —
 * the standing half of it. `shopWaiverStatus` is what the diver's own record
 * and the carried-preparation reader both call, so a solo minor signature has
 * to read as its own state there rather than as "Signed"; and the mark that
 * travels to the manifest has to carry who co-signed.
 */
describe("a minor's co-signature", () => {
  const guardianSignedAt = new Date(SIGN_NOW.getTime() - 60_000);
  /** Twelve on the day the release was signed, in the shop's own zone. */
  const minor = { dateOfBirth: "2014-01-01", minorDeclared: false, timezone: "America/New_York" };
  const soloRecord = () => completedWaiver({ guardianSignedAt: null });
  const coSignedRecord = () =>
    completedWaiver({
      guardianSignedAt,
      guardianName: "Jonas Fischer",
      guardianRelationship: "parent",
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
    });
  const standing = (records: WaiverRecord[], signer?: GuardianSigner) =>
    shopWaiverStatus({
      personSignedWaivers: records,
      currentTemplateVersion: 1,
      signer,
      now: SIGN_NOW,
    });

  it("does not read a minor's solo signature as Signed", () => {
    const record = soloRecord();
    expect(standing([record], minor)).toEqual({
      state: "guardian_missing",
      signedAt: record.signedAt,
    });
  });

  it("reads it as Signed once the guardian has co-signed", () => {
    expect(standing([coSignedRecord()], minor).state).toBe("current");
  });

  it("answers as before for an adult and for a caller that names no signer", () => {
    expect(standing([soloRecord()], { ...minor, dateOfBirth: "1990-01-01" }).state).toBe("current");
    expect(standing([soloRecord()]).state).toBe("current");
  });

  it("puts the co-signer on the mark the manifest reads, and nothing when nobody co-signed", () => {
    expect(medicalWaiverMark(coSignedRecord())?.guardian).toEqual({
      name: "Jonas Fischer",
      relationship: "parent",
    });
    expect(
      medicalWaiverMark(
        completedWaiver({
          medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
          guardianSignedAt: null,
        }),
      )?.guardian,
    ).toBeNull();
  });
});

/**
 * **A physician clearance ends a medical hold** (issue #1252).
 *
 * The questionnaire refers a diver, the release parks in `medical_review`, and
 * readiness refuses to board them. A clearance recorded against *that record*
 * is the only thing that ends it — and it must end it everywhere the hold was
 * read, or the app disagrees with itself about whether a diver may board.
 */
describe("physician clearance", () => {
  const cleared = (overrides: Partial<WaiverRecord> = {}) =>
    completedWaiver({
      status: "medical_review",
      medicalClearedAt: new Date(SIGN_NOW.getTime() - 30_000),
      medicalClearedByPersonId: "staff-1",
      ...overrides,
    });

  it("makes a cleared referral stand as a current signature", () => {
    expect(isCompletedWaiverCurrent(cleared(), 1, SIGN_NOW)).toBe(true);
    // ...and an uncleared one still never does.
    expect(
      isCompletedWaiverCurrent(completedWaiver({ status: "medical_review" }), 1, SIGN_NOW),
    ).toBe(false);
  });

  it("still ages a cleared record out on the same 365-day clock", () => {
    const stale = cleared({
      signedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
      completedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
    });
    expect(isCompletedWaiverCurrent(stale, 1, SIGN_NOW)).toBe(false);
  });

  it("still refuses a cleared record signed against superseded terms", () => {
    expect(isCompletedWaiverCurrent(cleared(), 2, SIGN_NOW)).toBe(false);
  });

  it("reads the record as complete rather than held", () => {
    expect(waiverState(cleared(), SIGN_NOW)).toBe("complete");
    expect(waiverState(completedWaiver({ status: "medical_review" }), SIGN_NOW)).toBe(
      "medical_review",
    );
  });

  it("stops the booking's own hold from blocking once it is cleared", () => {
    const own = cleared({ bookingId: "booking-1" });
    const effective = effectiveWaiverForBooking({
      bookingWaiver: own,
      personSignedWaivers: [own],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(waiverState(effective, SIGN_NOW)).toBe("complete");
  });

  it("stops a carried hold from failing a clean signature closed", () => {
    // The rule this exercises is the sharp one: an unresolved disclosure made
    // *after* a clean signature invalidates it. A cleared one must not.
    const clean = completedWaiver({ id: "clean", bookingId: "booking-2" });
    const laterCleared = cleared({
      id: "held",
      bookingId: "booking-3",
      signedAt: new Date(SIGN_NOW.getTime() - 10_000),
      completedAt: new Date(SIGN_NOW.getTime() - 10_000),
    });
    const effective = effectiveWaiverForBooking({
      bookingWaiver: null,
      personSignedWaivers: [clean, laterCleared],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(waiverState(effective, SIGN_NOW)).toBe("complete");
  });

  it("leaves the shop standing current rather than in review", () => {
    const status = shopWaiverStatus({
      personSignedWaivers: [cleared()],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(status.state).toBe("current");
  });

  it("marks the medical as physician-cleared, dated by the clearance", () => {
    const clearedAt = new Date(SIGN_NOW.getTime() - 30_000);
    expect(medicalWaiverMark(cleared())).toEqual({
      at: clearedAt,
      source: "cleared",
      overriddenReferralAt: null,
      overriddenReferral: null,
      overriddenRefusal: null,
      // The record the clearance hangs on, and whether the physician's
      // evaluation itself is stored against it (issue #1283). The URL is
      // deliberately absent: this mark travels to the boat manifest, and
      // opening the file is a permission-gated route.
      clearance: { recordId: cleared().id, documentOnFile: false },
      guardian: null,
    });
    // The date is the clearance, not the signature: that is the day the
    // fitness question was actually answered.
    expect(medicalWaiverMark(cleared())?.at).not.toEqual(completedWaiver().signedAt);
  });

  it("still shows no medical mark for a hold nobody has cleared", () => {
    expect(medicalWaiverMark(completedWaiver({ status: "medical_review" }))).toBeNull();
  });

  it("never lets a superseded record be rescued by a clearance", () => {
    const dead = cleared({ supersededAt: SIGN_NOW });
    expect(isCompletedWaiverCurrent(dead, 1, SIGN_NOW)).toBe(false);
    const effective = effectiveWaiverForBooking({
      bookingWaiver: null,
      personSignedWaivers: [dead],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(effective).toBeNull();
  });
});

/**
 * **A physician's "no" a later clean signature stands over** (Aaron,
 * 2026-10-07, issue #2158): allowed, and warned about with the refused record.
 */
describe("overriddenRefusal", () => {
  const refusal = (overrides: Partial<WaiverRecord> = {}) =>
    completedWaiver({
      id: "refusal",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 600_000),
      completedAt: new Date(SIGN_NOW.getTime() - 600_000),
      medicalClearanceDeclinedAt: new Date(SIGN_NOW.getTime() - 500_000),
      supersededAt: new Date(SIGN_NOW.getTime() - 400_000),
      ...overrides,
    });
  const reSigned = (overrides: Partial<WaiverRecord> = {}) =>
    completedWaiver({
      id: "re-signed",
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
      signedAt: new Date(SIGN_NOW.getTime() - 60_000),
      completedAt: new Date(SIGN_NOW.getTime() - 60_000),
      ...overrides,
    });

  it("names the refused record a clean new release stands over, retired or not", () => {
    const expected = {
      recordId: "refusal",
      personId: "person-1",
      at: refusal().medicalClearanceDeclinedAt,
      evaluatedOn: null,
    };
    expect(overriddenRefusal(reSigned(), [refusal(), reSigned()])).toEqual(expected);
    expect(overriddenRefusal(reSigned(), [refusal({ supersededAt: null }), reSigned()])).toEqual(
      expected,
    );
    expect(medicalWaiverMark(reSigned(), [refusal(), reSigned()])?.overriddenRefusal).toEqual(
      expected,
    );
  });

  it("boards the diver on the new release, and warns once rather than twice", () => {
    const records = [refusal({ supersededAt: null }), reSigned()];
    const status = shopWaiverStatus({
      personSignedWaivers: records,
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(status.state).toBe("current");
    // The refusal is its own warning, never also an "unanswered referral".
    expect(status).toMatchObject({
      medical: { overriddenReferralAt: null, overriddenRefusal: { recordId: "refusal" } },
    });
  });

  it("carries the physician's own evaluation day when one was stored", () => {
    expect(
      overriddenRefusal(reSigned(), [
        refusal({ medicalClearanceEvaluatedOn: "2026-05-02" }),
        reSigned(),
      ])?.evaluatedOn,
    ).toBe("2026-05-02");
  });

  it("names the newest of several refusals", () => {
    const older = refusal({
      id: "older",
      signedAt: new Date(SIGN_NOW.getTime() - 900_000),
      completedAt: new Date(SIGN_NOW.getTime() - 900_000),
      medicalClearanceDeclinedAt: new Date(SIGN_NOW.getTime() - 800_000),
    });
    expect(overriddenRefusal(reSigned(), [older, refusal(), reSigned()])?.recordId).toBe("refusal");
  });

  it("says nothing once a physician cleared a release signed after the refusal", () => {
    const cleared = completedWaiver({
      id: "cleared",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 300_000),
      completedAt: new Date(SIGN_NOW.getTime() - 300_000),
      medicalClearedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    expect(overriddenRefusal(cleared, [refusal(), cleared])).toBeNull();
    expect(overriddenRefusal(reSigned(), [refusal(), cleared, reSigned()])).toBeNull();
  });

  it("says nothing about a refusal signed after the standing release", () => {
    const later = refusal({
      signedAt: new Date(SIGN_NOW.getTime() - 10_000),
      completedAt: new Date(SIGN_NOW.getTime() - 10_000),
    });
    expect(overriddenRefusal(reSigned(), [reSigned(), later])).toBeNull();
  });

  const [cardiacId, earsId] = RSTC_QUESTIONNAIRE.questions
    .filter((question) => question.referral)
    .map((question) => question.id);
  const flagging = (...ids: string[]) => ({
    ...clear,
    responses: { ...clear.responses, ...Object.fromEntries(ids.map((id) => [id, true])) },
  });

  it("keeps warning when a later clearance was about a different question", () => {
    // A cardiologist's "no", then an ENT clearing ears: not an answer to it.
    const cardiacNo = refusal({ medicalAnswers: flagging(cardiacId) });
    const earsYes = completedWaiver({
      id: "ears-yes",
      status: "medical_review",
      medicalAnswers: flagging(earsId),
      signedAt: new Date(SIGN_NOW.getTime() - 300_000),
      completedAt: new Date(SIGN_NOW.getTime() - 300_000),
      medicalClearedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    expect(overriddenRefusal(earsYes, [cardiacNo, earsYes])?.recordId).toBe("refusal");
    expect(overriddenRefusal(reSigned(), [cardiacNo, earsYes, reSigned()])?.recordId).toBe(
      "refusal",
    );
    // A clearance that covered the refused question too does answer it.
    const bothYes = completedWaiver({
      ...earsYes,
      id: "both-yes",
      medicalAnswers: flagging(cardiacId, earsId),
    });
    expect(overriddenRefusal(bothYes, [cardiacNo, bothYes])).toBeNull();
  });

  it("orders a yes against a no by when the physician answered, not when it was signed", () => {
    // The older referral was refused after the newer one was cleared.
    const lateNo = refusal({
      medicalClearanceEvaluatedOn: "2026-07-10",
      medicalClearanceDeclinedAt: new Date(SIGN_NOW.getTime() - 100_000),
    });
    const earlyYes = completedWaiver({
      id: "early-yes",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 300_000),
      completedAt: new Date(SIGN_NOW.getTime() - 300_000),
      medicalClearedAt: new Date(SIGN_NOW.getTime() - 200_000),
      medicalClearanceEvaluatedOn: "2026-07-01",
    });
    expect(overriddenRefusal(earlyYes, [lateNo, earlyYes])).toEqual({
      recordId: "refusal",
      personId: "person-1",
      at: lateNo.medicalClearanceDeclinedAt,
      evaluatedOn: "2026-07-10",
    });
  });

  it("lets a clearance a fresh link superseded still answer a refusal, only when decided after it and on its questions", () => {
    // A clean signature a fresh link replaced stays in the evidence
    // (`listSignedWaiversByPerson`), so a superseded clearance is read too: a
    // physician's later "yes" is no less an answer for its seat taking a link.
    const supersededYes = (overrides: Partial<WaiverRecord> = {}) =>
      completedWaiver({
        id: "superseded-yes",
        status: "medical_review",
        signedAt: new Date(SIGN_NOW.getTime() - 300_000),
        completedAt: new Date(SIGN_NOW.getTime() - 300_000),
        medicalClearedAt: new Date(SIGN_NOW.getTime() - 200_000),
        supersededAt: new Date(SIGN_NOW.getTime() - 100_000),
        ...overrides,
      });
    expect(overriddenRefusal(reSigned(), [refusal(), supersededYes(), reSigned()])).toBeNull();

    // Decided before the "no": not an answer to it.
    const earlyYes = supersededYes({ medicalClearanceEvaluatedOn: "2026-07-01" });
    const lateNo = refusal({ medicalClearanceEvaluatedOn: "2026-07-10" });
    expect(overriddenRefusal(reSigned(), [lateNo, earlyYes, reSigned()])?.recordId).toBe("refusal");

    // About another question: not an answer to it either.
    const cardiacNo = refusal({ medicalAnswers: flagging(cardiacId) });
    const earsYes = supersededYes({ medicalAnswers: flagging(earsId) });
    expect(overriddenRefusal(reSigned(), [cardiacNo, earsYes, reSigned()])?.recordId).toBe(
      "refusal",
    );
  });

  it("says nothing for a diver no physician refused, or with no clean release", () => {
    expect(overriddenRefusal(reSigned(), [reSigned()])).toBeNull();
    expect(overriddenRefusal(null, [refusal()])).toBeNull();
    expect(overriddenRefusal(refusal(), [refusal()])).toBeNull();
  });
});

/**
 * **A referral nobody ever answered, with a clean signature standing over it**
 * (issue #1282).
 *
 * The hole is the symmetric half of a rule that is right in one direction: a
 * disclosure made *at or after* the last clean signature invalidates it, and a
 * clean signature made *after* a disclosure ends the hold. So a diver referred
 * to a physician can simply be sent a fresh link, answer "no" to everything,
 * and board — with no doctor anywhere in it.
 *
 * These pin the reproduction and the mark that makes it visible. It still
 * clears by decision: the owner kept the override (Aaron, 2026-10-09, issue
 * #2195, amending H-98), matching what a clean release does after a
 * physician's "no", and every surface warns with a link back to the referral.
 */
describe("a referral a later clean signature stood over", () => {
  const referral = () =>
    completedWaiver({
      id: "referral",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 600_000),
      completedAt: new Date(SIGN_NOW.getTime() - 600_000),
    });
  /** A referral a physician answered — the legitimate exit (issue #1252). */
  const cleared = (overrides: Partial<WaiverRecord> = {}) =>
    completedWaiver({
      status: "medical_review",
      medicalClearedAt: new Date(SIGN_NOW.getTime() - 30_000),
      medicalClearedByPersonId: "staff-1",
      ...overrides,
    });
  const reSigned = () =>
    completedWaiver({
      id: "re-signed",
      medicalAnswers: { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} },
      signedAt: new Date(SIGN_NOW.getTime() - 60_000),
      completedAt: new Date(SIGN_NOW.getTime() - 60_000),
    });

  it("still clears the diver — the reproduction, kept by decision", () => {
    // Refusing this would strand a diver who mis-tapped question 3 until a
    // doctor writes a letter. The owner ruled it stands (issue #2195); what
    // changes is that nobody has to notice it by accident.
    expect(
      shopWaiverStatus({
        personSignedWaivers: [referral(), reSigned()],
        currentTemplateVersion: 1,
        now: SIGN_NOW,
      }).state,
    ).toBe("current");
    expect(
      effectiveWaiverForBooking({
        bookingWaiver: null,
        personSignedWaivers: [referral(), reSigned()],
        currentTemplateVersion: 1,
        now: SIGN_NOW,
      })?.id,
    ).toBe("re-signed");
  });

  it("names the referral the standing signature replaced", () => {
    const at = overriddenReferralAt(reSigned(), [referral(), reSigned()]);
    expect(at).toEqual(referral().signedAt);
    const status = shopWaiverStatus({
      personSignedWaivers: [referral(), reSigned()],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(status).toMatchObject({
      state: "current",
      medical: { source: "digital", overriddenReferralAt: referral().signedAt },
    });
  });

  it("names the referral's own record, so the warning can link to it (issue #2195)", () => {
    expect(overriddenReferral(reSigned(), [referral(), reSigned()])).toEqual({
      recordId: "referral",
      personId: "person-1",
      at: referral().signedAt,
    });
    expect(medicalWaiverMark(reSigned(), [referral(), reSigned()])).toMatchObject({
      overriddenReferralAt: referral().signedAt,
      overriddenReferral: { recordId: "referral", personId: "person-1" },
    });
    expect(overriddenReferral(reSigned(), [reSigned()])).toBeNull();
  });

  it("says nothing when the referral is the one that was cleared", () => {
    // `cleared()` is a referral a physician answered. It is the same record, so
    // there is no *other* hold behind it and nothing to warn about.
    expect(overriddenReferralAt(cleared(), [cleared()])).toBeNull();
    expect(medicalWaiverMark(cleared(), [cleared()])?.overriddenReferralAt).toBeNull();
  });

  it("says nothing for a diver who was never referred", () => {
    expect(overriddenReferralAt(reSigned(), [reSigned()])).toBeNull();
    expect(
      shopWaiverStatus({
        personSignedWaivers: [reSigned()],
        currentTemplateVersion: 1,
        now: SIGN_NOW,
      }),
    ).toMatchObject({ medical: { overriddenReferralAt: null } });
  });

  it("says nothing about a hold that is winning anyway", () => {
    // A referral at or *after* the last clean signature blocks outright — that
    // is the fail-closed half, and a block is not something to warn about.
    const laterReferral = completedWaiver({
      id: "later-referral",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 10_000),
      completedAt: new Date(SIGN_NOW.getTime() - 10_000),
    });
    expect(overriddenReferralAt(reSigned(), [reSigned(), laterReferral])).toBeNull();
    expect(
      shopWaiverStatus({
        personSignedWaivers: [reSigned(), laterReferral],
        currentTemplateVersion: 1,
        now: SIGN_NOW,
      }).state,
    ).toBe("medical_review");
  });

  it("ignores a referral somebody has since cleared", () => {
    // Cleared is resolved. Only an *unresolved* hold is worth a crew's attention.
    const resolvedReferral = cleared({
      id: "resolved-referral",
      signedAt: new Date(SIGN_NOW.getTime() - 600_000),
      completedAt: new Date(SIGN_NOW.getTime() - 600_000),
    });
    expect(overriddenReferralAt(reSigned(), [resolvedReferral, reSigned()])).toBeNull();
  });

  const [heartId, earId] = RSTC_QUESTIONNAIRE.questions
    .filter((question) => question.referral)
    .map((question) => question.id);
  const flags = (...ids: string[]) => ({
    ...clear,
    responses: { ...clear.responses, ...Object.fromEntries(ids.map((id) => [id, true])) },
  });

  it("says nothing once a physician cleared a later referral on the same questions", () => {
    // Without this the record read "stood over a referral" beside "Cleared
    // by physician" for one diver: the clearance answered both disclosures.
    const heartReferral = completedWaiver({
      id: "referral",
      status: "medical_review",
      medicalAnswers: flags(heartId),
      signedAt: new Date(SIGN_NOW.getTime() - 600_000),
      completedAt: new Date(SIGN_NOW.getTime() - 600_000),
    });
    const heartCleared = cleared({
      id: "heart-cleared",
      medicalAnswers: flags(heartId),
      signedAt: new Date(SIGN_NOW.getTime() - 300_000),
      completedAt: new Date(SIGN_NOW.getTime() - 300_000),
      medicalClearanceEvaluatedOn: "2026-07-18",
    });
    expect(overriddenReferral(heartCleared, [heartReferral, heartCleared])).toBeNull();
    expect(overriddenReferral(reSigned(), [heartReferral, heartCleared, reSigned()])).toBeNull();
    expect(medicalWaiverMark(heartCleared, [heartReferral, heartCleared])).toMatchObject({
      source: "cleared",
      overriddenReferral: null,
    });
  });

  it("still names the referral when the clearance was about another question, or came before it", () => {
    const heartReferral = completedWaiver({
      id: "referral",
      status: "medical_review",
      medicalAnswers: flags(heartId),
      signedAt: new Date(SIGN_NOW.getTime() - 600_000),
      completedAt: new Date(SIGN_NOW.getTime() - 600_000),
    });
    // An ENT clearing ears says nothing about the heart.
    const earCleared = cleared({
      id: "ear-cleared",
      medicalAnswers: flags(earId),
      signedAt: new Date(SIGN_NOW.getTime() - 300_000),
      completedAt: new Date(SIGN_NOW.getTime() - 300_000),
      medicalClearanceEvaluatedOn: "2026-07-18",
    });
    expect(overriddenReferral(earCleared, [heartReferral, earCleared])?.recordId).toBe("referral");
    // A clearance a physician gave before the diver disclosed again is not an
    // answer to the new disclosure, whatever it covered.
    const oldClearance = cleared({
      id: "old-clearance",
      medicalAnswers: flags(heartId),
      signedAt: new Date("2026-06-01T12:00:00.000Z"),
      completedAt: new Date("2026-06-01T12:00:00.000Z"),
      medicalClearanceEvaluatedOn: "2026-06-03",
      medicalClearedAt: new Date("2026-06-04T12:00:00.000Z"),
    });
    expect(
      overriddenReferral(reSigned(), [oldClearance, heartReferral, reSigned()])?.recordId,
    ).toBe("referral");
  });

  it("keeps a Tokyo referral open when the only matching clearance is on the prior shop day", () => {
    const referredAt = new Date("2026-07-18T15:30:00.000Z");
    const referral = completedWaiver({
      id: "tokyo-referral",
      status: "medical_review",
      medicalAnswers: flags(heartId),
      signedAt: referredAt,
      completedAt: referredAt,
    });
    const earlierClearance = cleared({
      id: "tokyo-earlier-clearance",
      medicalAnswers: flags(heartId),
      signedAt: new Date("2026-07-18T16:00:00.000Z"),
      completedAt: new Date("2026-07-18T16:00:00.000Z"),
      medicalClearanceEvaluatedOn: "2026-07-18",
      medicalClearedAt: new Date("2026-07-18T16:00:00.000Z"),
    });
    const standing = completedWaiver({
      id: "tokyo-standing-release",
      signedAt: new Date("2026-07-19T16:30:00.000Z"),
      completedAt: new Date("2026-07-19T16:30:00.000Z"),
    });
    const records = [earlierClearance, referral, standing];

    expect(overriddenReferral(standing, records, "Asia/Tokyo")?.recordId).toBe(referral.id);
    // The older behavior treated the UTC date as the shop date and hid it.
    expect(overriddenReferral(standing, records, "UTC")).toBeNull();

    expect(
      shopWaiverStatus({
        personSignedWaivers: records,
        currentTemplateVersion: 1,
        now: new Date("2026-07-20T00:00:00.000Z"),
        signer: { dateOfBirth: null, minorDeclared: false, timezone: "Asia/Tokyo" },
      }),
    ).toMatchObject({
      state: "current",
      medical: { overriddenReferral: { recordId: referral.id, personId: referral.personId } },
    });
  });
});

/**
 * The two dates a crew reads beside a medical warning, as calendar days in the
 * shop's zone (dive-domain review of #2163): the physician's evaluation day for
 * a refusal, falling back to when staff recorded it, and the referral's day.
 */
describe("medicalWarningDays", () => {
  const mark = (overrides: Partial<MedicalWaiverMark>): MedicalWaiverMark => ({
    at: new Date("2026-07-01T15:00:00.000Z"),
    source: "digital",
    overriddenReferralAt: null,
    overriddenReferral: null,
    overriddenRefusal: null,
    clearance: null,
    guardian: null,
    ...overrides,
  });

  it("says nothing for a mark with neither warning, or no mark", () => {
    expect(medicalWarningDays(mark({}), "America/New_York")).toEqual({});
    expect(medicalWarningDays(null, "America/New_York")).toEqual({});
    expect(medicalWarningDays(undefined, "America/New_York")).toEqual({});
  });

  it("dates a refusal by the physician's evaluation, not by when it was typed in", () => {
    const refusal = {
      recordId: "r",
      personId: "p",
      at: new Date("2026-05-20T13:00:00.000Z"),
      evaluatedOn: "2026-05-02" as const,
    };
    expect(medicalWarningDays(mark({ overriddenRefusal: refusal }), "America/New_York")).toEqual({
      refusedOn: "2026-05-02",
    });
  });

  it("falls back to the shop's day the refusal was recorded", () => {
    // 01:00 UTC on May 3 is still May 2 in Miami.
    const refusal = {
      recordId: "r",
      personId: "p",
      at: new Date("2026-05-03T01:00:00.000Z"),
      evaluatedOn: null,
    };
    expect(medicalWarningDays(mark({ overriddenRefusal: refusal }), "America/New_York")).toEqual({
      refusedOn: "2026-05-02",
    });
  });

  it("dates a referral by the shop's day", () => {
    expect(
      medicalWarningDays(
        mark({ overriddenReferralAt: new Date("2026-06-11T02:00:00.000Z") }),
        "America/New_York",
      ),
    ).toEqual({ referredOn: "2026-06-10" });
  });
});

/**
 * **The release a rider's seat stands on** (H-109, issue #2212). A rider is
 * held to the shop's release and to nothing in the medical, so a signature a
 * referral parked or a physician refused is still a signature, and an older
 * clean one is not outranked by a later hold. Everything else about the
 * signature still applies: current terms, inside the year, not superseded.
 */
describe("effectiveReleaseForRiderSeat", () => {
  const args = (over: Partial<Parameters<typeof effectiveReleaseForRiderSeat>[0]>) => ({
    bookingWaiver: null,
    personSignedWaivers: [],
    currentTemplateVersion: 1 as number | null,
    now: SIGN_NOW,
    ...over,
  });

  it("stands on a signature a referral or a refusal held", () => {
    const held = completedWaiver({ status: "medical_review" });
    expect(effectiveReleaseForRiderSeat(args({ personSignedWaivers: [held] }))).toBe(held);
    const refused = completedWaiver({
      status: "medical_review",
      medicalClearanceDeclinedAt: SIGN_NOW,
    });
    expect(effectiveReleaseForRiderSeat(args({ bookingWaiver: refused }))).toBe(refused);
  });

  it("takes the newest signature, held or clean", () => {
    const olderClean = completedWaiver({
      id: "clean",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    const newerHold = completedWaiver({ id: "hold", status: "medical_review" });
    expect(
      effectiveReleaseForRiderSeat(args({ personSignedWaivers: [olderClean, newerHold] }))?.id,
    ).toBe("hold");
  });

  it("refuses a held signature past the year, or against terms the shop has since changed", () => {
    const aged = completedWaiver({
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - WAIVER_SIGNATURE_VALIDITY_MS - 1),
    });
    expect(effectiveReleaseForRiderSeat(args({ personSignedWaivers: [aged] }))).toBeNull();
    expect(effectiveReleaseForRiderSeat(args({ bookingWaiver: aged }))).toBeNull();
    const oldTerms = completedWaiver({
      status: "medical_review",
      templateVersion: 0,
      templateGeneration: 0,
    });
    expect(effectiveReleaseForRiderSeat(args({ personSignedWaivers: [oldTerms] }))).toBeNull();
  });

  it("refuses a superseded signature, a retired refusal included", () => {
    const retired = completedWaiver({
      status: "medical_review",
      medicalClearanceDeclinedAt: SIGN_NOW,
      supersededAt: SIGN_NOW,
    });
    expect(effectiveReleaseForRiderSeat(args({ personSignedWaivers: [retired] }))).toBeNull();
  });

  it("refuses a held record with no signature time on it", () => {
    const unsigned = completedWaiver({
      status: "medical_review",
      signedAt: null,
      completedAt: null,
    });
    expect(effectiveReleaseForRiderSeat(args({ bookingWaiver: unsigned }))).toBeNull();
  });

  it("hands back the seat's own unsigned link when nothing is signed, for the send flow", () => {
    const pending = completedWaiver({ status: "pending", signedAt: null, completedAt: null });
    expect(effectiveReleaseForRiderSeat(args({ bookingWaiver: pending }))).toBe(pending);
  });

  it("hands back a lapsed unsigned link too, so the desk reads expired, as for a diver's seat", () => {
    const lapsed = completedWaiver({
      status: "pending",
      signedAt: null,
      completedAt: null,
      expiresAt: new Date(SIGN_NOW.getTime() - 1),
    });
    const rider = effectiveReleaseForRiderSeat(args({ bookingWaiver: lapsed }));
    expect(rider).toBe(lapsed);
    expect(rider).toBe(effectiveWaiverForBooking(args({ bookingWaiver: lapsed })));
    expect(waiverState(rider, SIGN_NOW)).toBe("expired");
  });
});

/**
 * **What the crew reads for a rider boarding past a medical** (H-109;
 * dive-domain review of #2212): never a blocker, always a warning.
 */
describe("riderMedicalHold", () => {
  it("names a physician's no on the rider's own release, by the evaluation day", () => {
    const refused = completedWaiver({
      status: "medical_review",
      medicalClearanceDeclinedAt: SIGN_NOW,
      medicalClearanceEvaluatedOn: "2026-07-01",
    });
    expect(riderMedicalHold(refused, [refused])).toEqual({
      kind: "not_cleared",
      at: SIGN_NOW,
      evaluatedOn: "2026-07-01",
    });
  });

  it("names an open referral, and a no on an earlier release outranks it", () => {
    const referral = completedWaiver({ id: "referral", status: "medical_review" });
    expect(riderMedicalHold(referral, [referral])?.kind).toBe("referral");
    const earlierNo = completedWaiver({
      id: "earlier-no",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 100_000),
      medicalClearanceDeclinedAt: new Date(SIGN_NOW.getTime() - 50_000),
    });
    expect(riderMedicalHold(referral, [referral, earlierNo])?.kind).toBe("not_cleared");
  });

  it("names a retired refusal signed after the clean release the rider stands on", () => {
    const s1 = completedWaiver({
      id: "s1-clean",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
    });
    const s2 = completedWaiver({
      id: "s2-refused",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 100_000),
      medicalClearanceDeclinedAt: new Date(SIGN_NOW.getTime() - 50_000),
      medicalClearanceEvaluatedOn: "2026-07-01",
      supersededAt: SIGN_NOW,
    });
    // The rider path skips the retired "no" and stands on the clean release.
    const release = effectiveReleaseForRiderSeat({
      bookingWaiver: null,
      personSignedWaivers: [s1, s2],
      currentTemplateVersion: 1,
      now: SIGN_NOW,
    });
    expect(release?.id).toBe("s1-clean");
    expect(overriddenRefusal(release, [s1, s2])).toBeNull();
    expect(riderMedicalHold(release, [s1, s2])).toMatchObject({
      kind: "not_cleared",
      evaluatedOn: "2026-07-01",
    });
  });

  it("leaves an earlier refusal under a clean release to the ordinary warning", () => {
    const earlierNo = completedWaiver({
      id: "earlier-no",
      status: "medical_review",
      signedAt: new Date(SIGN_NOW.getTime() - 200_000),
      medicalClearanceDeclinedAt: new Date(SIGN_NOW.getTime() - 150_000),
    });
    const clean = completedWaiver({ id: "clean" });
    expect(riderMedicalHold(clean, [earlierNo, clean])).toBeNull();
    expect(overriddenRefusal(clean, [earlierNo, clean])).not.toBeNull();
  });

  it("says nothing for a clean release or none", () => {
    expect(riderMedicalHold(completedWaiver({}), [])).toBeNull();
    expect(riderMedicalHold(null, [])).toBeNull();
  });

  it("dates the riding-only warning in the shop's zone", () => {
    const referral = completedWaiver({
      status: "medical_review",
      signedAt: new Date("2026-07-02T02:00:00.000Z"),
    });
    expect(
      medicalWarningDays(null, "America/New_York", riderMedicalHold(referral, [referral])),
    ).toEqual({ ridingReferredOn: "2026-07-01" });
  });
});

describe("isSampleRelease", () => {
  it("is true while the live release is DiveDay's starting text, or there is none", () => {
    expect(isSampleRelease(DEFAULT_WAIVER_BODY)).toBe(true);
    expect(isSampleRelease(null)).toBe(true);
    expect(isSampleRelease(undefined)).toBe(true);
  });

  it("is false once the shop has published any words of its own", () => {
    expect(isSampleRelease(`${DEFAULT_WAIVER_BODY}\n\nBlue Mantis Diving, Key Largo.`)).toBe(false);
    // Byte-equal, not near-equal: one changed character is the shop's edit.
    expect(isSampleRelease(DEFAULT_WAIVER_BODY.replace("crew", "Crew"))).toBe(false);
  });
});
