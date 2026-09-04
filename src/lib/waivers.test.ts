import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "./medical";
import { localTypedConsentProvider } from "./signatures";
import {
  effectiveWaiverForBooking,
  isCleanCompletion,
  isCompletedWaiverCurrent,
  isUnresolvedMedicalHold,
  medicalWaiverMark,
  needsMedicalReview,
  overriddenReferralAt,
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
      clearance: null,
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
    ).toEqual({ at: signedAt, source: "paper", overriddenReferralAt: null, clearance: null });
  });

  it("marks an imported acceptance distinctly, even though it carries no questionnaire", () => {
    const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
    expect(
      medicalWaiverMark(
        completedWaiver({ medicalAnswers: null, signatureMethod: "imported", signedAt }),
      ),
    ).toEqual({ at: signedAt, source: "imported", overriddenReferralAt: null, clearance: null });
  });

  it("surfaces nothing for an in-review, unrecognised, or absent record", () => {
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
    ).toEqual({ at: completedAt, source: "digital", overriddenReferralAt: null, clearance: null });
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

  it("ignores a superseded hold", () => {
    const hold = completedWaiver({
      id: "hold",
      status: "medical_review",
      supersededAt: SIGN_NOW,
    });
    expect(status([hold]).state).toBe("none");
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
      // The record the clearance hangs on, and whether the physician's
      // evaluation itself is stored against it (issue #1283). The URL is
      // deliberately absent: this mark travels to the boat manifest, and
      // opening the file is a permission-gated route.
      clearance: { recordId: cleared().id, documentOnFile: false },
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
 * **A referral nobody ever answered, with a clean signature standing over it**
 * (issue #1282).
 *
 * The hole is the symmetric half of a rule that is right in one direction: a
 * disclosure made *at or after* the last clean signature invalidates it, and a
 * clean signature made *after* a disclosure ends the hold. So a diver referred
 * to a physician can simply be sent a fresh link, answer "no" to everything,
 * and board — with no doctor anywhere in it.
 *
 * These pin the reproduction (it still clears, deliberately: whether to refuse
 * it is a human call) and the mark that now makes it visible.
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

  it("still clears the diver — the reproduction, unchanged on purpose", () => {
    // Refusing this would strand a diver who mis-tapped question 3 until a
    // doctor writes a letter, which is its own failure mode and Aaron's call
    // (H-01/H-03). What changes is that nobody has to notice it by accident.
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
});
