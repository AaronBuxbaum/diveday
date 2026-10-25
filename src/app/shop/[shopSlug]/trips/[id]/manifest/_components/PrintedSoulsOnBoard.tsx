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
      {/* Souls on board, on paper only: the sheet goes ashore or into a
        coastguard's hands, and the first question is how many the boat left
        with, which the screen answers with a live panel that does not print.
        **Static facts** only (divers carried, crew named), never a live
        count: "Boarded 6" printed at 07:12 is a lie by 07:20. A rehearsal
        says so first, so a practice sheet is never read as a real boat. */}
      <p data-print-only className="mt-4 hidden text-base font-semibold tabular-nums print:block">
        {manifest.trip.isRehearsal ? `${t("trips.rehearsal.label")} · ` : null}
        {vesselName ? `${vesselName} · ` : null}
        {staffSoulsOnBoardLine(t, manifest.summary, manifest.crew.length)}
        {/* **The count is the number read over the radio, and a crew member
          rostered on two overlapping boats makes it wrong** (issue #1779).
          Their row below says which other departure; this says the head
          figure is not settled, because a qualification forty lines down
          does not reach somebody reading a number aloud.

          Still a static fact, like everything else on this line: how many of
          the named crew are claimed by another boat, not how many have been
          tapped. Nothing here moves after the sheet comes off the printer. */}
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
