import { staffSoulsOnBoardLine } from "@/i18n/participant-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { TripManifest } from "@/lib/manifests";

/**
 * The souls-on-board line the printed manifest opens with — divers carried,
 * crew named, and how many of that crew another boat claims at the same
 * hours.
 */
export function PrintedSoulsOnBoard({
  manifest,
  vesselName,
  t,
}: {
  manifest: TripManifest;
  /**
   * The boat this departure sails on, leading the line (fourth review, item
   * 11): the sheet in a coastguard's hands said how many were aboard and never
   * which hull. Null for a departure on no boat.
   */
  vesselName: string | null;
  t: StaffTranslator;
}) {
  // How many of the named crew another departure claims at the same hours
  // (issue #1779) — the head figure's own qualification, printed beside it.
  const crewToConfirm = manifest.crew.filter((member) => (member.clashes ?? []).length > 0).length;
  return (
    <>
      {/* Print-only static facts: divers carried and crew named, never the
        live boarded count. The rehearsal label marks practice sheets. */}
      <p data-print-only className="mt-4 hidden text-base font-semibold tabular-nums print:block">
        {manifest.trip.isRehearsal ? `${t("trips.rehearsal.label")} · ` : null}
        {vesselName ? `${vesselName} · ` : null}
        {staffSoulsOnBoardLine(t, manifest.summary, manifest.crew.length)}
        {/* Keep the overlap qualification beside the radio-read count; a
          crew member claimed by another boat makes that count unsettled
          (issue #1779). This is a static roster fact, not a live boarded
          count. */}
        {crewToConfirm > 0 ? (
          <span className="font-normal">
            {" "}
            {t("manifest.soulsOnBoardCrewToConfirm", { count: crewToConfirm })}
          </span>
        ) : null}
      </p>
    </>
  );
}
