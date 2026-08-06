import Link from "next/link";
import type {
  RollCallAction,
  RollCallButtonCopy,
} from "@/app/shop/[shopSlug]/trips/[id]/_components/RollCallButton";
import { buttonClass } from "@/components/ui/button";
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
} from "./RollCallControls";

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
      <h2 className="text-lg font-semibold">{t("trips.manifest.crewHeading")}</h2>
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
          <p className="max-w-prose text-sm">{t("trips.manifest.noCrew")}</p>
          <Link
            href={`/shop/${shopSlug}/trips/${tripId}#crew`}
            className={buttonClass({ size: "boat", className: "mt-3 print:hidden" })}
          >
            {t("trips.manifest.addCrewToTrip")}
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("trips.manifest.crewRollCallDescription")}
          </p>
          {/* Per-person crew roll call — the whole crew half of the head
              count since ADR 20260804-crew-roll-call-is-per-person (DOM-H1).
              It says *who*, which is the only way the boat learns that the
              third body aboard is the deckhand and not the divemaster who
              has not surfaced; the typed "how many crew are aboard" count
              that used to sit below this list named nobody. Same control,
              same append-only write, same undo as a diver's — the subject is
              a person, not a booking. */}
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface">
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
                  className={`border-l-4 px-4 py-4 ${
                    recordedTone ? ROLL_CALL_ROW_TONE[recordedTone] : ROLL_CALL_ROW_TONE.awaiting
                  }`}
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <strong className="text-base">{member.fullName}</strong>
                        <span className="text-sm text-muted">{member.roles.join(", ")}</span>
                        {/* Same rule, same reason, as the diver rows: hidden
                            on screen only while the buttons beside it carry
                            the word, and always present on paper. Crew always
                            get both buttons, so there is no readiness case to
                            carve out here.
                            The warning fill is the diver rows' rule too — it
                            marks a result *carried forward from the dock*, not
                            merely "has a result". Keyed on `rc` it painted the
                            printed manifest's "Aboard" pill amber, so a crew
                            member who was demonstrably on the boat read on
                            paper as the one thing needing attention. */}
                        <span
                          className={`${recordedHere ? "hidden print:inline-flex " : ""}${
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
                      {rc && !rc.implied ? (
                        <p className="mt-2 text-sm text-muted">
                          {t("trips.manifest.crewRollCallRecordedBy", {
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
          {t("trips.manifest.manageCrewOnTrip")}
        </Link>
      ) : null}
    </section>
  );
}
