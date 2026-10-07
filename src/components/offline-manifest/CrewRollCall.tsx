import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import { cachedListFormat } from "@/lib/intl-cache";
import { rollCallLabel, rollCallRecordedTone, rollCallRowState } from "@/lib/manifests";
import type { OfflineTripControls } from "./controls";
import {
  BUDDY_NAMES_WRAP,
  buddyNamesList,
  OFFLINE_BOAT_TARGET_CLASS,
  OfflineRollCallNote,
  OfflineStatusLabel,
  reTap,
} from "./shared";
import type { OfflineTripView } from "./trip-view";

/**
 * The crew half of the head count, recordable on this copy since H-46.
 */
export function OfflineCrewRollCall({
  view,
  controls,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
}) {
  const {
    checkpoint,
    isDeparture,
    expired,
    crewAssigned,
    completeness,
    crewCounts,
    crewWithKeys,
    crewMissing,
    crewWithoutId,
  } = view;
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
  return (
    <section
      aria-labelledby="offline-crew-heading"
      className={`mt-3 overflow-hidden rounded-inset border ${
        crewMissing
          ? "border-danger bg-danger/10"
          : completeness.crewAccountedFor
            ? "border-success/40 bg-success/10"
            : "border-border-strong bg-surface"
      }`}
    >
      <div className="p-4 sm:p-5">
        <p
          id="offline-crew-heading"
          className={`text-sm font-bold${crewMissing ? " text-danger" : ""}`}
        >
          {t("shared.offlineManifest.single.crewHeading")}
        </p>
        <p className="mt-1 text-sm">
          {crewMissing
            ? t("shared.offlineManifest.single.crewNotBackAboard", {
                count: crewCounts.crewNotBackAboard,
              })
            : completeness.crewReason === "crew_awaiting"
              ? t("shared.offlineManifest.single.crewAwaiting", {
                  count: crewCounts.crewAwaiting,
                })
              : completeness.crewReason === "crew_none_assigned"
                ? t("shared.offlineManifest.single.crewNoneAssigned")
                : completeness.crewReason === "crew_none_aboard"
                  ? t("shared.offlineManifest.single.crewNoneAboard")
                  : t("shared.offlineManifest.single.crewAllAccountedFor", {
                      assigned: crewAssigned,
                    })}
        </p>
        {/* The one remaining limitation, and it belongs to the *copy*, not
        to the feature: a snapshot older than H-46 has crew with no id,
        so there is nobody for a tap to be about. Named with a count, so
        a captain can tell whether it is the whole crew or one late
        addition, and pointed at the two things that fix it. Absent
        entirely on a current copy. */}
        {crewWithoutId > 0 ? (
          <p className="mt-1 text-sm font-semibold text-muted">
            {t("shared.offlineManifest.single.crewOlderCopy", { count: crewWithoutId })}
          </p>
        ) : null}
      </div>
      {/* Who, not just how many — and now with the controls to answer for
        each one, the same two the diver rows carry. */}
      {crewAssigned > 0 ? (
        // Ided like the diver list below it, and for the same reason: both
        // are now lists of rows with roll-call controls on them, so
        // anything reaching for "the first Mark aboard button" has to be
        // able to say which list it means.
        <ul id="offline-crew-roll-call" className="divide-y divide-border border-t border-border">
          {crewWithKeys.map((member) => {
            // Hoisted so the guard below narrows it for both handlers: a
            // crew member with no id has no subject to record against.
            const crewPersonId = member.id;
            const crewRowState = rollCallRowState(checkpoint, member.state);
            const missingCrew = crewRowState.notBackAboard;
            const crewRecordedNotBoarded = crewRowState.recordedNotBoarded;
            const crewTone = rollCallRecordedTone(crewRowState);
            return (
              <li
                key={member.key}
                // The diver rows' own left rule, tone and inset, and the
                // live crew list's: one colour vocabulary by import. A
                // missing crew member's words go danger as well, because
                // their state is part of a sentence here, not a pill.
                className={`border-l-4 p-4 text-sm sm:p-5 ${
                  crewTone ? ROLL_CALL_ROW_TONE[crewTone] : ROLL_CALL_ROW_TONE.awaiting
                }${missingCrew ? " font-bold text-danger" : ""}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p>
                    {member.fullName} ·{" "}
                    {rollCallLabelText(t, rollCallLabel(checkpoint, member.state))}
                    {member.state?.pending
                      ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                      : ""}
                    {/* The groups this crew member is on, saved as names.
                      Same display-only rule as a diver's — a divemaster
                      leading three groups needs the dock copy to say
                      which bodies they are responsible for. */}
                    {(member.buddyTeamNames ?? []).length > 0 ? (
                      <span className={`ms-1 font-normal ${BUDDY_NAMES_WRAP}`}>
                        ·{" "}
                        {t("shared.buddyTeam.with", {
                          names: buddyNamesList(locale, member.buddyTeamNames ?? []),
                        })}
                      </span>
                    ) : null}
                  </p>
                  {/* **Printed aboard another boat too** (issue #1779).
                    The dock copy is the one read at the rail with no
                    signal, which is exactly when nobody can ring the
                    office to ask where the divemaster is.

                    Departure only, and only while nobody has tapped this
                    person — the same two bounds the live row keeps, and
                    the second is the one that matters: after a dive this
                    would be a pre-written excuse for a body that is
                    unaccounted for, which is the sentence that stops a
                    search. It marks and gates nothing; the aboard control
                    below is unchanged. */}
                  {isDeparture && !member.state && (member.clashDepartures ?? []).length > 0 ? (
                    <p className="mt-0.5 text-sm text-warning-strong">
                      {t("manifest.crewClashDetail", {
                        departures: cachedListFormat(locale, { type: "conjunction" }).format(
                          member.clashDepartures ?? [],
                        ),
                      })}
                    </p>
                  ) : null}
                  {/* No controls on an expired copy (the H-05 stop rule,
                    stated once in the banner above and enforced in
                    `record`), and none for a crew member this copy has
                    no id for. Otherwise both, always: crew carry no
                    readiness, so unlike a diver at the dock there is
                    nothing that can withhold the aboard control. */}
                  {expired || !crewPersonId ? null : (
                    <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
                      <button
                        type="button"
                        disabled={busyBooking === crewPersonId}
                        onClick={() => {
                          // Same two-tap gate the diver rows carry, with
                          // the confirmation below rather than under the
                          // thumb — and it applies to a divemaster for the
                          // stronger reason: crew are the people most
                          // reliably in the water.
                          if (missingCrew && confirmAboardFor !== crewPersonId) {
                            setConfirmAboardFor(crewPersonId);
                            return;
                          }
                          if (missingCrew) {
                            setConfirmAboardFor(null);
                            return;
                          }
                          void record(
                            { crewPersonId },
                            reTap(member.state, member.state?.state === "boarded", "boarded"),
                            member.state,
                          );
                        }}
                        aria-busy={busyBooking === crewPersonId}
                        // Same undo-bearing accessible name as the live
                        // page's settled control (RollCallControls, PR
                        // #607 review) — the two surfaces a captain
                        // alternates between must not diverge on this
                        // either. Unset while armed or unrecorded, where
                        // the visible label already reads as an action.
                        aria-label={
                          member.state?.state === "boarded" &&
                          !(missingCrew && confirmAboardFor === crewPersonId)
                            ? t("manifest.crewAboardCheckAriaLabel")
                            : undefined
                        }
                        className={`${OFFLINE_BOAT_TARGET_CLASS} ${
                          missingCrew && confirmAboardFor === crewPersonId
                            ? "border border-border-strong bg-surface-sunken"
                            : member.state?.state === "boarded"
                              ? "border border-success bg-success/15 text-success"
                              : "border border-primary bg-surface text-primary hover:bg-primary-tint"
                        }`}
                      >
                        {busyBooking === crewPersonId ? (
                          t("shared.offlineManifest.single.saving")
                        ) : missingCrew && confirmAboardFor === crewPersonId ? (
                          t("shared.offlineManifest.single.confirmAboardCancel")
                        ) : member.state?.state === "boarded" ? (
                          <OfflineStatusLabel variant="success">
                            {t("manifest.crewAboardCheck")}
                          </OfflineStatusLabel>
                        ) : (
                          t("manifest.crewMarkAboard")
                        )}
                      </button>
                      {/* The exception control, at the live page's weights
                        and by the live page's rules — and never a
                        done-check after a dive, because a settled
                        "Not aboard" mark
                        beside a divemaster still in the water is the
                        string every one of these rules exists to
                        delete (DOM-H3).
                        Re-tapping it once it carries the recorded state
                        queues the **retraction** (`cleared`), the same
                        undo the live control has always emitted — not a
                        second copy of the mark, and never a trip through
                        "Mark aboard", which would put a sighting nobody
                        made into the departure log. */}
                      <button
                        type="button"
                        disabled={busyBooking === crewPersonId}
                        onClick={() =>
                          record(
                            { crewPersonId },
                            // This device's own statement only, and named —
                            // see the diver control below for why a
                            // retraction is never aimed at a snapshot
                            // result and never leaves its target unsaid.
                            reTap(member.state, crewRecordedNotBoarded, "not_boarded"),
                            member.state,
                          )
                        }
                        aria-busy={busyBooking === crewPersonId}
                        // Only the departure settled state gets the undo-bearing
                        // name, same rule as the live page: after a dive
                        // "not back aboard" already carries its own visible
                        // undo sentence, which duplicating here would say
                        // twice.
                        aria-label={
                          crewRecordedNotBoarded && isDeparture
                            ? t("manifest.crewNotAboardCheckAriaLabel")
                            : undefined
                        }
                        className={
                          missingCrew
                            ? `${OFFLINE_BOAT_TARGET_CLASS} border border-danger bg-danger/15 text-danger`
                            : crewRecordedNotBoarded
                              ? `${OFFLINE_BOAT_TARGET_CLASS} border border-border-strong bg-surface-sunken`
                              : `${OFFLINE_BOAT_TARGET_CLASS} hover:bg-surface-sunken`
                        }
                      >
                        {busyBooking === crewPersonId ? (
                          t("shared.offlineManifest.single.saving")
                        ) : crewRecordedNotBoarded ? (
                          isDeparture ? (
                            <OfflineStatusLabel variant="checked">
                              {t("manifest.crewNotAboardCheck")}
                            </OfflineStatusLabel>
                          ) : (
                            <OfflineStatusLabel variant="danger">
                              {t("manifest.crewNotBackAboardActive")}
                            </OfflineStatusLabel>
                          )
                        ) : isDeparture ? (
                          t("manifest.crewMarkNotAboard")
                        ) : (
                          t("manifest.crewMarkNotBackAboard")
                        )}
                      </button>
                    </div>
                  )}
                </div>
                {/* The crew half of both — the sentence already on the
                  record, then the box for a new one. */}
                {member.state?.note ? <p className="mt-1 text-sm">{member.state.note}</p> : null}
                {isDeparture ||
                expired ||
                !crewPersonId ||
                !(member.state === undefined || missingCrew) ? null : (
                  <div className="mt-2">
                    <OfflineRollCallNote
                      subjectId={crewPersonId}
                      label={t("manifest.rollCallNoteLabel")}
                      value={noteDrafts[crewPersonId] ?? ""}
                      onChange={(next) =>
                        setNoteDrafts((drafts) => ({ ...drafts, [crewPersonId]: next }))
                      }
                    />
                  </div>
                )}
                {/* One line under a not-back-aboard row, and only there:
                  the mark that is loudest is also the one a crew member
                  must be certain they can take straight back off, or
                  they stop raising it (design/principles.md §7, and the
                  live manifest's own `tapToUndoNotBackAboard`). While a
                  confirmation is armed it says what the next tap will
                  claim, and offers the way out. */}
                {crewRowState.recordedHere && missingCrew && !expired && crewPersonId ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <p className="text-sm text-muted">
                      {confirmAboardFor === crewPersonId
                        ? t("shared.offlineManifest.single.confirmAboardHint", {
                            name: member.fullName,
                          })
                        : member.state?.local
                          ? t("manifest.tapToUndoNotBackAboard")
                          : t("shared.offlineManifest.single.markedElsewhere")}
                    </p>
                    {confirmAboardFor === crewPersonId ? (
                      <button
                        type="button"
                        disabled={busyBooking === crewPersonId}
                        onClick={() =>
                          record({ crewPersonId }, { status: "boarded" }, member.state)
                        }
                        aria-busy={busyBooking === crewPersonId}
                        className={`${OFFLINE_BOAT_TARGET_CLASS} border border-warning bg-warning/15 font-bold`}
                      >
                        {t("shared.offlineManifest.single.confirmAboard", {
                          name: member.fullName,
                        })}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
