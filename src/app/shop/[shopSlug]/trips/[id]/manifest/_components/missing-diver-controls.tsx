import type { StaffTranslator } from "@/i18n/staff-messages";
import { type MissingReportAction, MissingReportButton } from "./MissingReportButton";

/** A row's missing-diver controls, bound to the departure; each null for a reader who may not. */
export type MissingDiverRowActions = {
  startMissingDiverReport: MissingReportAction | null;
  raiseMissingDiverAlert?: MissingReportAction | null;
  markMissingSubjectFound?: MissingReportAction | null;
  /** Seats and crew whose owners were alerted and who are not found yet. */
  missingAlerted?: ReadonlySet<string>;
};

/**
 * **The roll-call row's missing-diver controls** (issue #2694; review
 * 2026-10-17), the same on a diver's sheet and a crew member's:
 *
 * - While marked not back aboard: "Missing diver, alert owners now", with
 *   the no-signal line and a failed request said as "call them", then
 *   "Start a missing diver report".
 * - Once marked back aboard, for someone the owners were alerted about:
 *   "Found", which sends the owners one all-clear. The write refuses while
 *   the roll call still has them not back aboard.
 *
 * Each keyed on the checkpoint, as `RollCallButton` asks, so a refusal read
 * at one checkpoint never stands under another.
 */
export function MissingDiverControls({
  actions,
  notBackAboard,
  subject,
  name,
  checkpoint,
  t,
}: {
  actions: MissingDiverRowActions | undefined;
  notBackAboard: boolean;
  subject: { field: "bookingId" | "personId"; id: string };
  name: string;
  checkpoint: string;
  t: StaffTranslator;
}) {
  if (!actions) return null;
  const { startMissingDiverReport, raiseMissingDiverAlert, markMissingSubjectFound } = actions;
  if (!notBackAboard) {
    if (!markMissingSubjectFound || !actions.missingAlerted?.has(subject.id)) return null;
    return (
      <MissingReportButton
        key={`found-${checkpoint}`}
        action={markMissingSubjectFound}
        subject={subject}
        checkpoint={checkpoint}
        label={t("incidents.missingDiver.found")}
        pendingLabel={t("incidents.missingDiver.foundPending")}
        ariaLabel={`${t("incidents.missingDiver.found")} — ${name}`}
      />
    );
  }
  return (
    <>
      {raiseMissingDiverAlert ? (
        <MissingReportButton
          key={`alert-${checkpoint}`}
          action={raiseMissingDiverAlert}
          subject={subject}
          checkpoint={checkpoint}
          label={t("incidents.missingDiver.alert")}
          pendingLabel={t("incidents.missingDiver.alerting")}
          ariaLabel={`${t("incidents.missingDiver.alert")} — ${name}`}
          variant="danger"
          offline={{
            label: t("incidents.missingDiver.offline"),
            failed: t("incidents.missingDiver.alertFailed"),
            copy: {
              online: t("shared.connectivity.online"),
              onlineTitle: t("shared.connectivity.onlineTitle"),
              offlineTitle: t("shared.connectivity.offlineTitle"),
            },
          }}
        />
      ) : null}
      {startMissingDiverReport ? (
        <MissingReportButton
          key={checkpoint}
          action={startMissingDiverReport}
          subject={subject}
          checkpoint={checkpoint}
          label={t("incidents.missingDiver.start")}
          pendingLabel={t("incidents.trip.starting")}
          ariaLabel={`${t("incidents.missingDiver.start")} — ${name}`}
        />
      ) : null}
    </>
  );
}
