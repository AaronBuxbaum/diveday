import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { IncidentRosterChangeAction, IncidentTimelineEntry } from "@/lib/incident-export";
import type { RollCallCheckpoint } from "@/lib/manifests";

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
const ROSTER_CHANGE_KEYS: Record<IncidentRosterChangeAction, StaffMessageKey> = {
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
      <span className="text-muted">
        {t("incidentExport.recordedByName", { name: entry.recordedByName })}
      </span>
      {entry.kind === "buddy_team" ? (
        <span className="text-muted">
          {t("incidentExport.timelineBuddyMembers", {
            names: memberList.format(entry.memberNames),
          })}
        </span>
      ) : null}
      {(entry.kind === "diver" || entry.kind === "crew") && entry.source === "offline" ? (
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted">
          {t("incidentExport.timelineOfflineTag")}
        </span>
      ) : null}
      {/* What the crew observed, on its own line below the facts, in their
          column, rather than wrapped into them (ADR
          20260828-a-missing-diver-gets-a-sentence). This is the half of the
          record a mark alone cannot carry, and the reason an investigator
          reading this page meets "surfaced 200 m north, picked up by Reef
          Runner at 14:31" instead of an unexplained red entry. It is inside
          the content hash, like every other fact here. */}
      {(entry.kind === "diver" || entry.kind === "crew") && entry.note ? (
        <span className="basis-full text-sm">{entry.note}</span>
      ) : null}
    </span>
  );
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
      const crew = entry.action === "crew_added" || entry.action === "crew_removed";
      const who = crew
        ? `${entry.subjectName} (${t("incidentExport.crewTag")})`
        : entry.subjectName;
      return `${who} — ${t(ROSTER_CHANGE_KEYS[entry.action])}`;
    }
    default: {
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
  }
}
