import {
  medicalHoldChip,
  medicalWarningChips,
  rollCallLabelText,
  trainingDiveLines,
} from "@/i18n/manifest-labels";
import { formatTime } from "@/lib/format";
import { isHeldSeat } from "@/lib/held-seat";
import { rollCallLabel, rollCallRecordedTone, rollCallRowState } from "@/lib/manifests";
import {
  latestOfflineArrival,
  offlineArrivalEvents,
  offlineTrainingReadinessStale,
} from "@/lib/offline-manifests";
import { joinedDiving, leftDiving } from "@/lib/participant-types";
import { runningLateOnManifest } from "@/lib/running-late";
import type { OfflineTripControls } from "./controls";
import { offlineDiverStatusLine } from "./status-line";
import type { OfflineTripView } from "./trip-view";

type OfflineDiver = OfflineTripView["manifest"]["divers"][number];

/**
 * **What one saved diver's row says at this checkpoint** — read once, for the
 * screen's roll-call row and the saved copy's paper sheet alike (issue #2745),
 * so the sheet a crew prints offshore can never say something the row on the
 * phone does not. Pure: the view the counts were built from, the words, and
 * nothing else.
 */
export function offlineDiverRowFacts(
  diver: OfflineDiver,
  index: number,
  view: OfflineTripView,
  { t, locale }: Pick<OfflineTripControls, "t" | "locale">,
) {
  const { checkpoint, isDeparture } = view;
  // The one answer the head count above this row was built from
  // (`offlineTripView`); a second call here could drift from it.
  const state = view.localStates[index];
  const staleTrainingReadiness = offlineTrainingReadinessStale(view.envelope.snapshot, diver);
  const ready = diver.readiness.status === "ready" && !staleTrainingReadiness;
  // The live manifest's own derivation, not a second copy of it
  // (`src/lib/manifests.ts`). The copy this replaces got two things
  // wrong that only showed on the water: it keyed the *boarded* fill
  // off "any result exists", so a diver recorded **not boarded** at
  // the dock rendered in the aboard colour, and it painted a diver
  // nobody had called yet amber with a ring — the two marks reserved
  // for "left ashore" and "did not come back".
  const rowState = rollCallRowState(checkpoint, state);
  const missing = rowState.notBackAboard;
  const recordedTone = rollCallRecordedTone(rowState);
  // The live page's rule for the fill, from the one predicate both read
  // (`blockedAtRail`, issue #2286): at the dock a diver readiness has not
  // cleared is blocked, and so is one after a dive with no earlier boarding;
  // aboard over that block keeps the blocked tone rather than the boarded green.
  const blockedAtDock =
    (isDeparture && staleTrainingReadiness) || (view.blockedAtRail[index] ?? !ready);
  // Same condition the live page passes as `showBoardControl`: divers
  // only board at departure once readiness clears them, so a blocked
  // diver's circle is a drawn held ring with no tap.
  const showBoardControl = ready || !isDeparture;
  // The live roll call's four medical warnings, dates only: two riding-only
  // (H-20261009-rider-snorkeler-medical), an earlier refusal (H-20261007-after-physician-says-no) and a referral still open (#2163). A
  // held seat never carries them, and the facts block says why instead.
  const withheld = diver.identityWithheld || isHeldSeat(diver);
  const medicalWarnings = withheld ? undefined : diver.medicalWarnings;
  // The live roll call's capsule for the same facts, strongest first: riding
  // only (H-20261009-rider-snorkeler-medical), then an earlier refusal (H-20261007-after-physician-says-no), then an open referral.
  // Ahead of them, after a dive, the live row's medical-hold capsule (#2380):
  // a diver boarded over a physician's "no" or an open review, read through
  // the one predicate both surfaces share (`medicalHoldAfterDive`).
  const medicalHold = withheld ? null : (view.medicalHold[index] ?? null);
  const medicalChip = medicalHold
    ? medicalHoldChip(t, medicalHold)
    : medicalWarnings
      ? medicalWarningChips(t, medicalWarnings)[0]
      : undefined;
  const training = trainingDiveLines(t, diver);
  // The diver's own "running late" (#2319), on the live page's terms: a dock
  // row not boarded yet, with nothing from the counter on it — this device's
  // queued arrival included, which is the counter's newest word here.
  const arrived =
    latestOfflineArrival(
      view.envelope.snapshot,
      diver.bookingId,
      offlineArrivalEvents(view.envelope),
    )?.state === "arrived";
  const lateAt = runningLateOnManifest({
    checkpoint,
    runningLateAt: diver.runningLateAt ? new Date(diver.runningLateAt) : null,
    rollCallState: state?.state,
    checkedIn: arrived,
    notHere: diver.notHere,
  });
  const stateWord = `${rollCallLabelText(t, rollCallLabel(checkpoint, state))}${
    state?.pending ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}` : ""
  }`;
  const statusLine = offlineDiverStatusLine({
    stateWord,
    blockerTexts: staleTrainingReadiness
      ? [
          t("manifest.trainingReadinessStale"),
          ...diver.readiness.blockers.map((blocker) => blocker.text),
        ]
      : ready
        ? null
        : diver.readiness.blockers.map((blocker) => blocker.text),
    blockedWord: t("shared.offlineManifest.single.blockedBadge"),
    notHereWord: diver.notHere
      ? diver.turnedAway
        ? t("shared.offlineManifest.single.turnedAwayBadge")
        : t("shared.offlineManifest.single.notHereBadge")
      : null,
    medicalWord: medicalChip ?? null,
    medicalAlertWord: diver.medicalAlert && !withheld ? t("manifest.medicalAlertChip") : null,
    participantWord: participantWord(diver, t),
    lateWord: lateAt
      ? t("manifest.runningLate", {
          time: formatTime(lateAt, locale, view.envelope.snapshot.shop.timezone),
        })
      : null,
  });
  return {
    state,
    rowState,
    missing,
    recordedTone,
    blockedAtDock,
    showBoardControl,
    withheld,
    medicalWarnings,
    training,
    statusLine,
  };
}

/**
 * Snorkeler or rider, as on the live roll call (ADR 20261007-participant-types):
 * every row is still called; this only says who the body is.
 */
function participantWord(diver: OfflineDiver, t: OfflineTripControls["t"]): string | null {
  const left = leftDiving(diver);
  if (left === "snorkeler") return t("manifest.participantType.bookedAsDiver.snorkeler");
  if (left === "rider") return t("manifest.participantType.bookedAsDiver.rider");
  const joined = joinedDiving(diver);
  if (joined === "snorkeler") return t("manifest.participantType.bookedAsNonDiver.snorkeler");
  if (joined === "rider") return t("manifest.participantType.bookedAsNonDiver.rider");
  if (diver.participantType === "snorkeler") return t("manifest.participantType.snorkeler");
  if (diver.participantType === "rider") return t("manifest.participantType.rider");
  return null;
}
