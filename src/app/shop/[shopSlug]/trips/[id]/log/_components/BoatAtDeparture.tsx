import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { boatSafetyNoticeText } from "@/i18n/boat-safety-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import {
  type BoatPaperRecord,
  type BoatRadioRecord,
  EMPTY_BOAT_RADIO_RECORD,
} from "@/lib/boat-safety";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import type { IncidentBoatSafety, IncidentExportDocument } from "@/lib/incident-export";

/** Each kept paper fact, in the order Settings asks for them, under the fleet row's own label. */
const PAPER_ROWS: readonly {
  key: keyof BoatPaperRecord;
  label: StaffMessageKey;
  kind: "count" | "date";
}[] = [
  { key: "certifiedPassengers", label: "boats.certifiedPassengersLabel", kind: "count" },
  { key: "certifiedTotalPersons", label: "boats.certifiedTotalPersonsLabel", kind: "count" },
  { key: "coiExpiresOn", label: "boats.coiExpiresLabel", kind: "date" },
  { key: "inspectionDueOn", label: "boats.inspectionDueLabel", kind: "date" },
  { key: "registrationExpiresOn", label: "boats.registrationExpiresLabel", kind: "date" },
  { key: "insuranceExpiresOn", label: "boats.insuranceExpiresLabel", kind: "date" },
];

/** The radio identity the emergency card printed, under the fleet row's own labels (#2672). */
const RADIO_ROWS: readonly { key: keyof BoatRadioRecord; label: StaffMessageKey }[] = [
  { key: "callSign", label: "boats.callSignLabel" },
  { key: "mmsi", label: "boats.mmsiLabel" },
  { key: "workingChannel", label: "boats.workingChannelLabel" },
];

/**
 * **The boat as it stood at the departure checkpoint** (#2300): the papers and
 * the kit notices the snapshot kept, with the crew's checklist answer at
 * the same instant beside them (issue 2725), never the boat as it is today. Absence is
 * stated: no snapshot reads as one sentence, never a missing section, and a
 * paper the shop never recorded says so.
 */
export function BoatAtDeparture({
  doc: { boatSafety, boatSafetyAbsence: absence },
  locale,
  dateTime,
  t,
}: {
  /** The snapshot, and why nothing was kept when it is null (worded without guessing). */
  doc: Pick<IncidentExportDocument, "boatSafety" | "boatSafetyAbsence">;
  locale: string;
  /** The page's own instant formatter, in the shop's zone. */
  dateTime: (isoString: string) => string;
  t: StaffTranslator;
}) {
  return (
    <section aria-labelledby="incident-boat-heading">
      <h2 id="incident-boat-heading" className={SECTION_TITLE_CLASS}>
        {t("incidentExport.boatHeading")}
      </h2>
      {boatSafety ? (
        <>
          <p className="mt-1 max-w-prose text-sm text-muted">
            {t("incidentExport.boatCaptured", {
              boatName: boatSafety.boatName,
              date: dateTime(boatSafety.capturedAt),
            })}
          </p>
          {boatSafety.boatChanged ? (
            <p
              className="mt-2 max-w-prose rounded-inset border border-danger bg-danger-tint px-4 py-3 text-base font-semibold text-danger"
              role="status"
            >
              {t("incidentExport.boatChanged", { boatName: boatSafety.boatName })}
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {PAPER_ROWS.map((row) => {
              const value = boatSafety.papers[row.key];
              return (
                <div key={row.key} className="flex flex-wrap gap-x-2">
                  <dt className="text-muted">{t(row.label)}</dt>
                  <dd>
                    {value === null || value === undefined
                      ? t("incidentExport.boatNotRecorded")
                      : row.kind === "date"
                        ? formatCalendarDate(value as CalendarDate, locale)
                        : value}
                  </dd>
                </div>
              );
            })}
            {RADIO_ROWS.map((row) => {
              const value = (boatSafety.radio ?? EMPTY_BOAT_RADIO_RECORD)[row.key];
              return (
                <div key={row.key} className="flex flex-wrap gap-x-2">
                  <dt className="text-muted">{t(row.label)}</dt>
                  <dd className={value ? "font-mono" : undefined}>
                    {value ?? t("incidentExport.boatNotRecorded")}
                  </dd>
                </div>
              );
            })}
          </dl>
          {/* The register's notices and the crew's checklist answer, side by
              side and from the one snapshot, so the two describe one moment
              (issue 2725). */}
          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted">{t("incidentExport.boatNoticesLabel")}</p>
              {boatSafety.notices.length === 0 ? (
                <p className="mt-1">{t("incidentExport.boatNoNotices")}</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 ps-5">
                  {boatSafety.notices.map((notice, index) => (
                    // Codes kept in the snapshot's order; two can word alike.
                    // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, never-reordered record
                    <li key={index}>{boatSafetyNoticeText(t, locale, notice)}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-muted">{t("incidentExport.boatChecklistLabel")}</p>
              <ChecklistAnswer answer={boatSafety.checklist} t={t} />
            </div>
          </div>
        </>
      ) : (
        <p className="mt-1 max-w-prose text-sm text-muted">
          {t(absence === "no_boat" ? "incidentExport.boatNoBoat" : "incidentExport.boatNotKept")}
        </p>
      )}
    </section>
  );
}

/**
 * The crew's pre-departure answer kept with the snapshot (issue 2725): how many
 * lines were checked, and each one that was not. Absence is stated.
 */
function ChecklistAnswer({
  answer,
  t,
}: {
  answer: IncidentBoatSafety["checklist"];
  t: StaffTranslator;
}) {
  if (!answer) return <p className="mt-1">{t("incidentExport.boatChecklistNotKept")}</p>;
  if (answer.itemCount === 0)
    return <p className="mt-1">{t("incidentExport.boatChecklistNone")}</p>;
  return (
    <>
      <p className="mt-1">
        {t("incidentExport.boatChecklistCount", {
          checked: answer.itemCount - answer.unchecked.length,
          total: answer.itemCount,
        })}
      </p>
      {answer.unchecked.length > 0 ? (
        <>
          <p id="incident-boat-unchecked" className="mt-2 text-muted">
            {t("incidentExport.boatChecklistUnchecked")}
          </p>
          <ul aria-labelledby="incident-boat-unchecked" className="mt-1 list-disc space-y-1 ps-5">
            {answer.unchecked.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
