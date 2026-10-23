import { FieldGrid } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { MedicalAlertBox } from "./MedicalAlertBox";
import { SectionHeading } from "./SectionHeading";

/** The box's id: what a refusal rings and `WAIVER_FIELD_ERROR.medicalAlert` names. */
export const MEDICAL_ALERT_ANCHOR = "medicalAlert";

/**
 * **"For the crew, in an emergency"** (glossary *Medical alert for the
 * crew*, issue #2960): one optional box, right after the standard medical
 * questionnaire, for what the boat should know if something goes wrong.
 *
 * It is not a step on the rail (optional, one field) and nothing counts it
 * toward the medical step. The page says plainly that it does not replace the
 * questions above and that nobody reviews it for fitness to dive, because
 * nothing does: the questionnaire alone refers a diver to a doctor. On a
 * minor's release it names the diver, since a guardian is typing. It says
 * who reads it and to tell the crew at the briefing too, and to leave it
 * blank if there is nothing (a bare "N/A" is stored as none anyway).
 *
 * The box starts from the link's draft or, with none, from the same person's
 * last signed release here (`medicalAlertPrefill`), saying so, so signing
 * again never drops an alert the diver did not see (H-153 amendment).
 */
export function MedicalAlertSection({
  prefill,
  minorName,
  error,
  t,
}: {
  /** What the box starts with (`medicalAlertPrefill`): a draft, or the last signed alert. */
  prefill: { text: string | null; earlier: boolean };
  /** The diver's name on a minor's release, where a guardian is writing about them. */
  minorName: string | null;
  /** The words for a refused box, shown beside it. */
  error: string | undefined;
  t: DiverTranslator;
}) {
  return (
    <section>
      <SectionHeading>{t("waiver.medicalAlertHeading")}</SectionHeading>
      <p className="mt-2 text-sm text-muted">
        {minorName
          ? t("waiver.medicalAlertIntroMinor", { name: minorName })
          : t("waiver.medicalAlertIntro")}
      </p>
      <p className="mt-1 text-sm text-muted">{t("waiver.medicalAlertNotQuestionnaire")}</p>
      <p className="mt-1 text-sm text-muted">{t("waiver.medicalAlertReaders")}</p>
      {prefill.earlier && prefill.text ? (
        <p className="mt-3 text-sm font-medium">{t("waiver.medicalAlertFromEarlier")}</p>
      ) : null}
      <FieldGrid columns={1} className="mt-4">
        <MedicalAlertBox
          id={MEDICAL_ALERT_ANCHOR}
          label={t("waiver.medicalAlertLabel")}
          hint={t("common.optional")}
          error={error}
          defaultValue={prefill.text ?? ""}
          counter={{
            one: t.raw("waiver.medicalAlertCounterOne"),
            other: t.raw("waiver.medicalAlertCounterOther"),
          }}
        />
      </FieldGrid>
    </section>
  );
}
