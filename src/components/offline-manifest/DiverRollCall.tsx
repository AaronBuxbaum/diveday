import { RollCallMark } from "@/components/RollCallMark";
import { RollCallMarkTap, rollCallMarkState } from "@/components/RollCallMarkTap";
import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { Badge } from "@/components/ui/badge";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import { readinessStatusTone } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { formatCalendarDate } from "@/lib/calendar-date";
import { isHeldSeat } from "@/lib/held-seat";
import { rollCallLabel, rollCallRecordedTone, rollCallRowState } from "@/lib/manifests";
import { joinedDiving, leftDiving } from "@/lib/participant-types";
import type { OfflineTripControls } from "./controls";
import { OfflineRollCallException } from "./RollCallException";
import {
  OFFLINE_DISCLOSURE_SUMMARY_CLASS,
  OfflineBuddyTeamChip,
  offlineRollCallRowId,
  reTap,
} from "./shared";
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
  // Untouched: the same rule the live page uses — at the dock a
  // diver readiness has not cleared is blocked, and readiness is the
  // thing to fix before boarding; everywhere else nothing has been
  // said yet.
  const untouchedTone =
    ready || !isDeparture ? ROLL_CALL_ROW_TONE.awaiting : ROLL_CALL_ROW_TONE.blocked;
  // Same condition the live page passes as `showBoardControl`: divers
  // only board at departure once readiness clears them, so a blocked
  // diver's circle is a drawn held ring with no tap.
  const showBoardControl = ready || !isDeparture;
  // The live roll call's two medical warnings (issue #2163), dates only. A
  // held seat never carries them, and the facts block below says why instead.
  const withheld = diver.identityWithheld || isHeldSeat(diver);
  const medicalWarnings = withheld ? undefined : diver.medicalWarnings;
  const warningDate = (day: string) => formatCalendarDate(day, locale);
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
      className={`scroll-mt-24 border-l-4 p-4 sm:p-5 ${
        recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : untouchedTone
      }`}
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
          <div className="flex flex-wrap items-center gap-2">
            {/* **The first line takes the boat buttons' height,
              through the chip's wrapper** (`sm:h-14`), so the
              chip, the name and the readiness badge share the
              56px buttons' centre rather than riding 12px above
              it. On the wrapper and not the whole box: on most
              rows the state word and buddy team wrap to a second
              line (32 + 8 + 30 = 70px, past 56), and a min height
              on the box did nothing there. Not on an expired copy,
              whose right column is one sentence, not buttons.

              `bg-surface`, never the awaiting row's own sunken
              fill: a chip painted the row's colour has no edge, and
              its number started 7px right of the row's. */}
            <span className={`flex shrink-0 items-center${expired ? "" : " sm:h-14"}`}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface text-sm font-bold tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
            </span>
            <h3 className={ITEM_TITLE_CLASS}>{diver.fullName}</h3>
            {/* The shared pill, and the shared tone resolver. The
              hand-rolled one this replaces paired `text-success`
              with `bg-success/10`, the combination `Badge`
              documents as measuring under AA at pill sizes — on
              the surface read in direct sunlight. The words stay
              the offline ones ("Ready when saved"), because that
              distinction is real: this is a snapshot, not live.

              **Every checkpoint, unlike the live capsule and
              unlike the grid below.** The live row's readiness
              word is `blockedAtDock` — one exception capsule, and
              readiness stops being an exception once the boat is
              back. This is a different construct: a two-state
              statement on every diver saying what the desk knew
              when this copy was taken, which is the per-diver
              instance of the freshness banner at the top of the
              page. Gating it would have to gate the blocked half
              alone — leaving "Ready when saved" as the only
              readiness word on the page and silence beside the one
              diver it is not true of — and the desk's record has
              nowhere else to be read on a boat with no signal. The
              row's *alarm* already follows the live rule: its
              untouched fill is checkpoint-gated above. */}
            <Badge tone={readinessStatusTone(ready ? "ready" : "blocked")}>
              {ready
                ? t("shared.offlineManifest.single.readyBadge")
                : t("shared.offlineManifest.single.blockedBadge")}
            </Badge>
            {/* **The desk released this seat** (#1209), with the
              same qualifier the badge above wears and for the same
              reason: a copy saved at 07:05 cannot know that the
              counter put them back on the list at 07:20. Neutral,
              because it is the absence of an exception rather than
              one, and it refuses nothing — the control below still
              boards a body the crew can see, which is the live
              manifest's rule on a phone with no signal. Without
              it this copy is the one surface where a written-off
              name and a diver still walking down the dock are the
              same row. */}
            {diver.notHere ? (
              <Badge tone="neutral">{t("shared.offlineManifest.single.notHereBadge")}</Badge>
            ) : null}
            {/* The live roll call's capsule for the same fact (H-98): a
              physician refused an earlier release. Never a block; the
              crew at the rail decides with it in view. */}
            {medicalWarnings?.refusedOn ? (
              <Badge tone="warning">{t("manifest.medicalEarlierRefusalChip")}</Badge>
            ) : medicalWarnings?.referredOn ? (
              <Badge tone="warning">{t("manifest.medicalReferralUnresolvedChip")}</Badge>
            ) : null}
            {/* Snorkeler or rider, as on the live roll call (ADR
              20261007-participant-types). Every row is still called;
              this only says who the body is. */}
            {leftDiving(diver) === "snorkeler" ? (
              <Badge tone="warning">{t("manifest.participantType.bookedAsDiver.snorkeler")}</Badge>
            ) : leftDiving(diver) === "rider" ? (
              <Badge tone="warning">{t("manifest.participantType.bookedAsDiver.rider")}</Badge>
            ) : joinedDiving(diver) === "snorkeler" ? (
              <Badge tone="warning">
                {t("manifest.participantType.bookedAsNonDiver.snorkeler")}
              </Badge>
            ) : joinedDiving(diver) === "rider" ? (
              <Badge tone="warning">{t("manifest.participantType.bookedAsNonDiver.rider")}</Badge>
            ) : diver.participantType === "snorkeler" ? (
              <Badge tone="neutral">{t("manifest.participantType.snorkeler")}</Badge>
            ) : diver.participantType === "rider" ? (
              <Badge tone="neutral">{t("manifest.participantType.rider")}</Badge>
            ) : null}
            {/* Same resolver the live manifest renders (DOM-H3):
              one word list, so a diver who has not come back from
              dive one cannot read "Not boarded" here and "Not back
              aboard" on the captain's screen. */}
            {/* The neutral word wears a border and the surface
              fill, so its box is painted on the sunken awaiting
              row: the pill used to be that row's own fill, so its
              padding was invisible and its word started at
              nobody's edge. It keeps its foreground semibold ink,
              not the neutral `Badge`'s muted medium: this is the
              row's state in words, read across a wet deck, and
              the defect was the pill's edge, never the word. */}
            {missing ? (
              <span className="rounded-full bg-danger/15 px-3 py-1 text-sm font-bold text-danger">
                {stateWord}
              </span>
            ) : (
              <span className="rounded-full border border-border bg-surface px-3 py-1 text-sm font-semibold">
                {stateWord}
              </span>
            )}
            {/* The saved team, always quiet here: this copy shows
              who you are with and never judges whether the team is
              split — that read is live-roll-call only (see the
              note above the list). */}
            <OfflineBuddyTeamChip t={t} locale={locale} names={diver.buddyTeamNames} />
          </div>
          {/* What is already on the record about this person, from
            whichever statement this row is showing — the saved
            snapshot or this device's own queued event. Without it a
            crew member offshore meets an empty box on an alarmed
            row and writes the same observation twice, while the
            live manifest and the departure log carry the first
            one. */}
          {state?.note ? <p className="mt-1 text-sm">{state.note}</p> : null}
          {/* The live manifest's "Contact & gear" disclosure, in the
            same clothes and under the same words — this copy and
            that one are read minutes apart by the same captain, and
            reference facts standing open on every row here while
            they fold there is the divergence this closes.

            `manifest.diverFactsSummary`, not an offline key
            of its own: one word list is the whole point, exactly as
            `rollCallLabelText` is shared for the state pills above.

            The only medical facts the dock payload carries are the
            two warnings (`medicalWarnings` in offline-manifests.ts,
            issue #2163), so the summary says "& medical" exactly when
            one of them is on the row. */}
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
              {/* A held seat was saved with the matched person's
                particulars already cleared (`serializeManifests`),
                so it says why rather than "Not on file" (issue
                #1690). Either signal withholds: the saved flag, or
                the identity blocker on the row, failing closed. */}
              {withheld ? (
                <p className="text-muted">{t("manifest.identityWithheldDetails")}</p>
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
                  {diver.participantType === "rider" ? null : (
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
                  {/* The live manifest's own sentences, in the same tone
                    (`DiverRollCall.tsx` under `/manifest`). */}
                  {medicalWarnings ? (
                    <p>
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
                </>
              )}
            </div>
          </details>
          {!ready ? (
            <ul className="mt-2 text-sm text-danger">
              {diver.readiness.blockers.map((blocker) => (
                <li key={blocker.code}>• {blocker.text}</li>
              ))}
            </ul>
          ) : null}
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
