import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "./medical";
import { localTypedConsentProvider } from "./signatures";
import {
  effectiveWaiverForBooking,
  isCompletedWaiverCurrent,
  medicalWaiverSignedAt,
  needsMedicalReview,
  WAIVER_SIGNATURE_VALIDITY_MS,
  waiverActivityTimeline,
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

  it("keeps an ordered staff timeline for replaced and medically blocked records", () => {
    const entries = waiverActivityTimeline([
      {
        status: "medical_review",
        templateTitle: "Release",
        templateVersion: 2,
        createdAt: new Date("2026-07-18T12:00:00.000Z"),
        startedAt: new Date("2026-07-18T12:01:00.000Z"),
        completedAt: new Date("2026-07-18T12:02:00.000Z"),
        supersededAt: null,
      } as WaiverRecord,
      {
        status: "pending",
        templateTitle: "Release",
        templateVersion: 1,
        createdAt: new Date("2026-07-18T11:00:00.000Z"),
        startedAt: null,
        completedAt: null,
        supersededAt: new Date("2026-07-18T11:30:00.000Z"),
      } as WaiverRecord,
    ]);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "issued",
      "superseded",
      "issued",
      "started",
      "medical_review",
    ]);
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
});

describe("medical waiver signed date", () => {
  const answers = { questionnaireId: "rstc", questionnaireVersion: 1, responses: {} };

  it("returns the signing date only for a completed medical completion", () => {
    const signedAt = new Date(SIGN_NOW.getTime() - 60_000);
    expect(medicalWaiverSignedAt(completedWaiver({ medicalAnswers: answers, signedAt }))).toEqual(
      signedAt,
    );
    // A staff paper record has no questionnaire on file — nothing to age.
    expect(
      medicalWaiverSignedAt(
        completedWaiver({ medicalAnswers: null, signatureMethod: "in_person_attested" }),
      ),
    ).toBeNull();
    // Not-yet-cleared and absent records surface no date.
    expect(
      medicalWaiverSignedAt(completedWaiver({ status: "medical_review", medicalAnswers: answers })),
    ).toBeNull();
    expect(medicalWaiverSignedAt(null)).toBeNull();
  });

  it("falls back to completedAt when signedAt is somehow missing", () => {
    const completedAt = new Date(SIGN_NOW.getTime() - 5_000);
    expect(
      medicalWaiverSignedAt(
        completedWaiver({ medicalAnswers: answers, signedAt: null, completedAt }),
      ),
    ).toEqual(completedAt);
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
    const staleVersion = completedWaiver({ templateVersion: 0, bookingId: "other" });
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

    const oldVersionOwn = completedWaiver({ id: "own-v0", templateVersion: 0 });
    expect(effectiveWaiverForBooking(args({ bookingWaiver: oldVersionOwn }))).toBeNull();

    // A current own signature still stands.
    const currentOwn = completedWaiver({ id: "own-current" });
    expect(effectiveWaiverForBooking(args({ bookingWaiver: currentOwn }))?.id).toBe("own-current");
  });
});
