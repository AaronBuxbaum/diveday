import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { Badge } from "@/components/ui/badge";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import { readinessStatusTone } from "@/i18n/readiness-labels";
import { rentalFitLineText } from "@/i18n/rental-labels";
import { isHeldSeat } from "@/lib/held-seat";
import { rollCallLabel, rollCallRecordedTone, rollCallRowState } from "@/lib/manifests";
import { joinedDiving, leftDiving } from "@/lib/participant-types";
import type { OfflineTripControls } from "./controls";
import {
  OFFLINE_BOAT_TARGET_CLASS,
  OfflineBuddyTeamChip,
  OfflineRollCallNote,
  OfflineStatusLabel,
  offlineRollCallRowId,
  reTap,
} from "./shared";
import type { OfflineTripView } from "./trip-view";

/**
 * The diver roll call at this checkpoint — one row per diver, each with its
 * board and exception controls.
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
 * One diver's roll-call row: their state at this checkpoint, the board and
 * exception controls, and the sentence a missing diver gets.
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
  const {
    t,
    locale,
    busyBooking,
    confirmAboardFor,
    setConfirmAboardFor,
    noteDrafts,
    setNoteDrafts,
    record,
  } = controls;
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
  // Recorded here at this checkpoint, either way round — a
  // carried-forward dock result is not undoable and gets the
  // "Mark…" wording, same as the live manifest.
  const recordedNotBoarded = rowState.recordedNotBoarded;
  const missing = rowState.notBackAboard;
  const recordedTone = rollCallRecordedTone(rowState);
  // Untouched: the same rule the live page uses — at the dock a
  // diver readiness has not cleared is blocked, and readiness is the
  // thing to fix before boarding; everywhere else nothing has been
  // said yet.
  const untouchedTone =
    ready || !isDeparture ? ROLL_CALL_ROW_TONE.awaiting : ROLL_CALL_ROW_TONE.blocked;
  // Same condition the live page passes as `showBoardControl`: divers
  // only board at departure once readiness clears them. Named, because
  // the exception control's weight now reads it too — it is what
  // decides whether that control is the row's *only* one.
  const showBoardControl = ready || !isDeparture;
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
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

            No medical line to disclose here — the dock payload
            deliberately never carries one (see the allow-list in
            offline-manifests.ts) — so this is always the plain
            two-fact summary, never the "& medical" variant. */}
          <details className="group/offlinefacts mt-2 max-w-xl">
            <summary className="group/summary -mx-2 flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-lg px-2 text-base font-medium text-muted select-none transition-colors hover:bg-surface-sunken/70 hover:text-primary focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden">
              <DisclosureCaret className="group-open/offlinefacts:rotate-90" />
              <span className="group-hover/summary:underline">
                {t("manifest.diverFactsSummary")}
              </span>
            </summary>
            <div className="mb-1 grid gap-2 rounded-inset border border-border/70 bg-surface-sunken/50 p-3 text-base">
              {/* A held seat was saved with the matched person's
                particulars already cleared (`serializeManifests`),
                so it says why rather than "Not on file" (issue
                #1690). Either signal withholds: the saved flag, or
                the identity blocker on the row, failing closed. */}
              {diver.identityWithheld || isHeldSeat(diver) ? (
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
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {expired ? (
            // `sm:py-1.5` centres the sentence's first 20px line on
            // the name line's 32px beside it, which keeps the
            // chip's height on an expired copy (above).
            <p className="text-sm font-semibold text-danger sm:py-1.5">
              {t("shared.offlineManifest.single.record.expiredRecordOnLive")}
            </p>
          ) : (
            <>
              {showBoardControl ? (
                <button
                  type="button"
                  disabled={busyBooking === diver.bookingId}
                  onClick={() => {
                    // **The one act on this surface that takes two
                    // taps, and the second one is somewhere else.**
                    // Over a stated "not back aboard", "Mark aboard"
                    // is a positive sighting — "I have eyes on her,
                    // she's aboard" — and it turns the loudest row
                    // the product has green from a full-width button
                    // directly beneath the one that raised it. So the
                    // first tap arms, and this control becomes the
                    // *safe* choice while the confirmation waits
                    // below, at different coordinates: a double-tap
                    // or a bounce on a wet screen — the exact failure
                    // this exists for — then lands on "keep the
                    // mark", never on the claim (dive-domain review,
                    // 2026-08-15).
                    if (missing && confirmAboardFor !== diver.bookingId) {
                      setConfirmAboardFor(diver.bookingId);
                      return;
                    }
                    if (missing) {
                      setConfirmAboardFor(null);
                      return;
                    }
                    void record(
                      { bookingId: diver.bookingId },
                      // Re-tapping a settled "Boarded" mark retracts
                      // it, exactly as the live control does: a
                      // sighting recorded against the wrong row is
                      // taken back as a retraction, not restated as
                      // its opposite. Only ever **this device's own**
                      // statement — see `OfflineRollCallResult.local`.
                      reTap(state, state?.state === "boarded", "boarded"),
                      state,
                    );
                  }}
                  aria-busy={busyBooking === diver.bookingId}
                  // The live page's exact two faces (RollCallControls):
                  // primary-bordered while unrecorded, success outline
                  // once boarded. A captain alternates between these
                  // two surfaces mid-morning, and the same control
                  // must not change costume between them — including
                  // the settled control's undo-bearing accessible
                  // name (PR #607 review), reusing the live page's
                  // own key since the visible text is identical.
                  aria-label={
                    state?.state === "boarded" && !(missing && confirmAboardFor === diver.bookingId)
                      ? t("manifest.boardedCheckAriaLabel")
                      : undefined
                  }
                  className={`${OFFLINE_BOAT_TARGET_CLASS} ${
                    missing && confirmAboardFor === diver.bookingId
                      ? "border border-border-strong bg-surface-sunken"
                      : state?.state === "boarded"
                        ? "border border-success bg-success/15 text-success"
                        : "border border-primary bg-surface text-primary hover:bg-primary-tint"
                  }`}
                >
                  {busyBooking === diver.bookingId ? (
                    t("shared.offlineManifest.single.saving")
                  ) : missing && confirmAboardFor === diver.bookingId ? (
                    t("shared.offlineManifest.single.confirmAboardCancel")
                  ) : state?.state === "boarded" ? (
                    <OfflineStatusLabel variant="success">
                      {t("shared.offlineManifest.single.boardedDone")}
                    </OfflineStatusLabel>
                  ) : (
                    t("shared.offlineManifest.single.markBoarded")
                  )}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busyBooking === diver.bookingId}
                onClick={() =>
                  record(
                    { bookingId: diver.bookingId },
                    // Re-tap is the undo, the same as on the live
                    // manifest: it queues a **retraction**, so a
                    // mis-tapped "not back aboard" comes off as one
                    // rather than through "Mark aboard", which would
                    // write a sighting nobody made into a record an
                    // insurer may one day read.
                    //
                    // Only over a statement **this device queued**
                    // (`state.local`), and it says which one
                    // (`state.clientEventId`). Aiming a retraction at
                    // a snapshot result could take another crew
                    // member's missing-diver mark off the boat on the
                    // strength of a copy up to a fortnight old
                    // (security review, 2026-08-15); naming the
                    // target is what stops the same thing happening to
                    // a statement of this device's own that a second
                    // device has superseded since it synced (ADR
                    // 20260815-an-offline-retraction-names-its-target).
                    reTap(state, recordedNotBoarded, "not_boarded"),
                    state,
                  )
                }
                aria-busy={busyBooking === diver.bookingId}
                // The exception control, at the live page's weights
                // and by the live page's rules (RollCallControls):
                // most people board, so while nothing is recorded and
                // the board button is on offer this drops its border
                // and fill — the exception at less than equal weight
                // (principle 8), still a full dock-sized target, and
                // still foreground ink, because marking a no-show is
                // routine on the surface with the harshest viewing
                // conditions. It takes the box back the moment it
                // matters: when it is the row's only control (a
                // blocked diver at the dock), or when it carries the
                // recorded state. After a dive it stays neutral too
                // until somebody records a person not back aboard:
                // an alarm is earned by a recorded fact, never by the
                // absence of one (decision 4 of ADR
                // 20260827-the-departure-is-two-working-surfaces), and
                // the live page draws it the same way (issue #2107).
                //
                // Only the departure settled state gets the undo-bearing
                // accessible name — after a dive, "not back aboard"
                // already carries its own visible undo sentence
                // below, and duplicating it here would say it twice.
                aria-label={
                  recordedNotBoarded && isDeparture
                    ? t("manifest.notBoardedCheckAriaLabel")
                    : undefined
                }
                className={
                  missing
                    ? `${OFFLINE_BOAT_TARGET_CLASS} border border-danger bg-danger/15 text-danger`
                    : recordedNotBoarded
                      ? `${OFFLINE_BOAT_TARGET_CLASS} border border-border-strong bg-surface-sunken`
                      : showBoardControl
                        ? `${OFFLINE_BOAT_TARGET_CLASS} hover:bg-surface-sunken`
                        : `${OFFLINE_BOAT_TARGET_CLASS} border border-border hover:bg-surface-sunken`
                }
              >
                {/* No done-check after a dive: a "Not boarded" mark beside a
                  diver still in the water is the string this whole
                  change exists to delete (DOM-H3). */}
                {busyBooking === diver.bookingId ? (
                  t("shared.offlineManifest.single.saving")
                ) : recordedNotBoarded ? (
                  isDeparture ? (
                    <OfflineStatusLabel variant="checked">
                      {t("shared.offlineManifest.single.notBoardedDone")}
                    </OfflineStatusLabel>
                  ) : (
                    <OfflineStatusLabel variant="danger">
                      {t("shared.offlineManifest.single.notBackAboardActive")}
                    </OfflineStatusLabel>
                  )
                ) : isDeparture ? (
                  t("shared.offlineManifest.single.markNotBoarded")
                ) : (
                  t("shared.offlineManifest.single.markNotBackAboard")
                )}
              </button>
              {/* The box only where the row's next act can take a
                sentence: while nothing is recorded (the exception
                control is about to raise the alarm) or while one
                stands (either control retracts it). On a settled
                "aboard" row there is nothing to observe, and a box
                there would offer a sentence the rule then drops. */}
              {isDeparture || !(state === undefined || missing) ? null : (
                <OfflineRollCallNote
                  subjectId={diver.bookingId}
                  label={t("manifest.rollCallNoteLabel")}
                  value={noteDrafts[diver.bookingId] ?? ""}
                  onChange={(next) =>
                    setNoteDrafts((drafts) => ({ ...drafts, [diver.bookingId]: next }))
                  }
                />
              )}
              {/* Same one line the crew rows carry, on the same
                terms: the loudest mark on the page states how it
                comes back off, and while a confirmation is armed
                it states what the next tap would claim instead. */}
              {rowState.recordedHere && missing ? (
                <div className="flex w-full flex-col gap-2">
                  <p className="text-sm text-muted">
                    {confirmAboardFor === diver.bookingId
                      ? t("shared.offlineManifest.single.confirmAboardHint", {
                          name: diver.fullName,
                        })
                      : state?.local
                        ? t("manifest.tapToUndoNotBackAboard")
                        : t("shared.offlineManifest.single.markedElsewhere")}
                  </p>
                  {confirmAboardFor === diver.bookingId ? (
                    <button
                      type="button"
                      disabled={busyBooking === diver.bookingId}
                      onClick={() =>
                        record(
                          { bookingId: diver.bookingId },
                          // A positive sighting, never a retraction:
                          // this control asserts the diver is aboard
                          // over a stated "not back aboard".
                          { status: "boarded" },
                          state,
                        )
                      }
                      aria-busy={busyBooking === diver.bookingId}
                      className={`${OFFLINE_BOAT_TARGET_CLASS} border border-warning bg-warning/15 font-bold`}
                    >
                      {t("shared.offlineManifest.single.confirmAboard", {
                        name: diver.fullName,
                      })}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </li>
  );
}
