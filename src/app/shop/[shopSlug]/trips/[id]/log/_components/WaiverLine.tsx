import type { StaffTranslator } from "@/i18n/staff-messages";
import type { IncidentWaiverStatus } from "@/lib/incident-export";
import type { WaiverHeader } from "./waiver-evidence";

/** The waiver *status* line — state, date, template version. Never the answers. */
export function WaiverLine({
  t,
  waiver,
  dateTime,
  underHeader = false,
}: {
  t: StaffTranslator;
  waiver: IncidentWaiverStatus;
  dateTime: (isoString: string) => string;
  /** The section header already names this release, version and recorder: the date alone. */
  underHeader?: boolean;
}) {
  if (waiver.state === "complete" && waiver.signedAt && underHeader) {
    return (
      <>
        {t("incidentExport.waiverSignedOn", { date: dateTime(waiver.signedAt) })}
        <MedicalClearanceSentence t={t} waiver={waiver} dateTime={dateTime} />
      </>
    );
  }
  if (waiver.state === "complete" && waiver.signedAt) {
    const method =
      waiver.signatureMethod === "imported"
        ? ` ${t("incidentExport.waiverCompleteImported")}`
        : waiver.signatureMethod === "in_person_attested"
          ? ` ${
              waiver.recordedByName
                ? t("incidentExport.waiverPaperMarkedBy", { name: waiver.recordedByName })
                : t("incidentExport.waiverCompleteAttested")
            }`
          : "";
    return (
      <>
        {t("incidentExport.waiverComplete", {
          date: dateTime(waiver.signedAt),
          title: waiver.templateTitle ?? "",
          version: waiver.templateVersion ?? 0,
        })}
        {method}
        {/* A referral a physician cleared is the only thing in this document
            that lifts a hard readiness block, so it is stated on its own.
            **As the shop's act, not as a clinical determination**: `{date}` is
            when a staff member recorded it and `{name}` is that staff member,
            so a sentence reading "a physician cleared this diver on {date}"
            would claim, to an insurer, more than these records hold. The
            physician's own date is stated separately, because it is the one a
            claims reader asks for (issue #1252, `dive-domain-expert` review). */}
        <MedicalClearanceSentence t={t} waiver={waiver} dateTime={dateTime} />
      </>
    );
  }
  if (waiver.state === "medical_review") {
    return <>{t("incidentExport.waiverMedicalReview")}</>;
  }
  {
    /* The same act with the opposite answer, and stated the same careful way
       (issue #1283): `{date}` is when a staff member recorded the outcome and
       `{name}` is that staff member, never a sentence putting words in a
       clinician's mouth. The physician's own evaluation date, their name and
       whether the letter is on file follow, because a refusal earns that
       evidence more than a clearance does — it is the record of why somebody
       stayed ashore. */
  }
  if (waiver.state === "medical_not_cleared") {
    return (
      <>
        {waiver.medicalClearanceDeclinedAt && waiver.medicalClearanceEvaluatedOn ? (
          <>
            {waiver.medicalClearanceDeclinedByName
              ? t("incidentExport.medicalNotClearedRecordedBy", {
                  date: dateTime(waiver.medicalClearanceDeclinedAt),
                  name: waiver.medicalClearanceDeclinedByName,
                  evaluatedOn: waiver.medicalClearanceEvaluatedOn,
                })
              : t("incidentExport.medicalNotClearedRecorded", {
                  date: dateTime(waiver.medicalClearanceDeclinedAt),
                  evaluatedOn: waiver.medicalClearanceEvaluatedOn,
                })}
            {waiver.medicalClearancePhysicianName
              ? ` ${t("incidentExport.medicalClearancePhysician", {
                  name: waiver.medicalClearancePhysicianName,
                })}`
              : ""}
            {waiver.medicalClearanceDocumentOnFile
              ? ` ${t("incidentExport.medicalClearanceOnFile")}`
              : ""}
          </>
        ) : (
          t("incidentExport.waiverMedicalReview")
        )}
      </>
    );
  }
  if (waiver.state === "awaiting_signature") {
    return <>{t("incidentExport.waiverPending")}</>;
  }
  if (waiver.state === "expired") {
    return <>{t("incidentExport.waiverExpired")}</>;
  }
  return <>{t("incidentExport.waiverNotSigned")}</>;
}

/** A physician's clearance on a signed waiver, said after the waiver's own words. */
function MedicalClearanceSentence({
  t,
  waiver,
  dateTime,
}: {
  t: StaffTranslator;
  waiver: IncidentWaiverStatus;
  dateTime: (isoString: string) => string;
}) {
  if (!waiver.medicalClearedAt || !waiver.medicalClearanceEvaluatedOn) return null;
  return (
    <>
      {" "}
      {waiver.medicalClearedByName
        ? t("incidentExport.medicalClearanceRecordedBy", {
            date: dateTime(waiver.medicalClearedAt),
            name: waiver.medicalClearedByName,
            evaluatedOn: waiver.medicalClearanceEvaluatedOn,
          })
        : t("incidentExport.medicalClearanceRecorded", {
            date: dateTime(waiver.medicalClearedAt),
            evaluatedOn: waiver.medicalClearanceEvaluatedOn,
          })}
      {waiver.medicalClearancePhysicianName
        ? ` ${t("incidentExport.medicalClearancePhysician", {
            name: waiver.medicalClearancePhysicianName,
          })}`
        : ""}
      {waiver.medicalClearanceDocumentOnFile
        ? ` ${t("incidentExport.medicalClearanceOnFile")}`
        : ""}
    </>
  );
}

/** "Blue Mantis Diving Release, version 3, recorded by Marcus Webb from in-person signatures". */
export function waiverHeaderText(t: StaffTranslator, header: WaiverHeader): string {
  const values = { title: header.title, version: header.version };
  if (header.signatureMethod === "imported") {
    return t("incidentExport.evidenceWaiverHeaderImported", values);
  }
  if (header.signatureMethod === "in_person_attested") {
    return header.recordedByName
      ? t("incidentExport.evidenceWaiverHeaderRecordedBy", {
          ...values,
          name: header.recordedByName,
        })
      : t("incidentExport.evidenceWaiverHeaderAttested", values);
  }
  return t("incidentExport.evidenceWaiverHeader", values);
}
