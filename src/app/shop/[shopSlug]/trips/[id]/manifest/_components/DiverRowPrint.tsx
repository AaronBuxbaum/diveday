import { Badge } from "@/components/ui/badge";
import { StatusMark } from "@/components/ui/StatusMark";
import { birthdayCalloutText } from "@/i18n/birthday-labels";
import { buddyAlertText } from "@/i18n/buddy-labels";
import { depthWarningText } from "@/i18n/depth-labels";
import { medicalWarningChips, rollCallLabelText } from "@/i18n/manifest-labels";
import { readinessStatusText, readinessStatusTone } from "@/i18n/readiness-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { type RollCallCheckpoint, rollCallLabel, type TripManifest } from "@/lib/manifests";
import { DiverFacts, diverBlockerText } from "./DiverFacts";
import type { DiverRowState } from "./diver-row-state";

/**
 * **The row on paper**: every fact the person sheet tucks away, restated
 * unconditionally, because the sheet contributes nothing to print and the
 * printed manifest is the document that goes ashore.
 */
export function DiverRowPrint({
  diver,
  printedAlert,
  state,
  checkpoint,
  auditLabel,
  teamLabel,
  locale,
  timezone,
  t,
}: {
  diver: TripManifest["divers"][number];
  /**
   * The diver's own words, only on a packet printed **with** the medical
   * alerts (issue #2990), which recorded the print on their trail first.
   * Absent on every other print: the flag only.
   */
  printedAlert?: string;
  state: DiverRowState;
  checkpoint: RollCallCheckpoint;
  /** The recorded state's words, as the row's own label says them. */
  auditLabel: string;
  /** "Buddy team: Ana and Ben", or null for a diver on no team. */
  teamLabel: string | null;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const { rc, ready, diverStatus, impliedNotBoarded, capsuleKind, medicalDays } = state;
  return (
    <div data-print-only className="hidden px-4 pb-4 print:block">
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
        {ready || capsuleKind === "blocked" ? null : (
          <Badge tone={readinessStatusTone(diverStatus)}>
            {readinessStatusText(t, diverStatus)}
          </Badge>
        )}
        {diver.checkedIn ? <Badge tone="neutral">{t("manifest.checkedInPill")}</Badge> : null}
        {/* The fact only (issue #2960) on the default print: the words stay
          behind the tap and on the crew's offline copy. "Print with medical
          alerts" puts them under the row instead (below, issue #2990). */}
        {diver.medicalAlert && !diver.identityWithheld && !printedAlert ? (
          // Two sentences, wider than a sheet's column: it wraps rather than clips.
          <Badge tone="primary" wraps>
            {t("manifest.medicalAlertPrinted")}
          </Badge>
        ) : null}
        {diver.hotelPickupLocation ? (
          <Badge tone="neutral">
            {diver.hotelPickupLocation}
            {diver.pickupTime ? ` · ${diver.pickupTime}` : ""}
          </Badge>
        ) : null}
        {diver.age !== null && diver.age !== undefined && capsuleKind !== "minor" ? (
          <Badge tone={diver.minor ? "warning" : "neutral"} tabularNums>
            {diver.minor
              ? t("manifest.minorAge", { age: diver.age })
              : t("manifest.age", { age: diver.age })}
          </Badge>
        ) : null}
        {medicalWarningChips(t, medicalDays)
          .slice(capsuleKind === "medical" ? 1 : 0)
          .map((chip) => (
            <Badge key={chip} tone="warning">
              {chip}
            </Badge>
          ))}
        {diver.birthday && capsuleKind !== "birthday" ? (
          <Badge tone="primary">{birthdayCalloutText(t, diver.birthday)}</Badge>
        ) : null}
        {teamLabel ? (
          <Badge tone="neutral">
            {teamLabel}
            {diver.buddyAlert
              ? ` · ${buddyAlertText(t, diver.buddyAlert, diver.buddyMissing)}`
              : ""}
          </Badge>
        ) : null}
      </p>
      {printedAlert && !diver.identityWithheld ? (
        <div className="mt-2 rounded border border-border px-3 py-2">
          <p className="text-sm font-semibold">{t("manifest.medicalAlertHeading")}</p>
          {/* The diver's own words, line breaks kept. */}
          <p className="text-base whitespace-pre-wrap [overflow-wrap:anywhere]">{printedAlert}</p>
          {/* Under every alert, so each printed page with words says what to
              do with the paper (domain review 1, S3). */}
          <p className="mt-1 text-xs font-medium">{t("manifest.medicalAlertsPrintedKeepShort")}</p>
        </div>
      ) : null}
      {ready ? null : (
        <ul className="mt-2 flex flex-col gap-1 text-base">
          {diver.readiness.blockers.map((blocker) => {
            const text = diverBlockerText(t, diver, blocker);
            return <li key={text}>• {text}</li>;
          })}
        </ul>
      )}
      {diver.depthAdvisory?.status === "exceeds" ? (
        <p className="mt-2 flex items-start gap-2 text-base">
          <StatusMark variant="warning" size="md" />
          <span>{depthWarningText(t, diver.depthAdvisory)}</span>
        </p>
      ) : null}
      {/* The audit line **in full** — the screen's compact
        "Boarded · 7:12 AM · the recorder" is a same-day reading on
        the boat; the sheet that goes ashore may be read months
        later, so it carries the date and the zone. */}
      {rc && !rc.implied ? (
        <p className="mt-2 text-sm">
          {t("manifest.rollCallRecordedByPlain", {
            label: auditLabel,
            date: formatDateTimeTz(rc.occurredAt, locale, timezone),
            name: rc.recordedByName,
          })}
        </p>
      ) : null}
      <div className="mt-2">
        <DiverFacts diver={diver} locale={locale} timezone={timezone} columns={2} t={t} />
      </div>
    </div>
  );
}
