import { staffGuardianRelationshipOptions } from "@/i18n/guardian-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { GuardianRelationship } from "@/lib/guardian";
import type { PaperWaiverRefusal } from "@/lib/paper-waiver-form";
import type { NoticeTone } from "@/lib/staff-notices";

/**
 * Words for `PaperWaiverControl`, resolved server-side and passed down as plain
 * data — the house pattern for a staff Client Component, which can't be handed
 * a `StaffTranslator` (a function is not serializable across the boundary).
 *
 * In its own module rather than beside the component for the same reason
 * `waiver-send-types.ts` is: everything exported from a `"use client"` file is a
 * client reference, so a server page calling `paperWaiverCopy()` from there
 * throws "attempted to call it from the server" at render — a runtime failure
 * that `tsc` and a jsdom component test both wave straight through, and that
 * shows up as a blank client-only page.
 */
export type PaperWaiverCopy = {
  markSignedOnPaper: string;
  medicalAttestationLabel: string;
  recording: string;
  recordPaperSignature: string;
  neverMind: string;
  /**
   * The guardian half of the form, shown only for a diver who is a minor
   * today (ADR 20260907-guardian-co-signature). Always resolved — the words
   * cost nothing to carry and the surface decides whether to draw them, which
   * keeps `requiresGuardian` a single boolean rather than a copy handoff.
   */
  guardian: {
    nameLabel: string;
    relationshipLabel: string;
    relationshipChoose: string;
    relationshipOptions: Array<{ value: GuardianRelationship; label: string }>;
    /**
     * The namesake confirmation, drawn only on a form that has already been
     * refused for it (issue #1573). Resolved unconditionally like the rest —
     * the surface decides whether it appears.
     */
    namesakeLabel: string;
  };
  /**
   * What a refusal says, **beside the form rather than in a page banner**
   * (`.claude/rules/surfaces.md`, "Where a form says what happened"). A refused
   * recording no longer navigates — it answers in `useActionState` carrying the
   * typed values back (issue #1674) — so the words come down with the rest of
   * the copy instead of being resolved from a `?notice=` on the way back in.
   */
  refusals: Record<PaperWaiverRefusal, { text: string; tone: NoticeTone }>;
};

/**
 * Which surface is asking, because the words differ by more than tone: a
 * namesake family at the counter or on the roster is told to tick the
 * confirmation on the form in front of them, and the same family reached from
 * the diver's record is sent to the counter, because the tick asserts in the
 * first person that the staffer watched two people sign and nobody reading a
 * scanned PDF in February did (`PaperWaiverControl`'s `offersNamesake`).
 */
export type PaperWaiverSurface = "roster" | "counter" | "diver";

/**
 * The three refusals a staffer can act on, in each surface's own words.
 *
 * **These are the keys the three page-level notice tables already used** —
 * `TripNoticeBanner.tsx`, `check-in/page.tsx` and `record-notices.ts` — read
 * from here now that the refusal lands in the form instead of the banner. The
 * tones come across unchanged with them: the medical attestation is a
 * `warning` on the counter and the diver's record and a `danger` on the roster,
 * which is what shipped, and this table is not the place to reopen it.
 */
const REFUSAL_COPY: Record<
  PaperWaiverSurface,
  Record<PaperWaiverRefusal, { key: StaffMessageKey; tone: NoticeTone }>
> = {
  roster: {
    medical_attestation: { key: "trips.notices.waiverMedicalAttestation", tone: "danger" },
    guardian_name: { key: "trips.notices.waiverGuardianName", tone: "danger" },
    error: { key: "trips.notices.waiverError", tone: "danger" },
  },
  counter: {
    medical_attestation: { key: "checkIn.notice.waiverMedicalAttestation", tone: "warning" },
    guardian_name: { key: "checkIn.notice.waiverGuardianName", tone: "danger" },
    error: { key: "checkIn.notice.waiverError", tone: "danger" },
  },
  diver: {
    medical_attestation: { key: "divers.notices.waiverMedicalAttestation", tone: "warning" },
    guardian_name: { key: "divers.notices.waiverGuardianName", tone: "danger" },
    error: { key: "divers.notices.waiverError", tone: "danger" },
  },
};

export function paperWaiverCopy(t: StaffTranslator, surface: PaperWaiverSurface): PaperWaiverCopy {
  const refusals = REFUSAL_COPY[surface];
  return {
    markSignedOnPaper: t("shared.paperWaiver.markSignedOnPaper"),
    medicalAttestationLabel: t("shared.paperWaiver.medicalAttestationLabel"),
    recording: t("shared.paperWaiver.recording"),
    recordPaperSignature: t("shared.paperWaiver.recordPaperSignature"),
    neverMind: t("shared.waiverSend.neverMind"),
    guardian: {
      nameLabel: t("shared.paperWaiver.guardianNameLabel"),
      relationshipLabel: t("shared.paperWaiver.guardianRelationshipLabel"),
      relationshipChoose: t("shared.paperWaiver.guardianRelationshipChoose"),
      relationshipOptions: staffGuardianRelationshipOptions(t),
      namesakeLabel: t("shared.paperWaiver.guardianNamesakeLabel"),
    },
    refusals: {
      medical_attestation: {
        text: t(refusals.medical_attestation.key),
        tone: refusals.medical_attestation.tone,
      },
      guardian_name: { text: t(refusals.guardian_name.key), tone: refusals.guardian_name.tone },
      error: { text: t(refusals.error.key), tone: refusals.error.tone },
    },
  };
}
