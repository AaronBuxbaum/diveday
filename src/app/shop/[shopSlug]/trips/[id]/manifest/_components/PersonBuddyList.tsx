import { rollCallLabelText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import {
  type BuddyTeammate,
  type RollCallCheckpoint,
  rollCallLabel,
  rollCallRowState,
  type TripManifest,
} from "@/lib/manifests";

/**
 * The small buddy section in a person sheet. Teammates are resolved by their
 * stable booking/person id, never by a display name; a missing result remains
 * the word "Awaiting" rather than becoming an alarm by omission.
 */
export function PersonBuddyList({
  teammates,
  divers,
  crew,
  checkpoint,
  t,
}: {
  teammates: readonly BuddyTeammate[];
  divers: readonly TripManifest["divers"][number][];
  crew: readonly TripManifest["crew"][number][];
  checkpoint: RollCallCheckpoint;
  t: StaffTranslator;
}) {
  if (teammates.length === 0) return null;
  const diverById = new Map(divers.map((diver) => [diver.bookingId, diver]));
  const crewById = new Map(crew.map((member) => [member.id, member]));

  return (
    <ul className="divide-y divide-border rounded-xl border border-border/70 bg-surface-sunken/50 px-3">
      {teammates.map((teammate) => {
        const person =
          teammate.kind === "diver"
            ? diverById.get(teammate.bookingId)
            : crewById.get(teammate.personId);
        const rowState = person ? rollCallRowState(checkpoint, person.rollCall) : null;
        const status =
          rowState && person
            ? rollCallLabelText(t, rollCallLabel(checkpoint, person.rollCall))
            : t("manifest.personSheetBuddyAwaiting");
        const statusClass = rowState?.notBackAboard
          ? "text-danger"
          : rowState?.boarded
            ? "text-success-strong"
            : rowState?.recordedNotBoarded || rowState?.impliedNotBoarded
              ? "text-warning-strong"
              : "text-muted";
        return (
          <li key={teammate.kind === "diver" ? teammate.bookingId : teammate.personId}>
            <div className="flex min-h-10 items-center gap-3 text-sm">
              <span className="min-w-0 flex-1">{teammate.fullName}</span>
              <span className={`shrink-0 font-semibold ${statusClass}`}>{status}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
