import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { IncidentExportDocument } from "@/lib/incident-export";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import { RollCallCell } from "./CrewAtDeparture";
import { NumberedName } from "./NumberedName";
import { rollCallTableMinWidth } from "./roll-call-columns";

type Props = {
  doc: IncidentExportDocument;
  t: StaffTranslator;
  dateTime: (value: string) => string;
  checkpointText: (value: string) => string;
  memberList: Intl.ListFormat;
  checkpointPrintClass: string;
};

/** A wide screen roster becomes readable two-checkpoint sections on paper. */
export function DepartureRoster(props: Props) {
  const checkpoints = props.doc.meta.checkpoints;
  if (checkpoints.length <= 5)
    return <RosterTable {...props} checkpoints={checkpoints} shellClassName="mt-3" />;
  return (
    <>
      <RosterTable {...props} checkpoints={checkpoints} shellClassName="mt-3 print:hidden" />
      {[0, 2, 4].map((start) => (
        <RosterTable
          key={start}
          {...props}
          checkpoints={checkpoints.slice(start, start + 2)}
          shellClassName="mt-3 hidden print:block"
          printSegment
        />
      ))}
    </>
  );
}

function RosterTable({
  doc,
  t,
  dateTime,
  checkpointText,
  memberList,
  checkpointPrintClass,
  checkpoints,
  shellClassName,
  printSegment,
}: Props & {
  checkpoints: RollCallCheckpoint[];
  shellClassName: string;
  printSegment?: boolean;
}) {
  return (
    <Table
      minWidth={rollCallTableMinWidth(doc.meta.checkpoints.length)}
      shellClassName={shellClassName}
    >
      <THead>
        <Th>{t("incidentExport.colDiver")}</Th>
        <Th>{t("incidentExport.colEmergencyContact")}</Th>
        <Th>{t("incidentExport.colBuddy")}</Th>
        {checkpoints.map((checkpoint) => (
          <Th
            key={checkpoint}
            width="8rem"
            className={printSegment ? "print:w-auto" : checkpointPrintClass}
          >
            {checkpointText(checkpoint)}
          </Th>
        ))}
      </THead>
      <TBody>
        {doc.roster.map((diver, index) => (
          <tr key={diver.bookingId}>
            <Td>
              <NumberedName number={index + 1} name={diver.fullName} />
            </Td>
            {/* The name may wrap; the number may not. This is the one
                    document a shop hands an insurer or an authority, and a
                    phone number broken across lines at its hyphens is a number
                    somebody has to reassemble while reading it aloud in a
                    hurry (issue #1035). `Td numeric` would nowrap it, but it
                    would also right-align the whole cell and make a name a
                    figure — so the rule goes on the number itself. The dot
                    before it is glued to the name by a no-break space, so a
                    narrow cell never starts a line with "·". */}
            <Td muted>
              {/* A held seat's contact would be the matched person's next
                      of kin (issue #2128): said, never "Not on file". */}
              {diver.identityWithheld ? (
                t("incidentExport.identityWithheld")
              ) : diver.emergencyContactName && diver.emergencyContactPhone ? (
                <>
                  {diver.emergencyContactName}
                  {"\u00a0"}·{" "}
                  <span className="whitespace-nowrap">{diver.emergencyContactPhone}</span>
                </>
              ) : (
                t("incidentExport.notOnFile")
              )}
            </Td>
            <Td muted>
              {diver.buddy ? (
                <>
                  <span className="font-medium text-foreground">
                    {t("incidentExport.buddyTeam", { number: diver.buddy.teamNumber })}
                  </span>{" "}
                  {/* Every other member, and crew marked as crew — the
                            distinction this document exists to keep, since
                            "accompanied by a divemaster" and "nobody paired
                            them" used to print the same. */}
                  {memberList.format(
                    diver.buddy.members.map((member) =>
                      member.isCrew
                        ? `${member.fullName} (${t("incidentExport.buddyCrewTag")})`
                        : member.fullName,
                    ),
                  )}
                  <span className="block text-xs">
                    {diver.buddy.pairedByName && diver.buddy.pairedAt
                      ? t("incidentExport.buddyPairedBy", {
                          name: diver.buddy.pairedByName,
                          at: dateTime(diver.buddy.pairedAt),
                        })
                      : t("incidentExport.buddyPairedByUnknown")}
                  </span>
                </>
              ) : (
                t("incidentExport.noBuddyRecorded")
              )}
            </Td>
            {diver.rollCall
              .filter((result) => checkpoints.includes(result.checkpoint))
              .map((result) => (
                <RollCallCell key={result.checkpoint} t={t} result={result} dateTime={dateTime} />
              ))}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
