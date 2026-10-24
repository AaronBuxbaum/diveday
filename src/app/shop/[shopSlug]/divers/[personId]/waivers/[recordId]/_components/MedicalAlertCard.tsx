import { type MedicalAlertResult, MedicalAlertReveal } from "@/components/MedicalAlertReveal";
import { SectionCard } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";

/**
 * **The medical alert for the crew, on the signed record** (issue #2960). An
 * owner or manager reads the words behind "Show the alert", which records the
 * read; every other staffer reads that one is on file. Never a gate, so it
 * sits below the medical card, not in it.
 */
export function MedicalAlertCard({
  onFile,
  show,
  identityHeld,
  erasedAt,
  signatureMethod,
  locale,
  timezone,
  t,
}: {
  onFile: boolean;
  /** Bound for an owner or manager only. */
  show?: () => Promise<MedicalAlertResult>;
  identityHeld: boolean;
  erasedAt: Date | null;
  signatureMethod: string | null;
  locale: string;
  timezone: string;
  t: StaffTranslator;
}) {
  const heading = t("waiversStaff.record.medicalAlertHeading");
  const note = identityHeld
    ? t("waiversStaff.record.medicalAlertHeld")
    : erasedAt
      ? t("waiversStaff.record.medicalAlertErased", {
          date: formatDateTimeTz(erasedAt, locale, timezone),
        })
      : onFile
        ? null
        : signatureMethod === "in_person_attested"
          ? t("waiversStaff.record.medicalAlertPaper")
          : signatureMethod === "imported"
            ? t("waiversStaff.record.medicalAlertImported")
            : t("waiversStaff.record.medicalAlertNone");
  return (
    <SectionCard title={heading}>
      {note ? (
        <p className="text-sm text-muted">{note}</p>
      ) : (
        <MedicalAlertReveal
          show={show}
          unreadable={t("waiversStaff.record.medicalAlertOnFile")}
          copy={{
            show: t("waiversStaff.record.medicalAlertShow"),
            showing: t("waiversStaff.record.medicalAlertShowing"),
            showHint: t("waiversStaff.record.medicalAlertShowHint"),
            failed: t("waiversStaff.record.medicalAlertShowFailed"),
            notReviewed: t("waiversStaff.record.medicalAlertNotReviewed"),
          }}
        />
      )}
    </SectionCard>
  );
}
