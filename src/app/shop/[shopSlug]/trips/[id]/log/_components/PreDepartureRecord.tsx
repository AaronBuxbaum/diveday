import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type {
  IncidentPreDepartureCheckEntry,
  IncidentSailedSnagEntry,
} from "@/lib/incident-export";

/**
 * **The log's pre-departure check**: each line of the shop's checklist with
 * who checked it when, and under it the snags open when the boat sailed.
 * Absence is stated, never blank: a shop with no checklist says so.
 */
export function PreDepartureRecord({
  checks,
  snags,
  t,
  dateTime,
}: {
  checks: readonly IncidentPreDepartureCheckEntry[];
  snags: readonly IncidentSailedSnagEntry[];
  t: StaffTranslator;
  dateTime: (isoString: string) => string;
}) {
  return (
    <>
      {checks.length === 0 ? (
        <p className="mt-1 max-w-prose text-sm text-muted">{t("incidentExport.checklistEmpty")}</p>
      ) : (
        // No scroll floor: two columns share a phone's width and wrap. The
        // roll-call tables keep theirs, which grow a column per dive.
        <Table shellClassName="mt-3">
          <THead>
            <Th>{t("incidentExport.checklistColItem")}</Th>
            <Th>{t("incidentExport.checklistColStatus")}</Th>
          </THead>
          <TBody>
            {checks.map((item) => (
              <tr key={item.label}>
                <Td>{item.label}</Td>
                <Td>
                  {item.checked && item.occurredAt && item.recordedByName
                    ? t("incidentExport.checklistCheckedBy", {
                        name: item.recordedByName,
                        date: dateTime(item.occurredAt),
                      })
                    : t("incidentExport.checklistNotChecked")}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <SailedWithSnags snags={snags} t={t} dateTime={dateTime} />
    </>
  );
}

/**
 * **What the crew knew when the boat left** (dive-domain review of fifth-loop
 * item 1): the boat's snags open at the scheduled start, under the
 * pre-departure check they were written against. Nothing for a boat that
 * sailed with none; the content hash leaves an empty list out for the same
 * reason.
 */
export function SailedWithSnags({
  snags,
  t,
  dateTime,
}: {
  snags: readonly IncidentSailedSnagEntry[];
  t: StaffTranslator;
  dateTime: (isoString: string) => string;
}) {
  if (snags.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold">{t("incidentExport.sailedWithSnagsHeading")}</h3>
      <ul className="mt-1 flex max-w-prose flex-col gap-1 text-sm">
        {snags.map((snag) => (
          <li key={`${snag.notedAt}|${snag.itemLabel}|${snag.note}`}>
            {t("incidentExport.sailedWithSnag", {
              item: snag.itemLabel,
              note: snag.note,
              name: snag.notedByName,
              date: dateTime(snag.notedAt),
            })}
          </li>
        ))}
      </ul>
    </div>
  );
}
