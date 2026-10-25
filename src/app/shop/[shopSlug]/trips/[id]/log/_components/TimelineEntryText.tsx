import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import {
  hasRollCallEntries,
  type IncidentExportDocument,
  type IncidentRosterChangeAction,
  type IncidentTimelineEntry,
} from "@/lib/incident-export";
import type { RollCallCheckpoint } from "@/lib/manifests";
import { groupTimeline, type RollCallTimelineEntry, type TimelineGroup } from "./timeline-groups";

/**
 * What each act on a buddy team reads as in the timeline. Codes come from
 * `src/lib/incident-export.ts`; the words live here, like every other status
 * this page prints.
 */
const BUDDY_TEAM_ACTION_KEYS: Record<
  "formed" | "dissolved" | "member_added" | "member_removed",
  StaffMessageKey
> = {
  formed: "incidentExport.timelineBuddyFormed",
  dissolved: "incidentExport.timelineBuddyDissolved",
  member_added: "incidentExport.timelineBuddyMemberAdded",
  member_removed: "incidentExport.timelineBuddyMemberRemoved",
};

/** What a seat or crew change after the start reads as (safety sheet 2026-10-15, item 7). */
const ROSTER_CHANGE_KEYS: Record<
  Exclude<IncidentRosterChangeAction, "erased" | "turned_away">,
  StaffMessageKey
> = {
  added: "incidentExport.timelineSeatAdded",
  removed: "incidentExport.timelineSeatRemoved",
  moved_away: "incidentExport.timelineSeatMovedAway",
  moved_here: "incidentExport.timelineSeatMovedHere",
  crew_added: "incidentExport.timelineCrewAdded",
  crew_removed: "incidentExport.timelineCrewRemoved",
};

/**
 * Every part of one timeline line after its time: the checkpoint, the act in
 * bold, who recorded it, and whatever that kind of line carries besides. A
 * buddy-team act names its team; a seat change names whose seat, in the same
 * shape, so the two departure-wide kinds of line read alike.
 */
export function TimelineEntryText({
  entry,
  t,
  memberList,
}: {
  entry: IncidentTimelineEntry;
  t: StaffTranslator;
  memberList: Intl.ListFormat;
}) {
  return (
    <span className="flex basis-full flex-wrap items-baseline gap-x-3 gap-y-1">
      {entry.checkpoint === null ? null : (
        <span className="text-muted">
          {rollCallCheckpointText(t, entry.checkpoint as RollCallCheckpoint)}
        </span>
      )}
      <span className="font-semibold">{actText(entry, t)}</span>
      {/* An erased line names nobody, its recorder included. */}
      {entry.kind === "roster_change" && entry.action === "erased" ? null : (
        <span className="text-muted">
          {t("incidentExport.recordedByName", { name: entry.recordedByName })}
        </span>
      )}
      {entry.kind === "buddy_team" ? (
        <span className="text-muted">
          {t("incidentExport.timelineBuddyMembers", {
            names: memberList.format(entry.memberNames),
          })}
        </span>
      ) : null}
      {/* Issue 2808: the recorder vouched that everyone on the team is 18 or
          over, where nothing on file said so. */}
      {entry.kind === "buddy_team" && entry.adultsConfirmed ? (
        <span className="text-muted">{t("incidentExport.timelineBuddyAdultsConfirmed")}</span>
      ) : null}
      {/* What the crew observed sits on its own line below the facts (ADR
          20260828-a-missing-diver-gets-a-sentence), inside the content hash
          like every other fact here. */}
      {entry.kind === "diver" || entry.kind === "crew" ? (
        <RollCallLineExtras entry={entry} t={t} />
      ) : null}
    </span>
  );
}

/**
 * **The timeline, one heading per run of marks at a checkpoint** (visual
 * review 2026-10-24, B05): "Before departure · Oct 24, 5:30 AM EDT ·
 * recorded by Sal Moretti", then a line per person. A line recorded by
 * somebody else or at another minute says so on itself, so grouping hides no
 * discrepancy; everything that is not a mark stands alone where it fell
 * (`groupTimeline`). The data read is unchanged.
 */
export function TimelineGroups({
  timeline,
  t,
  memberList,
  dateTime,
  className,
}: {
  timeline: readonly IncidentTimelineEntry[];
  t: StaffTranslator;
  memberList: Intl.ListFormat;
  dateTime: (isoString: string) => string;
  className: string;
}) {
  const groups: TimelineGroup[] = groupTimeline(timeline, dateTime);
  return (
    <ol className={className}>
      {groups.map((group) =>
        group.kind === "single" ? (
          <li
            key={group.order}
            className="break-inside-avoid flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-5"
          >
            <span className="font-mono text-xs text-muted tabular-nums">{group.stamp}</span>
            <TimelineEntryText entry={group.entry} t={t} memberList={memberList} />
          </li>
        ) : (
          <li key={group.order} className="px-4 py-3 text-sm sm:px-5">
            <p className="break-after-avoid font-semibold">
              {t("incidentExport.timelineGroupHeading", {
                checkpoint: rollCallCheckpointText(t, group.checkpoint as RollCallCheckpoint),
                time: group.stamp,
                name: group.recordedByName,
              })}
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {group.lines.map((line) => (
                <li
                  key={line.order}
                  className="break-inside-avoid flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <span>{rollCallActText(line.entry, t)}</span>
                  {line.ownStamp || line.ownRecorder ? (
                    <span className="text-muted">
                      {[
                        line.ownStamp,
                        line.ownRecorder
                          ? t("incidentExport.timelineLineRecordedBy", { name: line.ownRecorder })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                  <RollCallLineExtras entry={line.entry} t={t} />
                </li>
              ))}
            </ul>
          </li>
        ),
      )}
    </ol>
  );
}

/** A mark's tag and observation, the same under a heading as on a lone line. */
function RollCallLineExtras({ entry, t }: { entry: RollCallTimelineEntry; t: StaffTranslator }) {
  return (
    <>
      {entry.source === "offline" ? (
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted">
          {t("incidentExport.timelineOfflineTag")}
        </span>
      ) : null}
      {entry.note ? <span className="basis-full text-sm">{entry.note}</span> : null}
    </>
  );
}

/**
 * "No roll-call entries", said whenever the timeline holds no diver or crew
 * mark, though seat, crew or buddy lines stand on it (auditor review
 * 2026-10-16, item 9).
 */
export function NoRollCallNote({
  timeline,
  t,
}: {
  timeline: readonly IncidentTimelineEntry[];
  t: StaffTranslator;
}) {
  if (hasRollCallEntries(timeline)) return null;
  return <p className="mt-3 text-sm font-semibold">{t("incidentExport.timelineEmpty")}</p>;
}

/** The bold half of a line: who or what, then what happened. */
function actText(entry: IncidentTimelineEntry, t: StaffTranslator): string {
  switch (entry.kind) {
    case "buddy_team": {
      const team =
        entry.teamNumber > 0
          ? t("incidentExport.buddyTeam", { number: entry.teamNumber })
          : t("incidentExport.buddyTeamUnnumbered");
      return `${team} — ${t(BUDDY_TEAM_ACTION_KEYS[entry.action])}`;
    }
    case "roster_change": {
      if (entry.action === "erased") return t("incidentExport.timelineErased");
      if (entry.action === "turned_away") {
        return `${entry.subjectName} — ${t("incidentExport.timelineSeatTurnedAway", {
          reason: entry.reason ?? "other",
        })}`;
      }
      const crew = entry.action === "crew_added" || entry.action === "crew_removed";
      const who = crew
        ? `${entry.subjectName} (${t("incidentExport.crewTag")})`
        : entry.subjectName;
      return `${who} — ${t(ROSTER_CHANGE_KEYS[entry.action])}`;
    }
    default:
      return rollCallActText(entry, t);
  }
}

/** "Sana Malik — Boarded", "Keiko Tanaka (crew) — Not back aboard": one mark's words. */
export function rollCallActText(entry: RollCallTimelineEntry, t: StaffTranslator): string {
  const who =
    entry.kind === "crew"
      ? `${entry.subjectName} (${t("incidentExport.crewTag")})`
      : entry.subjectName;
  const act =
    entry.action === "cleared"
      ? t("incidentExport.actionCleared")
      : rollCallLabelText(
          t,
          entry.action === "boarded"
            ? "boarded"
            : entry.checkpoint === "departure"
              ? "not_boarded"
              : "not_back_aboard",
        );
  return `${who} — ${act}`;
}

/**
 * **The roster's note, and the seats the desk turned away** (issue #2907):
 * a turned-away seat is off the boat and out of every count on this page,
 * and still stated, so a turn-away before the first dock count leaves a
 * sentence in the record. The category only, in the timeline's own words,
 * never the answers behind it (H-135).
 */
export function RosterIntro({
  turnedAway,
  t,
}: {
  turnedAway: IncidentExportDocument["turnedAway"];
  t: StaffTranslator;
}) {
  return (
    <>
      <p className="mt-1 max-w-prose text-sm text-muted">{t("incidentExport.rosterDescription")}</p>
      {turnedAway.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm">
          {turnedAway.map((seat) => (
            <li key={seat.bookingId}>
              {seat.fullName} —{" "}
              {t("incidentExport.timelineSeatTurnedAway", { reason: seat.reason ?? "other" })}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
