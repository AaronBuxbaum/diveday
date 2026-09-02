import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { RollCallMark } from "@/components/RollCallMark";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { buddyAlertText } from "@/i18n/buddy-labels";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import {
  type ManifestBuddyTeam,
  type RollCallCheckpoint,
  rollCallLabel,
  type TripManifest,
} from "@/lib/manifests";
import { PersonBuddyList } from "./PersonBuddyList";
import { PersonSheet, type PersonTrailEntry } from "./PersonSheet";
import { personTrailWithCurrentRecord } from "./person-trail";
import {
  ROLL_CALL_ROW_TONE,
  ROW_DISCLOSURE_PANEL_CLASS,
  ROW_DISCLOSURE_SUMMARY_CLASS,
  RollCallBackAboardControl,
  RollCallExceptionControl,
  RollCallMarkButton,
  rollCallMarkState,
  rollCallRecordedTone,
  rollCallRowState,
  rollCallScrollMargin,
} from "./RollCallControls";

/**
 * Who to call for one crew member — the same fact, in the same words, as a
 * diver's `DiverFacts` emergency-contact line, and rendered by the same rule:
 * behind the row's disclosure on screen, unconditionally on paper.
 *
 * Twice per row, deliberately, exactly as a diver's is: the person sheet
 * contributes nothing to print, and the printed manifest is the document a
 * coastguard reads, so it keeps every fact without asking paper to disclose.
 *
 * `labelled` is what differs between the two placements. On screen the
 * disclosure's own summary is already the words "Emergency contact", so
 * repeating them inside the panel is the same label twice a line apart; on
 * paper there is no summary, so the label has to be there.
 */
function CrewFacts({
  member,
  labelled,
  t,
}: {
  member: TripManifest["crew"][number];
  labelled: boolean;
  t: StaffTranslator;
}) {
  const { emergencyContactName: name, emergencyContactPhone: phone } = member;
  return (
    <p className="text-base">
      {labelled ? <span className="font-bold">{t("manifest.emergencyContactLabel")}</span> : null}
      <span className={`text-muted${labelled ? " mt-0.5 block" : ""}`}>
        {name && phone ? (
          <>
            {name} ·{" "}
            {/* Never broken across lines — a number a crew member reads aloud
                in an emergency is the last string on this page that should be
                reassembled by eye. Same rule, same reason, as a diver's. */}
            <span className="whitespace-nowrap">{phone}</span>
          </>
        ) : (
          // Said in words rather than left blank. Nobody is asked for a crew
          // contact at hire, so absence is the common case — and an empty space
          // on the sheet reads as "nothing to say here" rather than "we do not
          // know who to call for the divemaster".
          t("manifest.notOnFile")
        )}
      </span>
    </p>
  );
}

/**
 * The crew half of the head count (DOM-H1, ADR
 * 20260804-crew-roll-call-is-per-person).
 */
export function CrewRollCall({
  crew,
  checkpoint,
  isDeparture,
  shopSlug,
  tripId,
  locale,
  timezone,
  divers,
  todayTrailBySubject,
  crewRollCallAction,
  crewRollCallButtonCopy,
  buddyTeamLabel,
  t,
}: {
  crew: TripManifest["crew"];
  checkpoint: RollCallCheckpoint;
  isDeparture: boolean;
  shopSlug: string;
  tripId: string;
  locale: string;
  timezone: string;
  /** Full diver rows for resolving buddy states inside a crew member's sheet. */
  divers?: TripManifest["divers"];
  /** The non-implied roll-call events for each crew member across today. */
  todayTrailBySubject?: ReadonlyMap<string, readonly PersonTrailEntry[]>;
  crewRollCallAction: RollCallAction;
  crewRollCallButtonCopy: RollCallButtonCopy;
  /** A localized, list-formatted buddy-team sentence. */
  buddyTeamLabel: (teams: ReadonlyArray<ManifestBuddyTeam>) => string | null;
  t: StaffTranslator;
}) {
  const crewAssigned = crew.length;
  return (
    <section className="mt-9">
      <h2 className={SECTION_TITLE_CLASS}>{t("manifest.crewHeading")}</h2>
      {crewAssigned === 0 ? (
        // An empty crew list holds the checkpoint open (`crew_none_assigned`),
        // so the one thing to say here is how to close it. This replaces the
        // typed "how many crew are aboard" attestation the manifest used to
        // ask for — a number that named nobody, on a page whose whole point is
        // naming people (ADR 20260804-crew-roll-call-is-per-person).
        // The card itself prints: the paper the boat carries must not show a
        // "Crew" heading with blank space under it on exactly the departures
        // whose crew half is open (dive-domain review 20260804). Only the
        // button is screen-only — a link is not an action on paper.
        <div className="mt-3 rounded-panel border border-warning/50 bg-warning/10 p-4">
          <p className="max-w-prose text-sm">{t("manifest.noCrew")}</p>
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}#crew`}
            className={buttonClass({ size: "boat", className: "mt-3 print:hidden" })}
          >
            {t("manifest.addCrewToTrip")}
          </Link>
        </div>
      ) : (
        <>
          {/* No standing caption above the list. "Every crew member needs a
              result of their own before this checkpoint closes" is said by the
              summary panel — `manifest.crewAwaiting` — at the moment it is the
              thing holding the checkpoint open, which is the only moment a
              crew member at the rail can act on it. A permanent copy of it
              here was the same sentence twice on one screen. */}
          {/* Per-person crew roll call — the whole crew half of the head
              count since ADR 20260804-crew-roll-call-is-per-person (DOM-H1).
              It says *who*, which is the only way the boat learns that the
              third body aboard is the deckhand and not the divemaster who
              has not surfaced; the typed "how many crew are aboard" count
              that used to sit below this list named nobody. Same control,
              same append-only write, same undo as a diver's — the subject is
              a person, not a booking. */}
          <ul
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 divide-y divide-border overflow-hidden",
            })}
          >
            {crew.map((member) => {
              const rc = member.rollCall;
              const personTrail = personTrailWithCurrentRecord({
                trail: todayTrailBySubject?.get(member.id) ?? [],
                checkpoint,
                rollCall: rc,
                locale,
                timezone,
                t,
              });
              // The same derivation and the same tone order the diver rows
              // read (`rollCallRowState`) — written out twice, the two lists
              // once disagreed about what a colour meant. Crew carry no
              // readiness, so an untouched crew row is always plain slate.
              const rowState = rollCallRowState(checkpoint, rc);
              const { impliedNotBoarded } = rowState;
              const recordedTone = rollCallRecordedTone(rowState);
              // The same one line under the name a diver's row carries: who
              // said what, and when. Nothing said yet says nothing.
              // Time, not a timestamp — the same rule, and the same reason, as
              // a diver's row: same-day at the rail, full on the sheet below.
              const auditLabel = rollCallLabelText(t, rollCallLabel(checkpoint, rc));
              // Crew wear the same capsule rule as a diver — exceptions only,
              // at most one — so a split team reads identically on a
              // divemaster's row and on the row of the diver they lead.
              const teamLabel = buddyTeamLabel(member.buddyTeams ?? []);
              const capsule = member.buddyAlert ? (
                <Badge tone={member.buddyAlert === "separated_after_dive" ? "danger" : "warning"}>
                  {buddyAlertText(t, member.buddyAlert)}
                </Badge>
              ) : null;
              return (
                <li
                  key={member.id}
                  // A jump target, exactly as every diver row is: the count
                  // panel's chips name uncalled *crew* too, and this row sits
                  // below the whole diver roster — so on a phone the chip is
                  // often several screens from the person it names.
                  id={`crew-row-${member.id}`}
                  // `break-inside-avoid` for the same reason a diver's row
                  // carries it: this sheet is printed and goes ashore, and a
                  // crew member's name split across a page boundary is a
                  // defect in the record rather than a layout nit.
                  className={`border-l-4 break-inside-avoid ${rollCallScrollMargin(isDeparture)} ${
                    recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : ROLL_CALL_ROW_TONE.awaiting
                  }`}
                >
                  <div className="flex items-start">
                    <PersonSheet
                      name={member.fullName}
                      triggerLabel={t("manifest.openPersonDetails", { name: member.fullName })}
                      subtitle={t("manifest.personSheetCrewSubtitle", {
                        roles: member.roles.join(", "),
                      })}
                      status={
                        <Badge
                          tone={
                            rowState.notBackAboard
                              ? "danger"
                              : rowState.boarded
                                ? "success"
                                : rowState.recordedNotBoarded || rowState.impliedNotBoarded
                                  ? "warning"
                                  : "neutral"
                          }
                          size="sm"
                        >
                          {auditLabel}
                        </Badge>
                      }
                      trail={personTrail}
                      todayLabel={t("manifest.personSheetToday")}
                      noTodayEventsLabel={t("manifest.personSheetNoTodayEvents")}
                      buddyLabel={t("manifest.personSheetBuddyTeam")}
                      buddy={
                        member.buddyTeams && member.buddyTeams.length > 0 ? (
                          <PersonBuddyList
                            teammates={member.buddyTeams.flatMap((team) => team.others)}
                            divers={divers ?? []}
                            crew={crew}
                            checkpoint={checkpoint}
                            t={t}
                          />
                        ) : null
                      }
                      closeLabel={t("manifest.closePersonDetails")}
                      triggerClassName={ROW_DISCLOSURE_SUMMARY_CLASS}
                      trigger={
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span
                              className={`${SECTION_TITLE_CLASS} group-hover/summary:underline`}
                            >
                              {member.fullName}
                            </span>
                            <span className="text-sm text-muted">{member.roles.join(", ")}</span>
                            {capsule}
                          </span>
                        </span>
                      }
                    >
                      <div className={ROW_DISCLOSURE_PANEL_CLASS}>
                        <CrewFacts member={member} labelled t={t} />
                        {/* Both directions out of a stated "not back aboard",
                            at the same cost and neither on the row — the same
                            terms as a diver's, because a divemaster who did not
                            surface is the same claim about the same kind of
                            body (ADR 20260815-offline-can-unsay-a-missing-diver
                            applies it to crew rows in as many words). */}
                        {rowState.notBackAboard ? (
                          <RollCallBackAboardControl
                            kind="crew"
                            subjectId={member.id}
                            checkpoint={checkpoint}
                            subjectName={member.fullName}
                            action={crewRollCallAction}
                            copy={crewRollCallButtonCopy}
                            t={t}
                          />
                        ) : null}
                        {/* The deliberate second step, on the same terms as a
                            diver's. */}
                        <RollCallExceptionControl
                          kind="crew"
                          subjectId={member.id}
                          checkpoint={checkpoint}
                          isDeparture={isDeparture}
                          rollCall={rc}
                          action={crewRollCallAction}
                          copy={crewRollCallButtonCopy}
                          t={t}
                        />
                      </div>
                    </PersonSheet>
                    <div className="shrink-0 pt-2.5 ps-3 pe-3 print:hidden">
                      {rowState.notBackAboard ? (
                        <RollCallMark state="notBack" />
                      ) : (
                        <RollCallMarkButton
                          kind="crew"
                          subjectId={member.id}
                          checkpoint={checkpoint}
                          rollCall={rc}
                          action={crewRollCallAction}
                          copy={crewRollCallButtonCopy}
                          markState={rollCallMarkState(rowState)}
                          t={t}
                        />
                      )}
                    </div>
                  </div>
                  {/* Paper keeps what the sheet hides: the recorded state as a
                      word, the team, and the contact. The summary above prints
                      as it stands, so the name, role and who-and-when are
                      already on the sheet. */}
                  <div className="hidden px-4 pb-4 print:block">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          impliedNotBoarded
                            ? "rounded-full bg-warning-tint px-3 py-1 text-sm font-medium text-warning-strong"
                            : "rounded-full bg-surface px-3 py-1 text-sm font-medium text-muted"
                        }
                      >
                        {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                      </span>
                      {teamLabel ? (
                        <Badge tone="neutral">
                          {teamLabel}
                          {member.buddyAlert ? ` · ${buddyAlertText(t, member.buddyAlert)}` : ""}
                        </Badge>
                      ) : null}
                    </p>
                    {rc && !rc.implied ? (
                      <p className="mt-2 text-sm">
                        {t("manifest.crewRollCallRecordedBy", {
                          label: auditLabel,
                          date: formatDateTimeTz(rc.occurredAt, locale, timezone),
                          name: rc.recordedByName,
                        })}
                      </p>
                    ) : null}
                    <div className="mt-2">
                      <CrewFacts member={member} labelled t={t} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {crewAssigned > 0 ? (
        // Crew change on the morning — a hand calls in sick, a second
        // divemaster is added. The roll call names whoever the trip names
        // *now*, so the way to correct it is the trip's own crew list.
        <Link
          href={`/shop/${shopSlug}/trips/${tripId}#crew`}
          className={buttonClass({ variant: "secondary", className: "mt-4 print:hidden" })}
        >
          {t("manifest.manageCrewOnTrip")}
        </Link>
      ) : null}
    </section>
  );
}
