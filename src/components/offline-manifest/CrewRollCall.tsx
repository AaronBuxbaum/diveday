import { RollCallMark } from "@/components/RollCallMark";
import { RollCallMarkTap, rollCallMarkState } from "@/components/RollCallMarkTap";
import { ROLL_CALL_ROW_TONE } from "@/components/row-tones";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import { cachedListFormat } from "@/lib/intl-cache";
import { rollCallLabel, rollCallRecordedTone, rollCallRowState } from "@/lib/manifests";
import type { OfflineTripControls } from "./controls";
import { OfflineRollCallException } from "./RollCallException";
import { BUDDY_NAMES_WRAP, buddyNamesList, reTap } from "./shared";
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
  const { t, locale, busyBooking, record } = controls;
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
        each one: a circle and a panel, as the diver rows carry. */}
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
                {/* A name and a mark, as on the diver rows and the live
                  crew list (#1840): the circle is the row's one tap, the
                  exception a deliberate tap away in the panel below. No tap
                  on an expired copy (the H-05 stop rule, stated once in the
                  banner above and enforced in `record`), and none for a crew
                  member this copy has no id for. Otherwise always: crew carry
                  no readiness, so nothing withholds the aboard tap. */}
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
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
                    {/* The sentence already on the record. */}
                    {member.state?.note ? (
                      <p className="mt-1 text-sm">{member.state.note}</p>
                    ) : null}
                    {expired || !crewPersonId ? null : (
                      <OfflineRollCallException
                        key={checkpoint}
                        subject={{ crewPersonId }}
                        subjectKey={crewPersonId}
                        name={member.fullName}
                        state={member.state}
                        rowState={crewRowState}
                        isDeparture={isDeparture}
                        isCrew
                        controls={controls}
                      />
                    )}
                  </div>
                  {expired || !crewPersonId ? null : (
                    <div className="flex shrink-0 ps-3">
                      {missingCrew ? (
                        <RollCallMark state="notBack" />
                      ) : (
                        <RollCallMarkTap
                          state={rollCallMarkState(crewRowState)}
                          label={
                            member.state?.state === "boarded"
                              ? t("manifest.crewAboardCheckAriaLabel")
                              : t("manifest.crewMarkAboard")
                          }
                          busy={busyBooking === crewPersonId}
                          onTap={() =>
                            void record(
                              { crewPersonId },
                              reTap(member.state, member.state?.state === "boarded", "boarded"),
                              member.state,
                            )
                          }
                        />
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
