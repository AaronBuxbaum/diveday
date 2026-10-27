import type {
  MedicalHoldCode,
  RollCallCheckpoint,
  RollCallLabel,
  TrainingMarkCleared,
} from "@/lib/manifests";
import type { MedicalWarningDays } from "@/lib/waivers";
import type { StaffMessageKey, StaffTranslator } from "./staff-messages";

/**
 * A roll-call checkpoint's staff-facing word ("Before departure" / "After
 * dive N"). `RollCallCheckpoint` (src/lib/manifests.ts) is already the code —
 * `"departure"` or `` `after_dive_${number}` `` — so there is nothing for the
 * lib layer to hand back beyond that value itself; this is the staff-bundle
 * resolver every staff surface renders it through (manifest/page.tsx,
 * OfflineManifestView.tsx), with the dive number passed as an ICU `{n}`
 * placeholder rather than string concatenation.
 */
export function rollCallCheckpointText(t: StaffTranslator, checkpoint: RollCallCheckpoint): string {
  if (checkpoint === "departure") return t("shared.rollCallCheckpoint.departure");
  const n = Number(checkpoint.slice("after_dive_".length));
  return t("shared.rollCallCheckpoint.afterDive", { n });
}

/**
 * The same checkpoint in the shortest words it can be said in — "Dock" /
 * "Dive N", *Muelle* / *Inm. N*. The full name at boat size overran a 390px
 * track and the row read as two, on the one surface a crew works at the rail
 * (#1320).
 *
 * **Only ever rendered where the full name is already on the same screen.**
 * `DiverRollCall` renders `manifest.checkpointRollCallHeading` ("Before
 * departure roll call") as an unconditional `<h2>` immediately below the
 * track, at every width and in every state — that is the guarantee, not the
 * summary panel above it, which swaps the checkpoint's name for "Roll call
 * complete" once every result is in. The short form is a handle for a choice
 * that is spelled out a line down; never use it as a standalone label
 * anywhere else.
 */
export function rollCallCheckpointShortText(
  t: StaffTranslator,
  checkpoint: RollCallCheckpoint,
): string {
  if (checkpoint === "departure") return t("shared.rollCallCheckpoint.departureShort");
  const n = Number(checkpoint.slice("after_dive_".length));
  return t("shared.rollCallCheckpoint.afterDiveShort", { n });
}

const ROLL_CALL_STATE_KEYS: Record<RollCallLabel, StaffMessageKey> = {
  awaiting: "shared.rollCallState.awaiting",
  boarded: "shared.rollCallState.boarded",
  not_boarded: "shared.rollCallState.notBoarded",
  not_boarded_carried: "shared.rollCallState.notBoardedCarried",
  not_back_aboard: "shared.rollCallState.notBackAboard",
};

/**
 * The words beside a diver's name for their roll-call state at a checkpoint.
 * `rollCallLabel` (src/lib/manifests.ts) resolves the code — including the
 * `not_back_aboard` case an after-dive checkpoint carries — and this is the one
 * resolver both the live manifest and the offline copy render it through, so
 * the two surfaces cannot describe the same diver differently.
 */
export function rollCallLabelText(t: StaffTranslator, label: RollCallLabel): string {
  return t(ROLL_CALL_STATE_KEYS[label]);
}

/**
 * **A row's medical warnings, strongest first**, as the chip words and the
 * dated sentences, in the same order: a rider boarding riding only under a
 * physician's "no", then under an open referral (H-109), then an earlier
 * refusal a clean release stands over (H-98), then a referral it replaced
 * (issue #1282). The live roll call, its printed sheet and the offline copy
 * all read this one list, so the capsule is always the first entry and paper
 * prints the rest.
 */
export function medicalWarningChips(t: StaffTranslator, days: MedicalWarningDays): string[] {
  return [
    days.ridingNotClearedOn ? t("manifest.medicalRidingOnlyNotClearedChip") : null,
    days.ridingReferredOn ? t("manifest.medicalRidingOnlyReferralChip") : null,
    days.refusedOn ? t("manifest.medicalEarlierRefusalChip") : null,
    days.referredOn ? t("manifest.medicalReferralUnresolvedChip") : null,
  ].filter((chip): chip is string => chip !== null);
}

/**
 * The capsule for a diver boarded over a medical blocker, after a dive
 * (`medicalHoldAfterDive`, issue #2380): the live roll call and the offline
 * copy word it through this one function.
 */
export function medicalHoldChip(t: StaffTranslator, code: MedicalHoldCode): string {
  return code === "medical_not_cleared"
    ? t("manifest.medicalHoldNotClearedChip")
    : t("manifest.medicalHoldReviewChip");
}

/** The riding-only sentences of {@link medicalWarningChips}, dated. */
export function ridingOnlyMedicalSentences(
  t: StaffTranslator,
  days: MedicalWarningDays,
  formatDay: (day: NonNullable<MedicalWarningDays["ridingNotClearedOn"]>) => string,
): string[] {
  return [
    days.ridingNotClearedOn
      ? t("manifest.medicalRidingOnlyNotCleared", { date: formatDay(days.ridingNotClearedOn) })
      : null,
    days.ridingReferredOn
      ? t("manifest.medicalRidingOnlyReferral", { date: formatDay(days.ridingReferredOn) })
      : null,
  ].filter((line): line is string => line !== null);
}

/**
 * A training dive's lines on a manifest row (issue #2275), live and offline
 * alike: the course it counts toward, then the warnings — no instructor on the
 * crew, and a mark someone cleared with the course's forms unsigned.
 */
export function trainingDiveLines(
  t: StaffTranslator,
  diver: {
    trainingDive?: {
      courseTitle: string;
      instructorAboard: boolean;
      overRatio?: boolean;
      siteAttributionUnknown?: boolean;
    } | null;
    trainingMarkCleared?: TrainingMarkCleared | null;
  },
): { fact: string | null; warnings: string[] } {
  const { trainingDive, trainingMarkCleared } = diver;
  return {
    fact: trainingDive ? t("manifest.trainingDive", { course: trainingDive.courseTitle }) : null,
    warnings: [
      trainingDive?.siteAttributionUnknown ? t("manifest.trainingSiteAttributionUnknown") : null,
      trainingDive && !trainingDive.instructorAboard
        ? t(
            trainingDive.overRatio
              ? "manifest.trainingDiveOverRatio"
              : "manifest.trainingDiveNoInstructor",
          )
        : null,
      trainingMarkCleared
        ? t(
            trainingMarkCleared.reason === "mark_invalid"
              ? "manifest.trainingMarkClearedInvalid"
              : "manifest.trainingMarkCleared",
            {
              hasName: trainingMarkCleared.byName ? "yes" : "no",
              name: trainingMarkCleared.byName ?? "",
            },
          )
        : null,
    ].filter((line): line is string => line !== null),
  };
}
