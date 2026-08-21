import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
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
import { BuddyTeamChip } from "./BuddyTeamChip";
import {
  ROLL_CALL_ROW_TONE,
  RollCallControls,
  rollCallRecordedTone,
  rollCallRowState,
  rollCallScrollMargin,
} from "./RollCallControls";

/**
 * Who to call for one crew member — the same fact, in the same words, as a
 * diver's `DiverFacts` emergency-contact line, and rendered by the same rule:
 * behind the row's disclosure on screen, unconditionally on paper.
 *
 * Twice per row, deliberately, exactly as a diver's is: a closed `<details>`
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
  crewRollCallAction: RollCallAction;
  crewRollCallButtonCopy: RollCallButtonCopy;
  /** "Buddy team: Ana and Ben", already localized and list-formatted. */
  buddyTeamLabel: (teams: ReadonlyArray<ManifestBuddyTeam>) => string | null;
  t: StaffTranslator;
}) {
  const crewAssigned = crew.length;
  return (
    <section className="mt-9">
      <h2 className="text-lg font-semibold">{t("manifest.crewHeading")}</h2>
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
        <div className="mt-3 rounded-2xl border border-warning/50 bg-warning/10 p-4">
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
              // The same derivation and the same tone order the diver rows
              // read (`rollCallRowState`) — written out twice, the two lists
              // once disagreed about what a colour meant. Crew carry no
              // readiness, so an untouched crew row is always plain slate.
              const rowState = rollCallRowState(checkpoint, rc);
              const { impliedNotBoarded, recordedHere } = rowState;
              const recordedTone = rollCallRecordedTone(rowState);
              return (
                <li
                  key={member.id}
                  // A jump target, exactly as every diver row is: the summary
                  // panel's chips now name uncalled *crew* too, and this row
                  // sits below the whole diver roster — so on a phone the chip
                  // is often several screens from the person it names. The
                  // margin that keeps the landing clear of the sticky panel is
                  // shared with the diver rows rather than restated here
                  // (`rollCallScrollMargin`).
                  id={`crew-row-${member.id}`}
                  className={`border-l-4 px-4 py-4 ${rollCallScrollMargin(isDeparture)} ${
                    recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : ROLL_CALL_ROW_TONE.awaiting
                  }`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <strong className="text-base">{member.fullName}</strong>
                        <span className="text-sm text-muted">{member.roles.join(", ")}</span>
                        {/* Same rule, same reason, as the diver rows: hidden
                            on screen while the buttons beside it carry the
                            word — a recorded result on the settled control,
                            or an untouched pair whose un-tapped "Mark aboard"
                            already says awaiting — and always present on
                            paper. Crew always get both buttons, so there is
                            no readiness case to carve out here.
                            The warning fill is the diver rows' rule too — it
                            marks a result *carried forward from the dock*, not
                            merely "has a result". Keyed on `rc` it painted the
                            printed manifest's "Aboard" pill amber, so a crew
                            member who was demonstrably on the boat read on
                            paper as the one thing needing attention. */}
                        <span
                          className={`${recordedHere || !rc ? "hidden print:inline-flex " : ""}${
                            impliedNotBoarded
                              ? "rounded-full bg-warning/15 px-3 py-1 text-sm font-medium text-warning-strong"
                              : "rounded-full bg-surface px-3 py-1 text-sm font-medium text-muted"
                          }`}
                        >
                          {rollCallLabelText(t, rollCallLabel(checkpoint, rc))}
                        </span>
                        {/* Crew wear the same chip as a diver — a
                            divemaster who is back while the group they lead
                            is not is the same split, and it must not read
                            differently on their row. */}
                        <BuddyTeamChip
                          label={buddyTeamLabel(member.buddyTeams ?? [])}
                          alertText={
                            member.buddyAlert ? buddyAlertText(t, member.buddyAlert) : null
                          }
                          alert={member.buddyAlert}
                        />
                      </p>
                      {/* One quiet line at rest, the same grammar as a diver
                          row's "Contact & gear". Screen only — the print block
                          below carries the same fact unconditionally, because a
                          closed disclosure prints nothing. */}
                      <details className="group/crewfacts mt-1 print:hidden">
                        <summary className="group/summary flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-base font-medium text-muted select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                          <DisclosureCaret className="group-open/crewfacts:rotate-90" />
                          <span className="group-hover/summary:underline">
                            {t("manifest.emergencyContactLabel")}
                          </span>
                        </summary>
                        <div className="mb-1 rounded-xl border border-border/70 bg-surface-sunken/50 p-3">
                          <CrewFacts member={member} labelled={false} t={t} />
                        </div>
                      </details>
                      <div className="mt-2 hidden print:block">
                        <CrewFacts member={member} labelled t={t} />
                      </div>
                      {rc && !rc.implied ? (
                        <p className="mt-2 text-sm text-muted">
                          {t("manifest.crewRollCallRecordedBy", {
                            label: rollCallLabelText(t, rollCallLabel(checkpoint, rc)),
                            date: formatDateTimeTz(rc.occurredAt, locale, timezone),
                            name: rc.recordedByName,
                          })}
                        </p>
                      ) : null}
                    </div>
                    <RollCallControls
                      kind="crew"
                      subjectId={member.id}
                      checkpoint={checkpoint}
                      isDeparture={isDeparture}
                      rollCall={rc}
                      action={crewRollCallAction}
                      copy={crewRollCallButtonCopy}
                      showBoardControl
                      t={t}
                    />
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
