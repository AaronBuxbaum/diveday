import { blockedAtRail, type RollCallCheckpoint, type TripManifest } from "@/lib/manifests";
import { runningLateOnManifest } from "@/lib/running-late";
import { medicalWarningDays } from "@/lib/waivers";
import { rollCallRecordedTone, rollCallRowState } from "./RollCallControls";

/**
 * Which of the row's exceptions took its one capsule — or none. The printed
 * block reads it to say the *other* facts without repeating this one.
 */
export type DiverCapsuleKind = "buddy" | "blocked" | "medical" | "minor" | "depth" | "birthday";

/**
 * **What one diver's row is, before anything is drawn**: the recorded
 * roll-call state, whether readiness still gates them here, whether the row
 * is the alarm, and which exception earned the one capsule. Every part of the
 * row — the mark, the capsule, the panel, the printed block — reads these
 * from one derivation, so no two of them can disagree about the same diver.
 */
export function diverRowState(
  diver: TripManifest["divers"][number],
  checkpoint: RollCallCheckpoint,
  isDeparture: boolean,
  /** The shop's zone, which dates the medical warnings. */
  timezone: string,
) {
  const diverStatus = diver.readiness.status;
  const ready = diverStatus === "ready";
  const rc = diver.rollCall;
  // One derivation of what a roll-call record means, shared with the
  // crew list and the mark (`rollCallRowState`).
  const rowState = rollCallRowState(checkpoint, rc);
  const { impliedNotBoarded } = rowState;
  // Each roll-call state gets its own fill (`ROLL_CALL_ROW_TONE`) so
  // staff can tell at a glance who has been handled — aboard green,
  // left ashore amber, not back aboard red, nothing said yet slate.
  //
  // Untouched rows are where the diver list differs from the crew's: at
  // the dock a blocked diver's readiness *is* the thing to fix before
  // they board, so the row says so. After a dive it is not — roll call
  // there is a physical head count that readiness never gates, and a
  // danger-tinted row for a paperwork state would compete with the one
  // red on the page that means somebody is in the water (DD9), which is
  // also decision 4's rule: an alarm is earned by a recorded fact.
  //
  // After a dive, a first boarding reads as the dock's (`blockedAtRail`).
  const recordedTone = rollCallRecordedTone(rowState);
  const blockedAtDock = blockedAtRail({
    ready,
    isDeparture,
    boardedEarlier: diver.boardedEarlier,
    notBackAboard: rowState.notBackAboard,
  });
  // **"Running late, said 7:42"** (#2319): the diver's word, on a dock row
  // not boarded yet. Context under the name, never a roll-call result.
  const lateAt = runningLateOnManifest({ checkpoint, ...diver, rollCallState: rc?.state });
  // Every row is a jump target — the count panel's chips link to any
  // uncalled person — so every row carries the scroll margin that keeps
  // its name clear of the sticky panel. Shared with the crew rows.
  // Only a *recorded* not-back moves. Aboard, ashore and to-call rows
  // stay where the manifest put them, because only this one is an
  // alarm — and a row that shifts under a thumb mid-count is the
  // mis-tap `rollCallScrollMargin` exists to bound, so it is spent
  // once, on the one state that earns it.
  const alarmed = rowState.notBackAboard;
  // A diver only boards at the dock once readiness clears them. Their
  // row then carries a *static* held ring rather than a tap: the act
  // that unblocks them is ashore on the Trip tab, and offering a tap
  // that the server would refuse is a control that lies.
  const boardingControlShown = ready || !isDeparture;
  // **At most one capsule, and only for an exception** (ADR
  // 20260827-the-departure-is-two-working-surfaces, decision 1). A row
  // at rest is a name and a mark; the expected state is quiet. This is
  // the priority when a diver is several things at once, loudest first
  // — a team that did not come back after a dive outranks a desk
  // blocker outranks a split buddy team at the dock outranks a medical
  // warning outranks the crew's duty of care to a minor outranks
  // an advisory outranks a birthday. Everything not chosen here still
  // reaches the reader: it is in the panel one tap away, and
  // unconditionally on paper.
  //
  // **The medical warnings** (`medicalWarningChips`, strongest first):
  // a rider riding only under a "no" or an open referral (H-109), an
  // earlier refusal (H-98), a referral replaced (#1282). Each boards,
  // so none is a blocker, but the crew at the rail decides with it in
  // view. The capsule takes the first; paper prints the rest, and
  // every other fact the capsule did not take, never one twice.
  //
  // Read here in the shop's zone; the chips carry no date, so which
  // warnings exist is all the capsule chain needs from them.
  const medicalDays = medicalWarningDays(diver.medicalWaiver, timezone, diver.riderMedicalHold);
  const medicalWarned = Object.values(medicalDays).some(Boolean);
  // A diver recorded not back aboard carries the alarm and nothing
  // else: no birthday, minor or advisory word beside someone in the
  // water (DD9). A split buddy team still shows — it is part of the
  // search. Paper keeps every fact (the block below).
  //
  // **A blocker outranks `separated_dock`** (dive-domain review of the
  // manifest-blocked-aboard capture): at the dock a teammate still
  // ashore is a heads-up, while a blocked diver aboard is this body on
  // a boat it is not cleared for. The row read "Someone not aboard"
  // under a head count saying "1 blocked person aboard".
  const splitAfterDive = diver.buddyAlert === "separated_after_dive";
  // A buddy alert earns the capsule only with a team to name, so the
  // kind below is the capsule the row actually draws.
  const buddyAlerted = Boolean(diver.buddyAlert && diver.buddyTeam);
  const minorAge = Boolean(diver.minor && diver.age !== null && diver.age !== undefined);
  // **One chain** (issue #2307): the kind is decided once, and the
  // capsule is drawn from the kind, so the screen and the printed block
  // below can never disagree about which fact the row already carries.
  const capsuleKind: DiverCapsuleKind | null =
    splitAfterDive && buddyAlerted
      ? "buddy"
      : alarmed
        ? null
        : blockedAtDock
          ? "blocked"
          : buddyAlerted
            ? "buddy"
            : medicalWarned
              ? "medical"
              : minorAge
                ? "minor"
                : diver.depthAdvisory?.status === "exceeds"
                  ? "depth"
                  : diver.birthday
                    ? "birthday"
                    : null;
  return {
    diverStatus,
    ready,
    rc,
    rowState,
    impliedNotBoarded,
    recordedTone,
    blockedAtDock,
    alarmed,
    boardingControlShown,
    lateAt,
    medicalDays,
    splitAfterDive,
    capsuleKind,
  };
}

/** {@link diverRowState}'s answer for one diver. */
export type DiverRowState = ReturnType<typeof diverRowState>;
