import { RollCallMark } from "@/components/RollCallMark";
import { RollCallMarkTap, rollCallMarkState } from "@/components/RollCallMarkTap";
import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import {
  medicalHoldChip,
  medicalWarningChips,
  ridingOnlyMedicalSentences,
  rollCallLabelText,
  trainingDiveLines,
} from "@/i18n/manifest-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { formatTime } from "@/lib/format";
import { isHeldSeat } from "@/lib/held-seat";
import {
  type RollCallRecordedTone,
  rollCallLabel,
  rollCallRecordedTone,
  rollCallRowState,
} from "@/lib/manifests";
import { latestOfflineArrival, offlineArrivalEvents } from "@/lib/offline-manifests";
import { joinedDiving, leftDiving } from "@/lib/participant-types";
import { runningLateOnManifest } from "@/lib/running-late";
import type { OfflineTripControls } from "./controls";
import { OfflineRollCallException } from "./RollCallException";
import {
  BUDDY_NAMES_WRAP,
  buddyNamesList,
  OFFLINE_DISCLOSURE_SUMMARY_CLASS,
  offlineRollCallRowId,
  reTap,
} from "./shared";
import { offlineDiverStatusLine } from "./status-line";
import type { OfflineTripView } from "./trip-view";

/**
 * The diver roll call at this checkpoint — one row per diver, each with its
 * one tap and its exception panel (#1840).
 */
export function OfflineDiverRollCall({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { manifest } = view;
  return (
    <ul
      id="offline-roll-call"
      tabIndex={-1}
      className={sectionCardClass({
        padding: "none",
        className: "mt-4 divide-y divide-border overflow-hidden outline-none",
      })}
    >
      {manifest.divers.map((diver, index) => (
        <OfflineDiverRow
          key={diver.bookingId}
          diver={diver}
          index={index}
          view={view}
          controls={controls}
        />
      ))}
    </ul>
  );
}

/**
 * One diver's roll-call row: their state at this checkpoint, the circle that
 * boards them, and the panel holding the exception and its sentence.
 */
function OfflineDiverRow({
  diver,
  index,
  view,
  controls,
}: {
  diver: OfflineTripView["manifest"]["divers"][number];
  /** Where this diver sits in the saved roster. */
  index: number;
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const { checkpoint, isDeparture, expired } = view;
  const { t, locale, busyBooking, record } = controls;
  // The one answer the head count above this row was built from
  // (`offlineTripView`); a second call here could drift from it.
  const state = view.localStates[index];
  const ready = diver.readiness.status === "ready";
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
  const blockedAtDock = view.blockedAtRail[index] ?? !ready;
  // Same condition the live page passes as `showBoardControl`: divers
  // only board at departure once readiness clears them, so a blocked
  // diver's circle is a drawn held ring with no tap.
  const showBoardControl = ready || !isDeparture;
  // The live roll call's four medical warnings, dates only: two riding-only
  // (H-109), an earlier refusal (H-98) and a referral still open (#2163). A
  // held seat never carries them, and the facts block below says why instead.
  const withheld = diver.identityWithheld || isHeldSeat(diver);
  const medicalWarnings = withheld ? undefined : diver.medicalWarnings;
  // The live roll call's capsule for the same facts, strongest first: riding
  // only (H-109), then an earlier refusal (H-98), then an open referral.
  // Ahead of them, after a dive, the live row's medical-hold capsule (#2380):
  // a diver boarded over a physician's "no" or an open review, read through
  // the one predicate both surfaces share (`medicalHoldAfterDive`).
  const medicalHold = withheld ? null : (view.medicalHold[index] ?? null);
  const medicalChip = medicalHold
    ? medicalHoldChip(t, medicalHold)
    : medicalWarnings
      ? medicalWarningChips(t, medicalWarnings)[0]
      : undefined;
  const warningDate = (day: string) => formatCalendarDate(day, locale);
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
  return (
    <li
      key={diver.bookingId}
      id={offlineRollCallRowId(diver.bookingId)}
      // Every row is a jump target — the missing-divers grid is
      // handed this very id for any uncalled person, which is why
      // one function mints it rather than a literal here and a
      // prefix there (#1675) — so every row carries the scroll
      // margin that keeps a landed row off the top edge, not just
      // the two states that used to. Not the live page's sticky
      // checkpoint panel, which this page does not have: nothing
      // on this surface is sticky or fixed (the grid's own note
      // below turns on the same fact).
      //
      // A blocked row wears its danger in the status line's ink only, on the
      // tone of what was recorded (visual review polish, B01), as the "At the
      // counter" block does: no pink wash and red rule on top of red words.
      // Aboard over a block is never the calm boarded green (review of
      // #1840), so it takes the awaiting slate; the words still say Blocked.
      className={`scroll-mt-24 border-l-4 p-4 sm:p-5 ${offlineRowTone(recordedTone, blockedAtDock)}`}
    >
      {/* **A name and a mark** at rest, as on the live roll call: the
        circle on the trailing edge is the row's one tap (#1840), and the
        exception sits a deliberate tap away in the panel under the name.
        An expired copy has no tap, so its sentence takes the column and
        stacks under the name on a phone. */}
      <div
        className={
          expired
            ? "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
            : "flex items-start gap-3"
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* **The first line takes the boat buttons' height,
              through the chip's wrapper** (`sm:h-14`), so the chip and
              the name share the 56px mark's centre. Not on an expired
              copy, whose right column is one sentence, not buttons.

              `bg-surface`, never the awaiting row's own sunken fill: a
              chip painted the row's colour has no edge. */}
            <span className={`flex shrink-0 items-center${expired ? "" : " sm:h-14"}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-sm font-bold tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
            </span>
            <h3 className={`min-w-0 break-words ${ITEM_TITLE_CLASS}`}>{diver.fullName}</h3>
          </div>
          {/* **One status line** (visual review 2026-10-24, B01): the row's
            roll-call state, then whatever stands in the way or must be in
            view at the rail, in the order the chips this replaces stood.
            Every word the chips said is still here; only the pills went.
            Readiness is said at every checkpoint, because this copy is what
            the desk knew and a boat with no signal has nowhere else to read
            it. Danger ink only for a diver not back aboard or blocked at the
            rail (`blockedAtRail`, #2286): after a dive a boarded diver's block
            is words in plain ink, never the red that means a diver has not
            come back (layer 4 review, dde-a F2). The page's
            banner says once that this is a saved copy, so no word here says
            "when saved". */}
          <p
            className={`mt-1 text-base font-semibold break-words ${
              missing || blockedAtDock ? "text-danger" : "text-ink"
            }`}
          >
            {offlineDiverStatusLine({
              stateWord,
              blockerTexts: ready ? null : diver.readiness.blockers.map((blocker) => blocker.text),
              blockedWord: t("shared.offlineManifest.single.blockedBadge"),
              notHereWord: diver.notHere
                ? diver.turnedAway
                  ? t("shared.offlineManifest.single.turnedAwayBadge")
                  : t("shared.offlineManifest.single.notHereBadge")
                : null,
              medicalWord: medicalChip ?? null,
              medicalAlertWord:
                diver.medicalAlert && !withheld ? t("manifest.medicalAlertChip") : null,
              participantWord: participantWord(diver, t),
              lateWord: lateAt
                ? t("manifest.runningLate", {
                    time: formatTime(lateAt, locale, view.envelope.snapshot.shop.timezone),
                  })
                : null,
            })}
          </p>
          {!withheld && diver.safetyAdvisoryText ? (
            <p className="mt-2 text-base text-warning-strong">{diver.safetyAdvisoryText}</p>
          ) : null}
          {/* **What is already on the record, in the open** (ADR
            20260828-a-missing-diver-gets-a-sentence, decision 4; layer 4
            review, dde-b 2): the observation a crew wrote on an alarmed
            row sits under the status line, never behind "Contact & gear",
            so a crew member offshore reads it before writing it twice. */}
          {state?.note ? <p className="mt-1 max-w-xl text-base break-words">{state.note}</p> : null}
          <details className="group/offlinefacts mt-2 max-w-xl">
            <summary className={OFFLINE_DISCLOSURE_SUMMARY_CLASS}>
              <DisclosureCaret className="group-open/offlinefacts:rotate-90" />
              <span className="group-hover/summary:underline">
                {t(
                  medicalWarnings
                    ? "manifest.diverFactsSummaryWithMedical"
                    : "manifest.diverFactsSummary",
                )}
              </span>
            </summary>
            <div className="mb-1 grid gap-2 rounded-inset border border-border/70 bg-surface-sunken/50 p-3 text-base">
              {/* The saved team, always quiet here: this copy shows who you
                are with and never judges whether the team is split. */}
              {diver.buddyTeamNames && diver.buddyTeamNames.length > 0 ? (
                <p className={BUDDY_NAMES_WRAP}>
                  {t("shared.buddyTeam.with", {
                    names: buddyNamesList(locale, diver.buddyTeamNames),
                  })}
                </p>
              ) : null}
              {/* A held seat was saved with the matched person's
                particulars already cleared (`serializeManifests`),
                so it says why rather than "Not on file" (issue
                #1690). Either signal withholds: the saved flag, or
                the identity blocker on the row, failing closed. */}
              {withheld ? (
                <>
                  <p className="text-muted">{t("manifest.identityWithheldDetails")}</p>
                  {/* The desk's contact for the person on the seat (issue
                    #2145), saved in a field of its own, and only on a row
                    the save withheld: nothing from `emergencyContact*` is
                    ever read here (H7, Y3). */}
                  {diver.identityWithheld && diver.heldEmergencyContact ? (
                    <p>
                      <span className="font-bold">{t("manifest.heldEmergencyContactLabel")}</span>
                      <span className="mt-0.5 block text-muted">
                        {`${diver.heldEmergencyContact.name} · ${diver.heldEmergencyContact.phone}`}
                      </span>
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <p>
                    <span className="font-bold">
                      {t("shared.offlineManifest.single.emergencyContact")}
                    </span>
                    <span className="mt-0.5 block text-muted">
                      {diver.emergencyContactName && diver.emergencyContactPhone
                        ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                        : t("shared.offlineManifest.single.notOnFile")}
                    </span>
                  </p>
                  {/* Omitted when nothing was recorded and no nitrox asked
                    for: a fact not recorded is never shown as one (B51), the
                    live facts block's own rule. */}
                  {diver.participantType === "rider" ||
                  (diver.rentalFit.state === "not_recorded" && !diver.nitroxRequested) ? null : (
                    <p>
                      <span className="font-bold">
                        {t("shared.offlineManifest.single.rentalFit")}
                      </span>
                      <span className="mt-0.5 block text-muted">
                        {rentalFitLineText(t, locale, diver.rentalFit)}
                        {diver.nitroxRequested
                          ? ` ${t("shared.offlineManifest.single.nitroxRequestedSuffix")}`
                          : ""}
                      </span>
                    </p>
                  )}
                  {diver.dietaryNote ? (
                    <p>
                      <span className="font-bold">{t("manifest.dietaryNoteLabel")}</span>
                      <span className="mt-0.5 block text-muted break-words">
                        {diver.dietaryNote}
                      </span>
                    </p>
                  ) : null}
                  {/* The medical alert's words, as the diver wrote them, on a
                    copy a permitted reader saved with them on purpose (H-153
                    amendment), with who saved it and that nobody reviewed it;
                    otherwise that this copy was saved without them and who can
                    save one that has them. Reading it here writes no event:
                    the save was recorded when the server handed them out. */}
                  {diver.medicalAlert ? (
                    <p>
                      <span className="font-bold">{t("manifest.medicalAlertHeading")}</span>
                      {diver.medicalAlert.text ? (
                        <>
                          <span className="mt-0.5 block break-words whitespace-pre-wrap">
                            {diver.medicalAlert.text}
                          </span>
                          {view.envelope.medicalAlertsSavedBy ? (
                            <span className="mt-0.5 block text-muted">
                              {t("manifest.medicalAlertSavedBy", {
                                name: view.envelope.medicalAlertsSavedBy.name,
                              })}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-muted">
                            {t("manifest.medicalAlertNotReviewed")}
                          </span>
                        </>
                      ) : (
                        <span className="mt-0.5 block text-muted">
                          {t("manifest.medicalAlertReadersOffline")}
                        </span>
                      )}
                    </p>
                  ) : null}
                  {/* The live manifest's own sentences, in the same tone
                    (`DiverRollCall.tsx` under `/manifest`). */}
                  {medicalWarnings ? (
                    <p>
                      {ridingOnlyMedicalSentences(t, medicalWarnings, warningDate).map((line) => (
                        <span key={line} className="block font-medium text-warning-strong">
                          {line}
                        </span>
                      ))}
                      {medicalWarnings.refusedOn ? (
                        <span className="block font-medium text-warning-strong">
                          {t("manifest.medicalEarlierRefusal", {
                            date: warningDate(medicalWarnings.refusedOn),
                          })}
                        </span>
                      ) : null}
                      {medicalWarnings.referredOn ? (
                        <span className="mt-0.5 block font-medium text-warning-strong">
                          {t("manifest.medicalReferralUnresolved", {
                            date: warningDate(medicalWarnings.referredOn),
                          })}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {/* A training dive, worded as the live manifest words it. */}
                  {training.fact ? <p>{training.fact}</p> : null}
                  {training.warnings.map((line) => (
                    <p key={line} className="font-medium text-warning-strong">
                      {line}
                    </p>
                  ))}
                </>
              )}
            </div>
          </details>
        </div>
        {expired ? (
          // `sm:py-1.5` centres the sentence's first 20px line on the name
          // line's 32px beside it, which keeps the chip's height on an
          // expired copy (above).
          <p className="text-sm font-semibold text-danger sm:py-1.5">
            {t("shared.offlineManifest.single.record.expiredRecordOnLive")}
          </p>
        ) : (
          // The mark column: `ps-3` is the gap the circle's square hit area
          // reaches across (`ROLL_CALL_MARK_BUTTON_CLASS`), so a tap that
          // misses the circle lands on it and never on the name's disclosure.
          <div className="flex shrink-0 ps-3">
            {missing ? (
              // Recorded not back aboard: no tap on the row. Both ways out
              // are in the panel, at the same cost (ADR
              // 20260815-offline-can-unsay-a-missing-diver). The state is in
              // words on the row's pill, so the mark stays drawn only.
              <RollCallMark state="notBack" />
            ) : showBoardControl ? (
              <RollCallMarkTap
                state={rollCallMarkState(rowState)}
                // The live page's own names, the settled one undo-bearing
                // (PR #607 review): a captain alternates between the two
                // surfaces mid-morning.
                label={
                  state?.state === "boarded"
                    ? t("manifest.boardedCheckAriaLabel")
                    : t("shared.offlineManifest.single.markBoarded")
                }
                busy={busyBooking === diver.bookingId}
                onTap={() =>
                  void record(
                    { bookingId: diver.bookingId },
                    // Re-tapping a settled "Boarded" mark retracts it, as the
                    // live control does — only ever **this device's own**
                    // statement (`OfflineRollCallResult.local`).
                    reTap(state, state?.state === "boarded", "boarded"),
                    state,
                  )
                }
              />
            ) : (
              // Blocked at the dock: the act that clears them is ashore, so
              // the mark is drawn and not tappable, as on the live page. It
              // still draws what was recorded — aboard or ashore before the
              // held ring — so it never contradicts the pill (review of #1840).
              <RollCallMark state={rollCallMarkState(rowState, { blockedAtDock: true })} />
            )}
          </div>
        )}
      </div>
      {/* Under the whole row rather than the name's column, so its controls
        take the row's width on a phone: in the column beside the circle a
        "Mark not back aboard" wrapped to two lines. */}
      {expired ? null : (
        <OfflineRollCallException
          // Closes an opened panel when the crew moves to the next count.
          key={checkpoint}
          subject={{ bookingId: diver.bookingId }}
          subjectKey={diver.bookingId}
          name={diver.fullName}
          state={state}
          rowState={rowState}
          isDeparture={isDeparture}
          isCrew={false}
          controls={controls}
        />
      )}
    </li>
  );
}

/**
 * Snorkeler or rider, as on the live roll call (ADR 20261007-participant-types):
 * every row is still called; this only says who the body is.
 */
function participantWord(
  diver: OfflineTripView["manifest"]["divers"][number],
  t: OfflineTripControls["t"],
): string | null {
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

/**
 * **A saved row's fill**: the recorded tone, except that a block never paints
 * the row (visual review polish, B01). The status line carries the block in
 * danger ink and the mark draws the held ring, so the fill only says what was
 * recorded; aboard over a block takes the awaiting slate rather than the
 * boarded green, which would tell the captain the opposite of the words.
 * "Did not come back" keeps its own fill and ring: that is a recorded state.
 */
function offlineRowTone(recordedTone: RollCallRecordedTone | null, blockedAtDock: boolean): string {
  if (recordedTone === "boarded" && blockedAtDock) return ROLL_CALL_ROW_TONE.awaiting;
  return recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : ROLL_CALL_ROW_TONE.awaiting;
}
