import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { boatSafetyNoticeText } from "@/i18n/boat-safety-labels";
import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import type { BoatPaperRecord } from "@/lib/boat-safety";
import { type CalendarDate, formatCalendarDate } from "@/lib/calendar-date";
import type { IncidentExportDocument } from "@/lib/incident-export";

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

/**
 * **The boat as it stood at the departure checkpoint** (#2300): the papers and
 * the kit notices the snapshot kept, never the boat as it is today. Absence is
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
            <p className="mt-1 max-w-prose text-sm font-medium">
              {t("incidentExport.boatChanged")}
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
          </dl>
          {boatSafety.notices.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t("incidentExport.boatNoNotices")}</p>
          ) : (
            <>
              <p className="mt-3 text-sm text-muted">{t("incidentExport.boatNoticesLabel")}</p>
              <ul className="mt-1 list-disc space-y-1 ps-5 text-sm">
                {boatSafety.notices.map((notice, index) => (
                  // Codes kept in the snapshot's order; two can word alike.
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, never-reordered record
                  <li key={index}>{boatSafetyNoticeText(t, notice)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="mt-1 max-w-prose text-sm text-muted">
          {t(absence === "no_boat" ? "incidentExport.boatNoBoat" : "incidentExport.boatNotKept")}
        </p>
      )}
    </section>
  );
}
