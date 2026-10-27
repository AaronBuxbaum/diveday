import type { StaffTranslator } from "@/i18n/staff-messages";
import type { IncidentCertificationEvidence, IncidentRosterEntry } from "@/lib/incident-export";
import { CertificationLine } from "./CertificationLine";

/** Boarding evidence and current cards have different clocks and must stay separate. */
export function CertificationEvidence({
  diver,
  t,
  agencyText,
  dateTime,
}: {
  diver: IncidentRosterEntry;
  t: StaffTranslator;
  agencyText: (agency: string) => string;
  dateTime: (instant: string) => string;
}) {
  if (diver.identityWithheld) return null;
  const list = (cards: IncidentCertificationEvidence[]) =>
    cards.length === 0 ? (
      <p className="text-sm text-muted">{t("incidentExport.certNone")}</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm text-muted">
        {cards.map((card) => (
          <li
            key={`${card.kind}-${card.agency}-${card.level}-${card.specialty}-${card.identifier}`}
          >
            <CertificationLine t={t} card={card} agencyText={agencyText} dateTime={dateTime} />
          </li>
        ))}
      </ul>
    );
  return (
    <>
      <p className="mt-2 text-sm font-medium">
        {diver.certificationsStartedAt && diver.certificationsCapturedAt
          ? t("incidentExport.certCapturedAt", {
              start: dateTime(diver.certificationsStartedAt),
              end: dateTime(diver.certificationsCapturedAt),
            })
          : t("incidentExport.certAtBoarding")}
      </p>
      {diver.certificationsAtCapture === null ? (
        <p className="text-sm text-muted">{t("incidentExport.certBoardingUnavailable")}</p>
      ) : (
        list(diver.certificationsAtCapture)
      )}
      <p className="mt-2 text-sm font-medium">{t("incidentExport.certCurrent")}</p>
      {list(diver.certifications)}
    </>
  );
}
