import type { ReactNode } from "react";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { staffJobWithRatings } from "@/i18n/staff-role-labels";
import type { IncidentExportDocument, IncidentRollCallResult } from "@/lib/incident-export";
import { rollCallTableMinWidth } from "./roll-call-columns";

/**
 * **The crew at the departure** on the departure log: who crewed, their jobs
 * and buddy teams, and each checkpoint's roll call. `children` is what the
 * log prints under the table about the crew (who was away and said to be
 * working it anyway, #2678).
 */
export function CrewAtDeparture({
  doc,
  t,
  dateTime,
  checkpointText,
  checkpointPrintClass,
  children,
}: {
  doc: Pick<IncidentExportDocument, "crew" | "meta">;
  t: StaffTranslator;
  dateTime: (isoString: string) => string;
  checkpointText: (checkpoint: string) => string;
  checkpointPrintClass: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="incident-crew-heading">
      <h2 id="incident-crew-heading" className={SECTION_TITLE_CLASS}>
        {t("incidentExport.crewHeading")}
      </h2>
      {doc.crew.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t("incidentExport.crewNone")}</p>
      ) : (
        <Table minWidth={rollCallTableMinWidth(doc.meta.checkpoints.length)} shellClassName="mt-3">
          <THead>
            <Th>{t("incidentExport.colCrewMember")}</Th>
            <Th>{t("incidentExport.colRoles")}</Th>
            <Th>{t("incidentExport.colCrewTeams")}</Th>
            {doc.meta.checkpoints.map((checkpoint) => (
              <Th key={checkpoint} width="8rem" className={checkpointPrintClass}>
                {checkpointText(checkpoint)}
              </Th>
            ))}
          </THead>
          <TBody>
            {doc.crew.map((member, index) => (
              <tr
                // Two crew can share a full name, and the document carries
                // no person id on purpose (the hash covers printed facts
                // only). Static list, never reordered.
                // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
                key={index}
              >
                <Td className="font-semibold">{member.fullName}</Td>
                <Td muted>{staffJobWithRatings(t, member.roles, member.currentRatings)}</Td>
                {/* Plural on purpose: one divemaster commonly leads
                    several groups on one boat, and this document must
                    print all of them (ADR 20260804-buddy-teams). */}
                <Td muted>
                  {member.buddyTeamNumbers.length === 0
                    ? t("incidentExport.crewNoTeams")
                    : member.buddyTeamNumbers
                        .map((number) => t("incidentExport.buddyTeam", { number }))
                        .join(", ")}
                </Td>
                {member.rollCall.map((result) => (
                  <RollCallCell key={result.checkpoint} t={t} result={result} dateTime={dateTime} />
                ))}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      {children}
    </section>
  );
}

/** One roll-call result cell: the manifest's own word, plus when and by whom. */
export function RollCallCell({
  t,
  result,
  dateTime,
}: {
  t: StaffTranslator;
  result: IncidentRollCallResult;
  dateTime: (isoString: string) => string;
}) {
  return (
    <Td>
      <span
        className={
          result.label === "not_back_aboard"
            ? "font-bold text-danger"
            : result.label === "awaiting"
              ? "text-muted"
              : "font-medium"
        }
      >
        {rollCallLabelText(t, result.label)}
      </span>
      {result.occurredAt && result.recordedByName ? (
        <span className="mt-0.5 block text-xs text-muted [overflow-wrap:anywhere]">
          {t("incidentExport.resultRecordedBy", {
            date: dateTime(result.occurredAt),
            name: result.recordedByName,
          })}
        </span>
      ) : null}
    </Td>
  );
}
