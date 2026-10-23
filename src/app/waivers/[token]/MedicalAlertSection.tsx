import { Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { DiverTranslator } from "@/i18n/messages";
import { MEDICAL_ALERT_FIELD, MEDICAL_ALERT_MAX } from "@/lib/medical-alert";
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
 * minor's release it names the diver, since a guardian is typing.
 */
export function MedicalAlertSection({
  draft,
  minorName,
  error,
  t,
}: {
  /** What "Save and finish later" kept, or null. */
  draft: string | null;
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
      <FieldGrid columns={1} className="mt-4">
        <Field
          label={t("waiver.medicalAlertLabel")}
          hint={t("common.optional")}
          error={error}
          htmlFor={MEDICAL_ALERT_ANCHOR}
        >
          <textarea
            id={MEDICAL_ALERT_ANCHOR}
            name={MEDICAL_ALERT_FIELD}
            rows={3}
            maxLength={MEDICAL_ALERT_MAX}
            autoComplete="off"
            defaultValue={draft ?? ""}
            className={textareaClassFor(3)}
          />
        </Field>
      </FieldGrid>
    </section>
  );
}
